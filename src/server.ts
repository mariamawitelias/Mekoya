import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { resumePendingReviews } from './services/documentReview.service.js';

const server = app.listen(env.PORT, () => {
  logger.info(`Mekoya API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
void resumePendingReviews().catch((error: unknown) => {
  logger.error({ err: error }, 'Could not resume pending AI reviews');
});
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));