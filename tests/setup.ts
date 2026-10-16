import { afterAll } from 'vitest';
import { prisma } from '../src/config/prisma.js';

if (!/test/i.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Tests must run against a test database');
}

afterAll(async () => {
  await prisma.$disconnect();
});