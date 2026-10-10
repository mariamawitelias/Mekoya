import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import type { CreateStaffBody, ListUsersQuery } from '../schemas/user.schema.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { pageMeta, paginate } from '../utils/pagination.js';
import { hashPassword } from '../utils/password.js';
import { recordAudit } from './audit.service.js';
import { queueEmail } from './email.service.js';
import { buildLink, consumeVerificationToken, createVerificationToken, TOKEN_TTL_MS } from './verification.service.js';

const ROLE_LABELS: Record<string, string> = {
  OFFICER: 'Office Officer',
  CONTENT_ADMIN: 'Content Admin',
};

const INVITE_EXPIRES_HOURS = TOKEN_TTL_MS.OFFICER_INVITE / 3_600_000;

export async function createStaff(input: CreateStaffBody, actorId: string) {
  const role = await prisma.role.findUnique({ where: { name: input.role } });
  if (!role) throw new Error(`${input.role} role is missing. Run the database seed.`);

  let officeName: string | null = null;
  if (input.officeId) {
    const office = await prisma.office.findFirst({
      where: { id: input.officeId, isActive: true },
      select: { nameEn: true },
    });
    if (!office) throw new NotFoundError('Office not found or inactive');
    officeName = office.nameEn;
  }

  const { user, token } = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        passwordHash: null, // set by the person when they accept the invitation
        roleId: role.id,
        officeId: input.officeId ?? null,
        profile: { create: { fullName: input.fullName, phone: input.phone ?? null } },
      },
      select: { id: true, email: true },
    });
    const rawToken = await createVerificationToken(created.id, 'OFFICER_INVITE', tx);
    await recordAudit(
      {
        actorId,
        action: 'STAFF_CREATED',
        entityType: 'User',
        entityId: created.id,
        metadata: { role: input.role, officeId: input.officeId ?? null },
      },
      tx,
    );
    return { user: created, token: rawToken };
  });

  // After the commit, so we never email about an account that was rolled back
  queueEmail(
    {
      template: 'OFFICER_INVITE',
      data: {
        name: input.fullName,
        roleLabel: ROLE_LABELS[input.role] ?? input.role,
        officeName,
        inviteUrl: buildLink('accept-invite', token),
        token,
        expiresHours: INVITE_EXPIRES_HOURS,
      },
    },
    { to: user.email, userId: user.id },
  );

  return {
    id: user.id,
    email: user.email,
    fullName: input.fullName,
    role: input.role,
    officeId: input.officeId ?? null,
    status: 'INVITED' as const,
  };
}

export async function acceptInvite(rawToken: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password); // outside the transaction, bcrypt is slow

  await prisma.$transaction(async (tx) => {
    const userId = await consumeVerificationToken(rawToken, 'OFFICER_INVITE', tx);

    const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true } });
    if (!user?.isActive) throw new ForbiddenError('This account has been deactivated');

    await tx.user.update({ where: { id: userId }, data: { passwordHash, emailVerified: true } });
    await recordAudit({ actorId: userId, action: 'STAFF_INVITE_ACCEPTED', entityType: 'User', entityId: userId }, tx);
  });
}

export async function resendInvite(userId: string, actorId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true, office: true, profile: true },
  });
  if (!user) throw new NotFoundError('User not found');
  if (user.passwordHash || user.googleId) throw new BadRequestError('This user has already activated their account');
  if (!user.isActive) throw new BadRequestError('This account is deactivated');

  const token = await createVerificationToken(user.id, 'OFFICER_INVITE'); // revokes the previous link
  await recordAudit({ actorId, action: 'STAFF_INVITE_RESENT', entityType: 'User', entityId: user.id });

  queueEmail(
    {
      template: 'OFFICER_INVITE',
      data: {
        name: user.profile?.fullName ?? user.email,
        roleLabel: ROLE_LABELS[user.role.name] ?? user.role.name,
        officeName: user.office?.nameEn ?? null,
        inviteUrl: buildLink('accept-invite', token),
        token,
        expiresHours: INVITE_EXPIRES_HOURS,
      },
    },
    { to: user.email, userId: user.id },
  );
}

export async function listUsers(query: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: { name: query.role } } : {}),
    ...(query.isActive ? { isActive: query.isActive === 'true' } : {}),
    ...(query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' } },
            { profile: { fullName: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(query.page, query.limit),
      select: {
        id: true,
        email: true,
        isActive: true,
        emailVerified: true,
        officeId: true,
        createdAt: true,
        googleId: true,
        passwordHash: true, // read only to compute the status below, never returned
        role: { select: { name: true } },
        profile: { select: { fullName: true, phone: true } },
      },
    }),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.profile?.fullName ?? null,
    phone: row.profile?.phone ?? null,
    role: row.role.name,
    officeId: row.officeId,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt,
    status: !row.passwordHash && !row.googleId ? 'INVITED' : row.isActive ? 'ACTIVE' : 'DEACTIVATED',
  }));

  return { items, meta: pageMeta(total, query.page, query.limit) };
}

export async function setUserActive(targetId: string, isActive: boolean, actorId: string) {
  if (targetId === actorId) throw new ForbiddenError('You cannot change your own account status');

  const target = await prisma.user.findUnique({ where: { id: targetId }, include: { role: true } });
  if (!target) throw new NotFoundError('User not found');
  if (target.role.name === 'SUPER_ADMIN') throw new ForbiddenError('Super Admin accounts cannot be changed here');

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: targetId }, data: { isActive } });
    if (!isActive) {
      await tx.refreshToken.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await recordAudit(
      { actorId, action: isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', entityType: 'User', entityId: targetId },
      tx,
    );
  });

  return { id: targetId, isActive };
}