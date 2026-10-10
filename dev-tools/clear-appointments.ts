import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

prisma.appointment
  .deleteMany()
  .then((result) => console.log(`Deleted ${result.count} appointments`))
  .finally(() => prisma.$disconnect());