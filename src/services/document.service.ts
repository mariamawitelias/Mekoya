import type { DocumentStatus } from '@prisma/client';
import type {} from 'multer';
import type { AuthUser } from '../@types/express/index.js';
import { OPEN_STATUSES } from '../config/appointmentRules.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { canAccessOwnedResource } from '../utils/access.js';
import { AppError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { detectFileType } from '../utils/fileType.js';
import { recordAudit } from './audit.service.js';
import { syncAppointmentStatus } from './appointmentStatus.service.js';
import { storage } from './storage.service.js';
import { queueReview } from './documentReview.service.js';

const APPROVED: DocumentStatus[] = ['AI_APPROVED', 'OFFICER_APPROVED'];
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 };

interface UploadInput {
  appointmentId: string;
  serviceRequirementId: string;
  file: Express.Multer.File | undefined;
  actor: AuthUser;
}

function cleanDisplayName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}._ -]/gu, '_').trim().slice(-150);
  return cleaned.length > 0 ? cleaned : 'document';
}

export async function uploadDocument(input: UploadInput) {
  const { file, actor } = input;
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Attach a file in the "file" form field');

  const detected = detectFileType(file.buffer);
  if (!detected) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'The file content is not a valid JPEG, PNG or PDF');
  }
  if (file.mimetype !== detected.mime) {
    throw new AppError(415, 'FILE_TYPE_MISMATCH', 'The file content does not match its declared type');
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { id: true, userId: true, serviceId: true, status: true, slotStart: true },
  });
  if (!appointment) throw new NotFoundError('Appointment not found');
  if (!canAccessOwnedResource(actor, appointment.userId)) {
    throw new ForbiddenError('You can only upload to your own appointments');
  }
  if (!OPEN_STATUSES.includes(appointment.status)) {
    throw new AppError(409, 'INVALID_STATE', 'Documents can only be uploaded for active appointments');
  }
  if (appointment.slotStart.getTime() <= Date.now()) {
    throw new AppError(409, 'TOO_LATE', 'This appointment time has already passed');
  }

  const checklistItem = await prisma.serviceRequirement.findFirst({
    where: { id: input.serviceRequirementId, serviceId: appointment.serviceId, requirement: { isActive: true } },
    select: { id: true },
  });
  if (!checklistItem) throw new NotFoundError('That checklist item does not belong to this appointment');

  const key = await storage.save(file.buffer, detected.extension);
  let result;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`doc:${appointment.id}:${checklistItem.id}`}))`;

      const fresh = await tx.appointment.findUnique({ where: { id: appointment.id }, select: { status: true } });
      if (!fresh || !OPEN_STATUSES.includes(fresh.status)) {
        throw new AppError(409, 'INVALID_STATE', 'This appointment can no longer accept documents');
      }

      const current = await tx.documentSubmission.findFirst({
        where: { appointmentId: appointment.id, serviceRequirementId: checklistItem.id, isCurrent: true },
      });
      if (current && APPROVED.includes(current.status)) {
        throw new AppError(409, 'DOCUMENT_ALREADY_APPROVED', 'This document is already approved and cannot be replaced');
      }
      if (current) {
        await tx.documentSubmission.update({ where: { id: current.id }, data: { isCurrent: false } });
      }

      const created = await tx.documentSubmission.create({
        data: {
          appointmentId: appointment.id,
          serviceRequirementId: checklistItem.id,
          version: (current?.version ?? 0) + 1,
          filePath: key,
          originalName: cleanDisplayName(file.originalname),
          mimeType: detected.mime,
          sizeBytes: file.size,
        },
      });

      await recordAudit(
        {
          actorId: actor.id,
          action: 'DOCUMENT_UPLOADED',
          entityType: 'DocumentSubmission',
          entityId: created.id,
          metadata: { appointmentId: appointment.id, version: created.version, mimeType: detected.mime, sizeBytes: file.size },
        },
        tx,
      );

      const appointmentStatus = await syncAppointmentStatus(tx, appointment.id);

      return {
        document: {
          id: created.id,
          serviceRequirementId: created.serviceRequirementId,
          version: created.version,
          status: created.status,
          aiStatus: created.aiStatus,
          originalName: created.originalName,
          mimeType: created.mimeType,
          sizeBytes: created.sizeBytes,
          uploadedAt: created.createdAt,
        },
        appointmentStatus,
      };
    }, TX_OPTIONS);

    queueReview(result.document.id); // after the commit, so the review can always find the row
    return result;
  } catch (error) {
    await storage.remove(key).catch((cleanupError: unknown) => {
      logger.error({ err: cleanupError, key }, 'Could not remove an orphaned upload');
    });
    throw error;
  }

  queueReview(result.document.id); // after the commit, so the review can always find the row
  return result;
}

export async function openDocumentFile(id: string, actor: AuthUser) {
  const document = await prisma.documentSubmission.findUnique({
    where: { id },
    include: { appointment: { select: { userId: true, officeId: true } } },
  });
  if (!document) throw new NotFoundError('Document not found');

  const isOwner = canAccessOwnedResource(actor, document.appointment.userId);
  const isOfficeStaff =
    actor.permissions.includes('document:review') &&
    actor.officeId !== null &&
    actor.officeId === document.appointment.officeId;
  if (!isOwner && !isOfficeStaff) throw new ForbiddenError('You do not have access to this document');

  const opened = await storage.open(document.filePath);
  if (!opened) throw new NotFoundError('The file is missing from storage');

  return { ...opened, mimeType: document.mimeType, originalName: document.originalName };
}