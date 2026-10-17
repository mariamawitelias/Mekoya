import type { AppointmentStatus, DocumentStatus } from '@prisma/client';
import type { DbClient } from '../config/prisma.js';
import { recordAudit } from './audit.service.js';

const APPROVED: DocumentStatus[] = ['AI_APPROVED', 'OFFICER_APPROVED'];

export async function syncAppointmentStatus(db: DbClient, appointmentId: string): Promise<AppointmentStatus | null> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appt-sync:${appointmentId}`}))`;
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { status: true, serviceId: true },
  });
  if (!appointment) return null;
  if (appointment.status !== 'BOOKED' && appointment.status !== 'CONFIRMED') return appointment.status;

  const mandatory = await db.serviceRequirement.findMany({
    where: { serviceId: appointment.serviceId, isMandatory: true, requirement: { isActive: true } },
    select: { id: true },
  });
  if (mandatory.length === 0) return appointment.status;

  const approved = await db.documentSubmission.count({
    where: {
      appointmentId,
      isCurrent: true,
      status: { in: APPROVED },
      serviceRequirementId: { in: mandatory.map((item) => item.id) },
    },
  });

  const target: AppointmentStatus = approved === mandatory.length ? 'CONFIRMED' : 'BOOKED';
  if (target === appointment.status) return target;

  const result = await db.appointment.updateMany({
    where: { id: appointmentId, status: appointment.status },
    data: { status: target },
  });
  if (result.count === 0) return appointment.status;

  await recordAudit(
    {
      actorId: null, // a system action, not a person
      action: target === 'CONFIRMED' ? 'APPOINTMENT_AUTO_CONFIRMED' : 'APPOINTMENT_UNCONFIRMED',
      entityType: 'Appointment',
      entityId: appointmentId,
    },
    db,
  );
  return target;
}