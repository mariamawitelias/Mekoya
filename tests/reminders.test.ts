import { randomUUID } from 'node:crypto';
import type { AppointmentStatus, DocumentStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import * as emailService from '../src/services/email.service.js';
import { sendDueReminders } from '../src/services/reminder.service.js';
import type { EmailMessage } from '../src/utils/emailTemplates.js';
import { HOUR_MS } from '../src/utils/time.js';
import { cleanTransactionalData, createVerifiedCitizen, USERS } from './helpers.js';

let queued: EmailMessage[];

beforeEach(async () => {
  await cleanTransactionalData();
  queued = [];
  vi.spyOn(emailService, 'queueEmail').mockImplementation((message) => {
    queued.push(message);
  });
});

afterEach(() => vi.restoreAllMocks());

async function createAppointment(hoursAhead: number, options: { status?: AppointmentStatus; userId?: string } = {}) {
  const userId = options.userId ?? (await prisma.user.findUniqueOrThrow({ where: { email: USERS.citizen1 } })).id;
  return prisma.appointment.create({
    data: {
      userId,
      officeId: 'office-bole',
      serviceId: 'svc-license-renewal',
      slotStart: new Date(Date.now() + hoursAhead * HOUR_MS),
      status: options.status ?? 'BOOKED',
    },
  });
}

function reminderData(message: EmailMessage | undefined) {
  if (!message || message.template !== 'APPOINTMENT_REMINDER') throw new Error('Expected a reminder email');
  return message.data;
}

describe('which appointments get a reminder', () => {
  it('sends one reminder for an appointment inside the window, and never a second', async () => {
    const appointment = await createAppointment(5);

    expect(await sendDueReminders()).toBe(1);
    expect(reminderData(queued[0]).serviceName).toBe("Driver's License Renewal");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).reminderSentAt).not.toBeNull();

    expect(await sendDueReminders()).toBe(0);
    expect(queued).toHaveLength(1);
  });

  it('skips appointments that are too far away, too close, or no longer active', async () => {
    await createAppointment(48); // outside the 24 hour window
    await createAppointment(0.5); // less than an hour away
    await createAppointment(5, { status: 'CANCELLED' });
    await createAppointment(6, { status: 'COMPLETED' });

    expect(await sendDueReminders()).toBe(0);
    expect(queued).toHaveLength(0);
  });

  it('skips deactivated users', async () => {
    const user = await createVerifiedCitizen();
    await prisma.user.update({ where: { id: user.userId }, data: { isActive: false } });
    await createAppointment(5, { userId: user.userId });

    expect(await sendDueReminders()).toBe(0);
  });

  it('waits when the booking confirmation was sent a moment ago', async () => {
    const appointment = await createAppointment(5);
    const log = await prisma.emailLog.create({
      data: { toEmail: USERS.citizen1, template: 'APPOINTMENT_CONFIRMATION', appointmentId: appointment.id, status: 'SENT' },
    });

    expect(await sendDueReminders()).toBe(0);

    await prisma.emailLog.update({ where: { id: log.id }, data: { createdAt: new Date(Date.now() - 3 * HOUR_MS) } });
    expect(await sendDueReminders()).toBe(1);
  });

  it('sends exactly one reminder even when two runs overlap', async () => {
    await createAppointment(5);

    const [first, second] = await Promise.all([sendDueReminders(), sendDueReminders()]);

    expect(first + second).toBe(1);
    expect(queued).toHaveLength(1);
  });
});

describe('what the reminder says', () => {
  it('lists only the mandatory documents that are missing or rejected', async () => {
    const appointment = await createAppointment(5);
    const items = await prisma.serviceRequirement.findMany({
      where: { serviceId: 'svc-license-renewal', isMandatory: true },
      include: { requirement: true },
      orderBy: { id: 'asc' },
    });
    expect(items).toHaveLength(4);

    const attach = (itemId: string, status: DocumentStatus) =>
      prisma.documentSubmission.create({
        data: {
          appointmentId: appointment.id,
          serviceRequirementId: itemId,
          filePath: `${randomUUID()}.png`,
          originalName: 'x.png',
          mimeType: 'image/png',
          sizeBytes: 10,
          status,
        },
      });
    await attach(items[0]!.id, 'AI_APPROVED'); // fine
    await attach(items[1]!.id, 'OFFICER_REJECTED'); // must be re-uploaded
    await attach(items[2]!.id, 'PENDING'); // uploaded, awaiting review: not missing
    // items[3] has no document at all

    await sendDueReminders();

    const missing = reminderData(queued[0]).missingDocs.slice().sort();
    expect(missing).toEqual([items[1]!.requirement.nameEn, items[3]!.requirement.nameEn].sort());
  });

  it('lists every mandatory document when nothing has been uploaded', async () => {
    await createAppointment(5);
    await sendDueReminders();

    expect(reminderData(queued[0]).missingDocs).toHaveLength(4);
  });
});