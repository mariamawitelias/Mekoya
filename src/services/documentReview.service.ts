import type { AiStatus, DocumentStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../@types/express/index.js';
import { OPEN_STATUSES } from '../config/appointmentRules.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import type { OfficerDocumentsQuery, ReviewDocumentBody } from '../schemas/document.schema.js';
import { canAccessOwnedResource } from '../utils/access.js';
import { AppError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { type Lang, pick } from '../utils/language.js';
import { pageMeta, paginate } from '../utils/pagination.js';
import { decideReview } from '../utils/reviewPolicy.js';
import { toAddisDate, toAddisTime } from '../utils/time.js';
import { analyzeDocument } from './ai.service.js';
import { syncAppointmentStatus } from './appointmentStatus.service.js';
import { recordAudit } from './audit.service.js';
import { queueEmail } from './email.service.js';
import { storage } from './storage.service.js';

// ───────────────────────── Rejection email ─────────────────────────

async function sendRejectionEmail(documentId: string, reason: string): Promise<void> {
  try {
    const document = await prisma.documentSubmission.findUnique({
      where: { id: documentId },
      include: {
        serviceRequirement: { include: { requirement: true } },
        appointment: { include: { service: true, user: { include: { profile: true } } } },
      },
    });
    if (!document) return;

    const { appointment } = document;
    queueEmail(
      {
        template: 'DOCUMENT_REJECTED',
        data: {
          name: appointment.user.profile?.fullName ?? appointment.user.email,
          serviceName: appointment.service.nameEn,
          documentName: document.serviceRequirement.requirement.nameEn,
          reason,
          date: toAddisDate(appointment.slotStart),
          time: toAddisTime(appointment.slotStart),
        },
      },
      { to: appointment.user.email, userId: appointment.userId, appointmentId: appointment.id },
    );
  } catch (error) {
    logger.error({ err: error, documentId }, 'Could not queue rejection email');
  }
}

// ───────────────────────── Automatic review ─────────────────────────

interface Outcome {
  status: DocumentStatus;
  aiStatus: AiStatus;
  reason: string | null;
  confidence: number | null;
  result: Prisma.InputJsonObject;
}

function fallbackOutcome(error: string): Outcome {
  return { status: 'NEEDS_HUMAN', aiStatus: 'FALLBACK', reason: null, confidence: null, result: { error } };
}

export async function runAiReview(documentId: string): Promise<void> {
  const document = await prisma.documentSubmission.findFirst({
    where: { id: documentId, isCurrent: true, status: 'PENDING', aiStatus: 'PENDING' },
    include: { serviceRequirement: { include: { requirement: true } } },
  });
  if (!document) return; // already reviewed, replaced by a newer upload, or deleted

  // The slow network call happens OUTSIDE any database transaction
  const data = await storage.read(document.filePath);
  let outcome: Outcome;
  if (!data) {
    outcome = fallbackOutcome('The stored file could not be read');
  } else {
    const analysis = await analyzeDocument({
      data,
      mimeType: document.mimeType,
      originalName: document.originalName,
      expectedType: document.serviceRequirement.requirement.expectedType,
      requirementName: document.serviceRequirement.requirement.nameEn,
    });

    if (analysis.ok) {
      const decision = decideReview(analysis.observation);
      outcome = {
        status: decision.status,
        aiStatus: 'DONE',
        reason: decision.reason,
        confidence: analysis.observation.confidence,
        result: { provider: analysis.provider, observation: analysis.observation },
      };
    } else {
      outcome = fallbackOutcome(analysis.error);
    }
  }

  const applied = await prisma.$transaction(async (tx) => {
    // Only writes if the document is still the current, untouched one. A replacement uploaded
    // while the AI was thinking must not receive the old file's verdict.
    const updated = await tx.documentSubmission.updateMany({
      where: { id: document.id, isCurrent: true, status: 'PENDING' },
      data: {
        status: outcome.status,
        aiStatus: outcome.aiStatus,
        aiResult: outcome.result,
        aiConfidence: outcome.confidence,
        rejectionReason: outcome.status === 'AI_REJECTED' ? outcome.reason : null,
      },
    });
    if (updated.count === 0) return false;

    await recordAudit(
      {
        actorId: null, // a system action
        action: 'DOCUMENT_AI_REVIEWED',
        entityType: 'DocumentSubmission',
        entityId: document.id,
        metadata: { status: outcome.status, aiStatus: outcome.aiStatus, confidence: outcome.confidence },
      },
      tx,
    );
    await syncAppointmentStatus(tx, document.appointmentId);
    return true;
  });

  if (!applied) {
    logger.info({ documentId }, 'AI verdict discarded: the document changed during review');
    return;
  }
  if (outcome.status === 'AI_REJECTED' && outcome.reason) {
    await sendRejectionEmail(document.id, outcome.reason);
  }
}

// Fire-and-forget: the upload request has already returned by the time this finishes
export function queueReview(documentId: string): void {
  void runAiReview(documentId).catch((error: unknown) => {
    logger.error({ err: error, documentId }, 'AI review crashed');
  });
}

// If the server stopped mid-review, those documents are still PENDING. Pick them up on startup.
export async function resumePendingReviews(): Promise<void> {
  const stuck = await prisma.documentSubmission.findMany({
    where: { isCurrent: true, status: 'PENDING', aiStatus: 'PENDING', createdAt: { lt: new Date(Date.now() - 60_000) } },
    select: { id: true },
    take: 50,
  });
  for (const { id } of stuck) queueReview(id);
  if (stuck.length > 0) logger.info({ count: stuck.length }, 'Resumed pending AI reviews');
}

// ───────────────────────── Officer review ─────────────────────────

export async function listOfficerDocuments(officeId: string, query: OfficerDocumentsQuery, lang: Lang) {
  const where: Prisma.DocumentSubmissionWhereInput = {
    isCurrent: true,
    status: query.status ?? 'NEEDS_HUMAN',
    appointment: { officeId, status: { in: OPEN_STATUSES } }, // officeId comes from the officer's account
  };

  const [total, rows] = await prisma.$transaction([
    prisma.documentSubmission.count({ where }),
    prisma.documentSubmission.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      ...paginate(query.page, query.limit),
      include: {
        serviceRequirement: { include: { requirement: true } },
        appointment: { include: { service: true, user: { select: { profile: { select: { fullName: true } } } } } },
      },
    }),
  ]);

  const items = rows.map((doc) => ({
    id: doc.id,
    appointmentId: doc.appointmentId,
    status: doc.status,
    appealRequested: doc.appealRequested,
    aiStatus: doc.aiStatus,
    aiConfidence: doc.aiConfidence,
    aiResult: doc.aiResult,
    rejectionReason: doc.rejectionReason,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    uploadedAt: doc.createdAt,
    requirement: pick(lang, doc.serviceRequirement.requirement.nameEn, doc.serviceRequirement.requirement.nameAm),
    service: pick(lang, doc.appointment.service.nameEn, doc.appointment.service.nameAm),
    appointmentDate: toAddisDate(doc.appointment.slotStart),
    appointmentTime: toAddisTime(doc.appointment.slotStart),
    citizenName: doc.appointment.user.profile?.fullName ?? null,
  }));

  return { items, meta: pageMeta(total, query.page, query.limit) };
}

