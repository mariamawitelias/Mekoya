import { type Prisma, PrismaClient } from '@prisma/client';
import { env } from './env.js';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});