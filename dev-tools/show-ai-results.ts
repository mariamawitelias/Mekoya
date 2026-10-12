import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const docs = await prisma.documentSubmission.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { serviceRequirement: { include: { requirement: true } } },
  });

  for (const doc of docs.reverse()) {
    console.log(`\n${doc.originalName}  (checked as ${doc.serviceRequirement.requirement.expectedType}, v${doc.version})`);
    console.log(`  status=${doc.status}  ai=${doc.aiStatus}  confidence=${doc.aiConfidence ?? '-'}`);
    if (doc.rejectionReason) console.log(`  reason: ${doc.rejectionReason}`);
    console.log(`  result: ${JSON.stringify(doc.aiResult)}`);
  }
}

main().finally(() => prisma.$disconnect());