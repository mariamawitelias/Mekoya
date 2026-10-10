import type { DocumentStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../@types/express/index.js';
import { APPOINTMENT_RULES } from '../config/appointmentRules.js';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import type { OfficerQueueQuery } from '../schemas/appointment.schema.js';
import { AppError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { type Lang, pick } from '../utils/language.js';
import { pageMeta, paginate } from '../utils/pagination.js';
import { addisDayRange, MINUTE_MS, toAddisDate, toAddisTime } from '../utils/time.js';
import { recordAudit } from './audit.service.js';
import { getAppointmentDetail } from './appointment.service.js';

const APPROVED: DocumentStatus[] = ['AI_APPROVED', 'OFFICER_APPROVED'];
const REJECTED: DocumentStatus[] = ['AI_REJECTED', 'OFFICER_REJECTED'];

export async function listOfficeQueue(officeId: string, query: OfficerQueueQuery, lang: Lang) {
  const date = query.date ?? toAddisDate(new Date()); // the queue defaults to today
  const { start, end } = addisDayRange(date);

  // officeId comes from the officer's own account, never from the request
  const where: Prisma.AppointmentWhereInput = {
    officeId,
    slotStart: { gte: start, lt: end },
    ...(query.status ? { status: query.status } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      orderBy: { slotStart: 'asc' },
      ...paginate(query.page, query.limit),
      include: {
        service: true,
        user: { select: { profile: { select: { fullName: true } } } },
        documents: { where: { isCurrent: true }, select: { status: true } },
      },
    }),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    status: row.status,
    date: toAddisDate(row.slotStart),
    time: toAddisTime(row.slotStart),
    service: { id: row.service.id, name: pick(lang, row.service.nameEn, row.service.nameAm) },
    citizenName: row.user.profile?.fullName ?? null,
    documents: {
      total: row.documents.length,
      approved: row.documents.filter((doc) => APPROVED.includes(doc.status)).length,
      rejected: row.documents.filter((doc) => REJECTED.includes(doc.status)).length,
      needsHuman: row.documents.filter((doc) => doc.status === 'NEEDS_HUMAN').length,
      pending: row.documents.filter((doc) => doc.status === 'PENDING').length,
    },
  }));

  return { items, meta: pageMeta(total, query.page, query.limit), date };
}

async function loadForOfficer(id: string, officer: AuthUser) {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: { id: true, officeId: true, status: true, slotStart: true },
  });
  if (!appointment) throw new NotFoundError('Appointment not found');
  if (!officer.officeId || appointment.officeId !== officer.officeId) {
    throw new ForbiddenError('This appointment belongs to a different office');
  }
  return appointment;
}

export async function completeAppointment(id: string, officer: AuthUser, closureNote: string | undefined) {
  const appointment = await loadForOfficer(id, officer);

  if (appointment.status !== 'CONFIRMED') {
    throw new AppError(
      409,
      'INVALID_STATE',
      appointment.status === 'BOOKED'
        ? 'All mandatory documents must be approved before this appointment can be completed'
        : `This appointment is already ${appointment.status.toLowerCase().replace('_', ' ')}`,
    );
  }
  if (env.ENFORCE_COMPLETION_TIMING && Date.now() < appointment.slotStart.getTime() - APPOINTMENT_RULES.completeEarlyMinutes * MINUTE_MS) {
    throw new AppError(409, 'TOO_EARLY', 'This appointment cannot be completed before its time slot');
  }

  await prisma.$transaction(async (tx) => {
    const updateData = {
      status: 'COMPLETED' as const,
      ...(closureNote !== undefined ? { closureNote } : {}),
    };

    const result = await tx.appointment.updateMany({
      where: { id, status: 'CONFIRMED' },
      data: updateData,
    });
    if (result.count === 0) throw new AppError(409, 'INVALID_STATE', 'The appointment changed. Please refresh and try again');

    await recordAudit(
      { actorId: officer.id, action: 'APPOINTMENT_COMPLETED', entityType: 'Appointment', entityId: id, metadata: { closureNote: closureNote ?? null } },
      tx,
    );
  });

  return getAppointmentDetail(id, 'EN', 'staff');
}

export async function markNoShow(id: string, officer: AuthUser) {
  const appointment = await loadForOfficer(id, officer);

  if (appointment.status !== 'BOOKED' && appointment.status !== 'CONFIRMED') {
    throw new AppError(409, 'INVALID_STATE', `This appointment is already ${appointment.status.toLowerCase().replace('_', ' ')}`);
  }
  if (env.ENFORCE_COMPLETION_TIMING && Date.now() < appointment.slotStart.getTime() + APPOINTMENT_RULES.noShowGraceMinutes * MINUTE_MS) {
    throw new AppError(409, 'TOO_EARLY', 'An appointment can only be marked no-show after its time slot has passed');
  }

  await prisma.$transaction(async (tx) => {
    const result = await tx.appointment.updateMany({
      where: { id, status: { in: ['BOOKED', 'CONFIRMED'] } },
      data: { status: 'NO_SHOW' },
    });
    if (result.count === 0) throw new AppError(409, 'INVALID_STATE', 'The appointment changed. Please refresh and try again');

    await recordAudit({ actorId: officer.id, action: 'APPOINTMENT_NO_SHOW', entityType: 'Appointment', entityId: id }, tx);
  });

  return getAppointmentDetail(id, 'EN', 'staff');
}