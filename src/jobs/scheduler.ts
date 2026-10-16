import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { sendDueReminders } from '../services/reminder.service.js';

let running = false;

async function tick(): Promise<void> {
  if (running) return; // the previous run is still going, skip this tick
  running = true;
  try {
    const sent = await sendDueReminders();
    if (sent > 0) logger.info({ sent }, 'Reminder emails queued');
  } catch (error) {
    logger.error({ err: error }, 'Reminder job failed');
  } finally {
    running = false;
  }
}

export function startScheduler(): { stop: () => void } | null {
  if (!env.ENABLE_SCHEDULER || env.NODE_ENV === 'test') return null;

  const task = cron.schedule('*/15 * * * *', () => {
    void tick();
  });
  void tick();

  logger.info(`Reminder scheduler started (every 15 minutes, ${env.REMINDER_HOURS_BEFORE}h before the appointment)`);
  return { stop: () => void task.stop() };
}