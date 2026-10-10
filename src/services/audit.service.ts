import type { Prisma } from '@prisma/client';
import { type DbClient, prisma } from '../config/prisma.js';
import type { AuditQuery } from '../schemas/user.schema.js';
import { pageMeta, paginate } from '../utils/pagination.js';
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
export async function listAuditLogs(query: AuditQuery) {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(query.page, query.limit),
      include: { actor: { select: { id: true, email: true } } },
    }),
  ]);

  return { items, meta: pageMeta(total, query.page, query.limit) };
}