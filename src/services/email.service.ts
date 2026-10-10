import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { type EmailMessage, renderEmail } from '../utils/emailTemplates.js';

interface Recipient {
  to: string;
  userId?: string;
  appointmentId?: string;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 1_000, 3_000] as const;

let transporterPromise: Promise<Transporter> | undefined;

async function createTransporter(): Promise<Transporter> {
  if (env.NODE_ENV === 'test') {
    return nodemailer.createTransport({ jsonTransport: true }); // no network in tests
  }

  if (env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('SMTP_HOST is required in production');
  }

  const account = await nodemailer.createTestAccount();
  logger.info({ inbox: account.user }, 'Using Ethereal test inbox (emails are captured, not delivered)');
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
}

function getTransporter(): Promise<Transporter> {
  transporterPromise ??= createTransporter().catch((error: unknown) => {
    transporterPromise = undefined;
    throw error;
  });
  return transporterPromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deliverEmail(message: EmailMessage, recipient: Recipient): Promise<void> {
  const log = await prisma.emailLog.create({
    data: {
      toEmail: recipient.to,
      template: message.template,
      ...(recipient.userId !== undefined ? { userId: recipient.userId } : {}),
      ...(recipient.appointmentId !== undefined ? { appointmentId: recipient.appointmentId } : {}),
    },
    select: { id: true },
  });

  const { subject, html, text } = renderEmail(message);
  let lastError = 'Unknown error';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt - 1] ?? 0;
    if (delay > 0 && env.NODE_ENV !== 'test') await sleep(delay);

    try {
      const transporter = await getTransporter();
      const info = await transporter.sendMail({ from: env.EMAIL_FROM, to: recipient.to, subject, html, text });

      await prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'SENT', attempts: attempt, sentAt: new Date(), error: null },
      });

      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) logger.info({ template: message.template, previewUrl }, 'Email sent. Open the preview URL to view it');
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await prisma.emailLog.update({ where: { id: log.id }, data: { attempts: attempt, error: lastError } });
    }
  }

  await prisma.emailLog.update({ where: { id: log.id }, data: { status: 'FAILED' } });
  logger.error({ template: message.template, error: lastError }, 'Email failed after all attempts');
}


export function queueEmail(message: EmailMessage, recipient: Recipient): void {
  void deliverEmail(message, recipient).catch((error: unknown) => {
    logger.error({ err: error, template: message.template }, 'Email dispatch crashed');
  });
}