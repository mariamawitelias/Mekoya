import type { AppointmentStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../@types/express/index.js';
import { APPOINTMENT_RULES, CAPACITY_STATUSES, OPEN_STATUSES } from '../config/appointmentRules.js';
import { logger } from '../config/logger.js';
import { type DbClient, prisma } from '../config/prisma.js';
import type {
  CreateAppointmentBody,
  MyAppointmentsQuery,
  RescheduleBody,
  SlotsQuery,
} from '../schemas/appointment.schema.js';
import { canAccessOwnedResource } from '../utils/access.js';
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { type Lang, pick, pickOptional } from '../utils/language.js';
import { pageMeta, paginate } from '../utils/pagination.js';
import { addisDayRange, DAY_MS, HOUR_MS, isWorkingDay, MINUTE_MS, slotToUtc, toAddisDate, toAddisTime } from '../utils/time.js';
import { recordAudit } from './audit.service.js';
import { queueEmail } from './email.service.js';

const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 };

export const appointmentInclude = { service: true, office: true } satisfies Prisma.AppointmentInclude;
export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;


export function toAppointmentDto(appointment: AppointmentWithRelations, lang: Lang) {
  return {
    id: appointment.id,
    status: appointment.status,
    slotStart: appointment.slotStart.toISOString(),
    date: toAddisDate(appointment.slotStart),
    time: toAddisTime(appointment.slotStart),
    service: { id: appointment.service.id, name: pick(lang, appointment.service.nameEn, appointment.service.nameAm) },
    office: {
      id: appointment.office.id,
      name: pick(lang, appointment.office.nameEn, appointment.office.nameAm),
      address: pickOptional(lang, appointment.office.addressEn, appointment.office.addressAm),
      city: appointment.office.city,
    },
    closureNote: appointment.closureNote,
    cancelledAt: appointment.cancelledAt,
    createdAt: appointment.createdAt,
  };
}

async function acquireLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

const userLockKey = (userId: string): string => `user:${userId}`;
const slotLockKey = (officeId: string, serviceId: string, slotStart: Date): string =>
  `slot:${officeId}:${serviceId}:${slotStart.toISOString()}`;

function assertOpen(status: AppointmentStatus): void {
  if (!OPEN_STATUSES.includes(status)) {
    throw new AppError(409, 'INVALID_STATE', `This appointment is already ${status.toLowerCase().replace('_', ' ')}`);
  }
}

function assertBeforeCutoff(slotStart: Date): void {
  const hoursLeft = (slotStart.getTime() - Date.now()) / HOUR_MS;
  if (hoursLeft < APPOINTMENT_RULES.cancelCutoffHours) {
    throw new AppError(
      409,
      'TOO_LATE',
      `Appointments can only be changed up to ${APPOINTMENT_RULES.cancelCutoffHours} hours before the time slot`,
    );
  }
}

interface SlotRequest {
  officeId: string;
  serviceId: string;
  date: string;
  time: string;
}

// Checks everything about a requested slot that does not depend on other people's bookings
async function resolveSlot(request: SlotRequest): Promise<{ slotStart: Date; capacity: number }> {
  const link = await prisma.officeService.findFirst({
    where: {
      officeId: request.officeId,
      serviceId: request.serviceId,
      office: { isActive: true },
      service: { isActive: true },
    },
    include: { office: { select: { slotTimes: true } } },
  });
  if (!link) throw new NotFoundError('This office does not offer this service');

  if (!link.office.slotTimes.includes(request.time)) {
    throw new BadRequestError('That is not an available time at this office', { allowedTimes: link.office.slotTimes });
  }
  if (!isWorkingDay(request.date)) {
    throw new AppError(400, 'OFFICE_CLOSED', 'Offices are closed on weekends. Please choose a weekday');
  }

  const slotStart = slotToUtc(request.date, request.time);
  const now = Date.now();
  if (slotStart.getTime() < now + APPOINTMENT_RULES.minLeadMinutes * MINUTE_MS) {
    throw new AppError(400, 'SLOT_TOO_SOON', `Appointments must be booked at least ${APPOINTMENT_RULES.minLeadMinutes} minutes ahead`);
  }
  if (slotStart.getTime() > now + APPOINTMENT_RULES.maxAdvanceDays * DAY_MS) {
    throw new AppError(400, 'SLOT_TOO_FAR', `Appointments can be booked at most ${APPOINTMENT_RULES.maxAdvanceDays} days ahead`);
  }

  return { slotStart, capacity: link.slotCapacity };
}