// Approve, reject, or override ANY current document in the officer's own office
export async function officerReviewDocument(id: string, officer: AuthUser, body: ReviewDocumentBody) {
  const document = await prisma.documentSubmission.findUnique({
    where: { id },
    include: { appointment: { select: { officeId: true, status: true } } },
  });
  if (!document) throw new NotFoundError('Document not found');
  if (!officer.officeId || document.appointment.officeId !== officer.officeId) {
    throw new ForbiddenError('This document belongs to a different office');
  }
  if (!document.isCurrent) throw new AppError(409, 'NOT_CURRENT', 'Only the latest version of a document can be reviewed');
  if (!OPEN_STATUSES.includes(document.appointment.status)) {
    throw new AppError(409, 'INVALID_STATE', 'This appointment is closed, so its documents can no longer be reviewed');
  }

  const approve = body.decision === 'APPROVE';
  const newStatus: DocumentStatus = approve ? 'OFFICER_APPROVED' : 'OFFICER_REJECTED';

  const appointmentStatus = await prisma.$transaction(async (tx) => {
    const updated = await tx.documentSubmission.updateMany({
      where: { id, isCurrent: true },
      data: {
        status: newStatus,
        reviewedById: officer.id,
        reviewedAt: new Date(),
        reviewNote: body.reason ?? null,
        rejectionReason: approve ? null : (body.reason ?? null),
        appealRequested: false,
      },
    });
    if (updated.count === 0) throw new AppError(409, 'NOT_CURRENT', 'The document changed. Please refresh and try again');

    await recordAudit(
      {
        actorId: officer.id,
        action: 'DOCUMENT_OFFICER_REVIEWED',
        entityType: 'DocumentSubmission',
        entityId: id,
        // previousStatus makes an override visible: for example AI_APPROVED -> OFFICER_REJECTED
        metadata: { previousStatus: document.status, newStatus, reason: body.reason ?? null },
      },
      tx,
    );
    return syncAppointmentStatus(tx, document.appointmentId);
  });

  if (!approve && body.reason) await sendRejectionEmail(id, body.reason);
  return { id, status: newStatus, appointmentStatus };
}

// ───────────────────────── Citizen appeal ─────────────────────────

export async function appealDocument(id: string, actor: AuthUser) {
  const document = await prisma.documentSubmission.findUnique({
    where: { id },
    include: { appointment: { select: { userId: true, status: true } } },
  });
  if (!document) throw new NotFoundError('Document not found');
  if (!canAccessOwnedResource(actor, document.appointment.userId)) {
    throw new ForbiddenError('You can only appeal decisions on your own documents');
  }
  if (!document.isCurrent || document.status !== 'AI_REJECTED') {
    throw new AppError(409, 'INVALID_STATE', 'Only a document rejected by the automatic check can be appealed');
  }
  if (!OPEN_STATUSES.includes(document.appointment.status)) {
    throw new AppError(409, 'INVALID_STATE', 'This appointment is closed');
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.documentSubmission.updateMany({
      where: { id, isCurrent: true, status: 'AI_REJECTED' },
      data: { status: 'NEEDS_HUMAN', appealRequested: true },
    });
    if (updated.count === 0) throw new AppError(409, 'INVALID_STATE', 'This document can no longer be appealed');

    await recordAudit({ actorId: actor.id, action: 'DOCUMENT_APPEAL_REQUESTED', entityType: 'DocumentSubmission', entityId: id }, tx);
  });

  return { id, status: 'NEEDS_HUMAN' as const };
}