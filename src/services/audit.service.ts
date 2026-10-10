import type { Prisma } from '@prisma/client';
import { type DbClient, prisma } from '../config/prisma.js';

interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

export async function recordAudit(entry: AuditEntry, db: DbClient = prisma): Promise<void> {
  await db.auditLog.create({ data: entry });
}