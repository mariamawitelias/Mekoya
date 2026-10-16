import type { DocumentStatus } from '@prisma/client';
import { OPEN_STATUSES } from '../config/appointmentRules.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { HOUR_MS, toAddisDate, toAddisTime } from '../utils/time.js';
import { queueEmail } from './email.service.js';

const MIN_LEAD_MS = HOUR_MS;
const QUIET_AFTER_CONFIRMATION_MS = 2 * HOUR_MS;
const BATCH_SIZE = 100;
const REJECTED: DocumentStatus[] = ['AI_REJECTED', 'OFFICER_REJECTED'];

export async function sendDueReminders(now: Date = new Date()): Promise<number> {
  const earliest = new Date(now.getTime() + MIN_LEAD_MS);
  const latest = new Date(now.getTime() + env.REMINDER_HOURS_BEFORE * HOUR_MS);

  const due = await prisma.appointment.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      reminderSentAt: null,
      slotStart: { gte: earliest, lte: latest },
      user: { isActive: true },
    },
    orderBy: { slotStart: 'asc' },
    take: BATCH_SIZE,
    include: {
      service: true,
      office: true,
      user: { include: { profile: true } },
      documents: { where: { isCurrent: true }, select: { serviceRequirementId: true, status: true } },
    },
  });

  let sent = 0;
  for (const appointment of due) {
    try {
      const recentConfirmation = await prisma.emailLog.count({
        where: {
          appointmentId: appointment.id,
          template: 'APPOINTMENT_CONFIRMATION',
          createdAt: { gte: new Date(now.getTime() - QUIET_AFTER_CONFIRMATION_MS) },
        },
      });
      if (recentConfirmation > 0) continue; // picked up by a later run

      // Claim the reminder first. Only one run (or server instance) can flip reminderSentAt from null.
      const claimed = await prisma.appointment.updateMany({
        where: { id: appointment.id, reminderSentAt: null, status: { in: OPEN_STATUSES } },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 0) continue;

      try {
        const mandatory = await prisma.serviceRequirement.findMany({
          where: { serviceId: appointment.serviceId, isMandatory: true, requirement: { isActive: true } },
          include: { requirement: true },
        });
        const currentByItem = new Map(appointment.documents.map((doc) => [doc.serviceRequirementId, doc.status]));
        const missingDocs = mandatory
          .filter((link) => {
            const status = currentByItem.get(link.id);
            return status === undefined || REJECTED.includes(status);
          })
          .map((link) => link.requirement.nameEn);

        queueEmail(
          {
            template: 'APPOINTMENT_REMINDER',
            data: {
              name: appointment.user.profile?.fullName ?? appointment.user.email,
              serviceName: appointment.service.nameEn,
              officeName: appointment.office.nameEn,
              address: appointment.office.addressEn,
              date: toAddisDate(appointment.slotStart),
              time: toAddisTime(appointment.slotStart),
              missingDocs,
            },
          },
          { to: appointment.user.email, userId: appointment.userId, appointmentId: appointment.id },
        );
        sent += 1;
      } catch (error) {
        await prisma.appointment.updateMany({ where: { id: appointment.id }, data: { reminderSentAt: null } });
        throw error;
      }
    } catch (error) {
      logger.error({ err: error, appointmentId: appointment.id }, 'Could not send reminder');
    }
  }
  return sent;
}