function countTaken(db: DbClient, officeId: string, serviceId: string, slotStart: Date, excludeId?: string) {
  return db.appointment.count({
    where: {
      officeId,
      serviceId,
      slotStart,
      status: { in: CAPACITY_STATUSES },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

async function assertUserLimits(
  db: DbClient,
  userId: string,
  serviceId: string,
  slotStart: Date,
  excludeId?: string,
): Promise<void> {
  const exclude = excludeId ? { id: { not: excludeId } } : {};

  const sameService = await db.appointment.count({
    where: { userId, serviceId, status: { in: OPEN_STATUSES }, slotStart: { gt: new Date() }, ...exclude },
  });
  if (sameService >= APPOINTMENT_RULES.maxOpenPerService) {
    throw new AppError(
      409,
      'LIMIT_REACHED',
      `You can have at most ${APPOINTMENT_RULES.maxOpenPerService} active appointments for the same service`,
    );
  }

  const sameTime = await db.appointment.count({
    where: { userId, slotStart, status: { in: OPEN_STATUSES }, ...exclude },
  });
  if (sameTime > 0) {
    throw new AppError(409, 'TIME_CONFLICT', 'You already have another appointment at this time');
  }
}

async function sendConfirmationEmail(
  appointment: AppointmentWithRelations,
  recipient: { id: string; email: string; name: string },
  isReschedule: boolean,
): Promise<void> {
  try {
    const links = await prisma.serviceRequirement.findMany({
      where: { serviceId: appointment.serviceId, requirement: { isActive: true } },
      include: { requirement: true },
      orderBy: { isMandatory: 'desc' },
    });

    queueEmail(
      {
        template: 'APPOINTMENT_CONFIRMATION',
        data: {
          name: recipient.name,
          serviceName: appointment.service.nameEn,
          officeName: appointment.office.nameEn,
          address: appointment.office.addressEn,
          date: toAddisDate(appointment.slotStart),
          time: toAddisTime(appointment.slotStart),
          mandatoryDocs: links.filter((link) => link.isMandatory).map((link) => link.requirement.nameEn),
          optionalDocs: links.filter((link) => !link.isMandatory).map((link) => link.requirement.nameEn),
          isReschedule,
        },
      },
      { to: recipient.email, userId: recipient.id, appointmentId: appointment.id },
    );
  } catch (error) {
    // The appointment is already committed, so an email problem must not fail the request
    logger.error({ err: error, appointmentId: appointment.id }, 'Could not queue appointment email');
  }
}


export async function getSlots(officeId: string, query: SlotsQuery) {
  const link = await prisma.officeService.findFirst({
    where: { officeId, serviceId: query.serviceId, office: { isActive: true }, service: { isActive: true } },
    include: { office: { select: { slotTimes: true } } },
  });
  if (!link) throw new NotFoundError('This office does not offer this service');

  if (!isWorkingDay(query.date)) return { date: query.date, open: false, slots: [] };

  const { start, end } = addisDayRange(query.date);
  const counts = await prisma.appointment.groupBy({
    by: ['slotStart'],
    where: { officeId, serviceId: query.serviceId, slotStart: { gte: start, lt: end }, status: { in: CAPACITY_STATUSES } },
    _count: { _all: true },
  });
  const takenBySlot = new Map(counts.map((row) => [row.slotStart.getTime(), row._count._all]));

  const now = Date.now();
  const earliest = now + APPOINTMENT_RULES.minLeadMinutes * MINUTE_MS;
  const latest = now + APPOINTMENT_RULES.maxAdvanceDays * DAY_MS;

  const slots = link.office.slotTimes.map((time) => {
    const startsAt = slotToUtc(query.date, time);
    const booked = takenBySlot.get(startsAt.getTime()) ?? 0;
    const available = Math.max(0, link.slotCapacity - booked);
    const inWindow = startsAt.getTime() >= earliest && startsAt.getTime() <= latest;
    return {
      time,
      startsAt: startsAt.toISOString(),
      capacity: link.slotCapacity,
      booked,
      available,
      bookable: inWindow && available > 0,
    };
  });

  return { date: query.date, open: true, timezone: 'Africa/Addis_Ababa (UTC+3)', slots };
}


export async function bookAppointment(userId: string, input: CreateAppointmentBody, idempotencyKey: string | undefined) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
  if (!user || !user.isActive) throw new ForbiddenError('This account is not active');
  if (!user.emailVerified) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email before booking an appointment');
  }

  const { slotStart, capacity } = await resolveSlot(input);

  const { appointment, created } = await prisma.$transaction(async (tx) => {
    // Always take locks in the same order (user, then slot) so two requests can never deadlock
    await acquireLock(tx, userLockKey(userId));
    await acquireLock(tx, slotLockKey(input.officeId, input.serviceId, slotStart));

    if (idempotencyKey) {
      const existing = await tx.appointment.findFirst({
        where: { userId, idempotencyKey },
        include: appointmentInclude,
      });
      if (existing) return { appointment: existing, created: false };
    }

    const taken = await countTaken(tx, input.officeId, input.serviceId, slotStart);
    if (taken >= capacity) throw new AppError(409, 'SLOT_FULL', 'This time slot is full. Please choose another');

    await assertUserLimits(tx, userId, input.serviceId, slotStart);

    const booked = await tx.appointment.create({
      data: {
        userId,
        officeId: input.officeId,
        serviceId: input.serviceId,
        slotStart,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      },
      include: appointmentInclude,
    });
    await recordAudit(
      {
        actorId: userId,
        action: 'APPOINTMENT_BOOKED',
        entityType: 'Appointment',
        entityId: booked.id,
        metadata: { officeId: input.officeId, serviceId: input.serviceId, slotStart: slotStart.toISOString() },
      },
      tx,
    );
    return { appointment: booked, created: true };
  }, TX_OPTIONS);

  if (created) {
    await sendConfirmationEmail(
      appointment,
      { id: user.id, email: user.email, name: user.profile?.fullName ?? user.email },
      false,
    );
  }
  return { appointment, created };
}


export async function cancelAppointment(id: string, actor: AuthUser) {
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment) throw new NotFoundError('Appointment not found');
  if (!canAccessOwnedResource(actor, appointment.userId)) throw new ForbiddenError('You can only change your own appointments');
  assertOpen(appointment.status);
  assertBeforeCutoff(appointment.slotStart);

  return prisma.$transaction(async (tx) => {
    // Only succeeds if the status is still open, even if an officer changed it a moment ago
    const result = await tx.appointment.updateMany({
      where: { id, status: { in: OPEN_STATUSES } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (result.count === 0) throw new AppError(409, 'INVALID_STATE', 'This appointment can no longer be cancelled');

    await recordAudit({ actorId: actor.id, action: 'APPOINTMENT_CANCELLED', entityType: 'Appointment', entityId: id }, tx);
    return tx.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude });
  });
}

export async function rescheduleAppointment(id: string, actor: AuthUser, input: RescheduleBody) {
  const current = await prisma.appointment.findUnique({
    where: { id },
    include: { service: true, office: true, user: { include: { profile: true } } },
  });
  if (!current) throw new NotFoundError('Appointment not found');
  if (!canAccessOwnedResource(actor, current.userId)) throw new ForbiddenError('You can only change your own appointments');
  assertOpen(current.status);
  assertBeforeCutoff(current.slotStart);

  const target = { officeId: input.officeId ?? current.officeId, serviceId: current.serviceId, date: input.date, time: input.time };
  const { slotStart, capacity } = await resolveSlot(target);

  if (target.officeId === current.officeId && slotStart.getTime() === current.slotStart.getTime()) {
    throw new BadRequestError('That is already your appointment time');
  }

  const updated = await prisma.$transaction(async (tx) => {
    await acquireLock(tx, userLockKey(current.userId));
    await acquireLock(tx, slotLockKey(target.officeId, target.serviceId, slotStart));

    const fresh = await tx.appointment.findUnique({ where: { id }, select: { status: true } });
    if (!fresh || !OPEN_STATUSES.includes(fresh.status)) {
      throw new AppError(409, 'INVALID_STATE', 'This appointment can no longer be changed');
    }

    // Exclude this appointment, so moving to a slot you already hold a seat in is not blocked by yourself
    const taken = await countTaken(tx, target.officeId, target.serviceId, slotStart, id);
    if (taken >= capacity) throw new AppError(409, 'SLOT_FULL', 'This time slot is full. Please choose another');
    await assertUserLimits(tx, current.userId, target.serviceId, slotStart, id);

    const result = await tx.appointment.update({
      where: { id },
      data: { officeId: target.officeId, slotStart, reminderSentAt: null }, // the reminder must fire again for the new time
      include: appointmentInclude,
    });
    await recordAudit(
      {
        actorId: actor.id,
        action: 'APPOINTMENT_RESCHEDULED',
        entityType: 'Appointment',
        entityId: id,
        metadata: {
          from: { officeId: current.officeId, slotStart: current.slotStart.toISOString() },
          to: { officeId: target.officeId, slotStart: slotStart.toISOString() },
        },
      },
      tx,
    );
    return result;
  }, TX_OPTIONS);

  await sendConfirmationEmail(
    updated,
    { id: current.user.id, email: current.user.email, name: current.user.profile?.fullName ?? current.user.email },
    true,
  );
  return updated;
}

export async function listMyAppointments(userId: string, query: MyAppointmentsQuery, lang: Lang) {
  const upcoming = query.upcoming === 'true';
  const where: Prisma.AppointmentWhereInput = {
    userId,
    ...(query.status ? { status: query.status } : {}),
    ...(upcoming ? { slotStart: { gte: new Date() } } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: { slotStart: upcoming ? 'asc' : 'desc' },
      ...paginate(query.page, query.limit),
    }),
  ]);

  return { items: rows.map((row) => toAppointmentDto(row, lang)), meta: pageMeta(total, query.page, query.limit) };
}

