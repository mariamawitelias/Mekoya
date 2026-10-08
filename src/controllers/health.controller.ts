import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { ok } from '../utils/response.js';

export async function getHealth(_req: Request, res: Response): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
  ok(res, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
}