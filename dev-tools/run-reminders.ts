import 'dotenv/config';
import { prisma } from '../src/config/prisma.js';
import { sendDueReminders } from '../src/services/reminder.service.js';

async function main(): Promise<void> {
  if (process.argv.includes('--backdate')) {
    await prisma.emailLog.updateMany({
      where: { template: 'APPOINTMENT_CONFIRMATION' },
      data: { createdAt: new Date(Date.now() - 3 * 3_600_000) },
    });
  }

  const sent = await sendDueReminders();
  console.log(`Reminders queued: ${sent}`);
  await new Promise((resolve) => setTimeout(resolve, 9_000));
}

main().finally(() => prisma.$disconnect());