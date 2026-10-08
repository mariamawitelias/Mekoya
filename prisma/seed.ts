import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const BCRYPT_COST = 12;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function requireRoleId(roleIds: Record<string, string>, name: string): string {
  const roleId = roleIds[name];
  if (!roleId) {
    throw new Error(`Missing seeded role: ${name}`);
  }
  return roleId;
}

// ───────────── 1. Permissions and roles ─────────────

const ALL_PERMISSIONS = [
  'appointment:book',
  'appointment:view-own',
  'document:upload',
  'ai:use',
  'appointment:view-office',
  'appointment:complete',
  'document:review',
  'service:manage',
  'office:manage',
  'requirement:manage',
  'source-document:manage',
  'user:manage',
  'audit:read',
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  CITIZEN: ['appointment:book', 'appointment:view-own', 'document:upload', 'ai:use'],
  OFFICER: ['appointment:view-office', 'appointment:complete', 'document:review'],
  CONTENT_ADMIN: ['service:manage', 'office:manage', 'requirement:manage', 'source-document:manage'],
  SUPER_ADMIN: ALL_PERMISSIONS,
};

async function seedAccessControl(): Promise<Record<string, string>> {
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }

  const roleIds: Record<string, string> = {};
  for (const [name, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    roleIds[name] = role.id;

    const permissions = await prisma.permission.findMany({ where: { key: { in: keys } } });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      }),
    ]);
  }
  return roleIds;
}

// ───────────── 2. Catalog (SAMPLE DATA, not official guidance) ─────────────

const SLOT_TIMES = ['08:30', '09:30', '10:30', '11:30', '14:00', '15:00'];

const OFFICES = [
  { id: 'office-bole', nameEn: 'Bole Service Center (sample)', city: 'Addis Ababa' },
  { id: 'office-kirkos', nameEn: 'Kirkos Service Center (sample)', city: 'Addis Ababa' },
  { id: 'office-arada', nameEn: 'Arada Service Center (sample)', city: 'Addis Ababa' },
];

const REQUIREMENTS = [
  { id: 'req-photo', nameEn: 'Passport-size photo', nameAm: 'ፓስፖርት መጠን ያለው ፎቶ', expectedType: 'PASSPORT_PHOTO' },
  { id: 'req-id', nameEn: 'ID card copy', nameAm: 'የመታወቂያ ካርድ ኮፒ', expectedType: 'NATIONAL_ID' },
  { id: 'req-old-license', nameEn: "Previous driver's license", expectedType: 'DRIVING_LICENSE' },
  { id: 'req-medical', nameEn: 'Medical certificate', expectedType: 'MEDICAL_CERTIFICATE' },
  { id: 'req-address', nameEn: 'Proof of address', expectedType: 'PROOF_OF_ADDRESS' },
  { id: 'req-trade-license', nameEn: 'Previous trade license', expectedType: 'TRADE_LICENSE' },
  { id: 'req-lease', nameEn: 'Premises lease or ownership document', expectedType: 'LEASE_DOCUMENT' },
  { id: 'req-birth-notice', nameEn: 'Birth notification from health facility', expectedType: 'BIRTH_NOTIFICATION' },
];

type SeedService = {
  id: string;
  slug: string;
  nameEn: string;
  nameAm?: string;
  category: string;
  descriptionEn?: string;
  requirements: [requirementId: string, isMandatory: boolean][];
  officeIds: string[];
};