// One appointment with its checklist and the current document for each checklist item
export async function getAppointmentDetail(id: string, lang: Lang, view: 'citizen' | 'staff') {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      service: {
        include: {
          requirements: {
            where: { requirement: { isActive: true } },
            include: { requirement: true },
            orderBy: { isMandatory: 'desc' },
          },
        },
      },
      office: true,
      user: { select: { email: true, profile: { select: { fullName: true, phone: true } } } },
      documents: { where: { isCurrent: true } },
    },
  });
  if (!appointment) throw new NotFoundError('Appointment not found');

  const documentByItem = new Map(appointment.documents.map((doc) => [doc.serviceRequirementId, doc]));

  const checklist = appointment.service.requirements.map((link) => {
    const doc = documentByItem.get(link.id);
    return {
      id: link.id, // uploads attach to this id
      name: pick(lang, link.requirement.nameEn, link.requirement.nameAm),
      isMandatory: link.isMandatory,
      notes: pickOptional(lang, link.notesEn, link.notesAm),
      // filePath is deliberately never returned: it is a server location
      document: doc
        ? {
            id: doc.id,
            status: doc.status,
            rejectionReason: doc.rejectionReason,
            originalName: doc.originalName,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            appealRequested: doc.appealRequested,
            uploadedAt: doc.createdAt,
            ...(view === 'staff'
              ? { aiStatus: doc.aiStatus, aiConfidence: doc.aiConfidence, aiResult: doc.aiResult, reviewNote: doc.reviewNote }
              : {}),
          }
        : null,
    };
  });

  return {
    ...toAppointmentDto(appointment, lang),
    checklist,
    ...(view === 'staff'
      ? {
          citizen: {
            email: appointment.user.email,
            fullName: appointment.user.profile?.fullName ?? null,
            phone: appointment.user.profile?.phone ?? null,
          },
        }
      : {}),
  };
}