const SERVICES: SeedService[] = [
  {
    id: 'svc-license-renewal',
    slug: 'drivers-license-renewal',
    nameEn: "Driver's License Renewal",
    nameAm: 'የመንጃ ፈቃድ እድሳት',
    category: 'Transport',
    descriptionEn: "Renew an expiring driver's license.",
    requirements: [['req-photo', true], ['req-id', true], ['req-old-license', true], ['req-medical', true]],
    officeIds: ['office-bole', 'office-kirkos'],
  },
  {
    id: 'svc-trade-renewal',
    slug: 'trade-license-renewal',
    nameEn: 'Trade License Renewal',
    nameAm: 'የንግድ ፈቃድ እድሳት',
    category: 'Business',
    descriptionEn: 'Renew an existing business license.',
    requirements: [['req-id', true], ['req-trade-license', true], ['req-lease', true], ['req-photo', false]],
    officeIds: ['office-bole', 'office-kirkos'],
  },
  {
    id: 'svc-tin',
    slug: 'tin-registration',
    nameEn: 'TIN Registration',
    nameAm: 'የግብር ከፋይ መለያ ቁጥር ምዝገባ',
    category: 'Tax',
    descriptionEn: 'Register for a taxpayer identification number.',
    requirements: [['req-id', true], ['req-photo', true], ['req-address', true]],
    officeIds: ['office-bole', 'office-arada'],
  },
  {
    id: 'svc-birth-cert',
    slug: 'birth-certificate',
    nameEn: 'Birth Certificate Request',
    nameAm: 'የልደት የምስክር ወረቀት',
    category: 'Civil',
    descriptionEn: 'Request a birth certificate for a child.',
    requirements: [['req-birth-notice', true], ['req-id', true]],
    officeIds: ['office-arada'],
  },
];

async function seedCatalog(): Promise<void> {
  for (const office of OFFICES) {
    await prisma.office.upsert({
      where: { id: office.id },
      update: {},
      create: { ...office, slotTimes: SLOT_TIMES },
    });
  }

  for (const requirement of REQUIREMENTS) {
    await prisma.requirement.upsert({ where: { id: requirement.id }, update: {}, create: requirement });
  }

  for (const { requirements, officeIds, ...service } of SERVICES) {
    await prisma.service.upsert({ where: { id: service.id }, update: {}, create: service });

    for (const [requirementId, isMandatory] of requirements) {
      await prisma.serviceRequirement.upsert({
        where: { serviceId_requirementId: { serviceId: service.id, requirementId } },
        update: {},
        create: { serviceId: service.id, requirementId, isMandatory },
      });
    }

    for (const officeId of officeIds) {
      await prisma.officeService.upsert({
        where: { officeId_serviceId: { officeId, serviceId: service.id } },
        update: {},
        create: { officeId, serviceId: service.id, slotCapacity: 3 },
      });
    }
  }
}


async function upsertUser(input: {
  email: string;
  password: string;
  fullName: string;
  roleId: string;
  officeId?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const officeId = input.officeId ?? null;

  return prisma.user.upsert({
    where: { email: input.email },
    update: {},
    create: {
      email: input.email,
      passwordHash,
      emailVerified: true,
      roleId: input.roleId,
      officeId,
      profile: { create: { fullName: input.fullName } },
    },
  });
}

async function main() {
  const adminEmail = requireEnv('SEED_ADMIN_EMAIL');
  const adminPassword = requireEnv('SEED_ADMIN_PASSWORD');
  const demoPassword = requireEnv('SEED_DEMO_PASSWORD');

  const roleIds = await seedAccessControl();
  await seedCatalog(); // offices must exist before officers reference them

  const superAdminRoleId = requireRoleId(roleIds, 'SUPER_ADMIN');
  const contentAdminRoleId = requireRoleId(roleIds, 'CONTENT_ADMIN');
  const officerRoleId = requireRoleId(roleIds, 'OFFICER');
  const citizenRoleId = requireRoleId(roleIds, 'CITIZEN');

  await upsertUser({ email: adminEmail, password: adminPassword, fullName: 'Super Admin', roleId: superAdminRoleId });
  await upsertUser({ email: 'content.admin@mekoya.test', password: demoPassword, fullName: 'Content Admin', roleId: contentAdminRoleId });
  await upsertUser({ email: 'officer.bole@mekoya.test', password: demoPassword, fullName: 'Officer Bole', roleId: officerRoleId, officeId: 'office-bole' });
  await upsertUser({ email: 'officer.kirkos@mekoya.test', password: demoPassword, fullName: 'Officer Kirkos', roleId: officerRoleId, officeId: 'office-kirkos' });
  await upsertUser({ email: 'citizen1@mekoya.test', password: demoPassword, fullName: 'Sample Citizen One', roleId: citizenRoleId });
  await upsertUser({ email: 'citizen2@mekoya.test', password: demoPassword, fullName: 'Sample Citizen Two', roleId: citizenRoleId });

  console.log('Seed complete');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());