import { prisma } from '../config/prisma.js';
import type { LoginBody, RegisterBody } from '../schemas/auth.schema.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../utils/password.js';
import { issueTokenPair, userWithRoleInclude } from './token.service.js';
import { logger } from '../config/logger.js';
import { hashToken } from '../utils/tokens.js';
import { type TokenPair } from './token.service.js';

export async function register(input: RegisterBody) {
  const role = await prisma.role.findUnique({ where: { name: 'CITIZEN' } });
  if (!role) {
    throw new Error('CITIZEN role is missing. Run the database seed.');
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      roleId: role.id,
      profile: {
        create: {
          fullName: input.fullName,
          phone: input.phone ?? null,
          preferredLanguage: input.preferredLanguage,
        },
      },
    },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      profile: { select: { fullName: true, preferredLanguage: true } },
    },
  });
}

export async function login(input: LoginBody, userAgent?: string) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: userWithRoleInclude,
  });
  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.passwordHash || !passwordOk) {
    throw new UnauthorizedError('Invalid email or password');
  }
  if (!user.isActive) {
    throw new ForbiddenError('This account has been deactivated');
  }

  const tokens = await issueTokenPair(user, userAgent ? { userAgent } : {});

  return {
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      role: user.role.name,
      fullName: user.profile?.fullName ?? null,
      emailVerified: user.emailVerified,
    },
  };
}
async function revokeFamily(familyId: string): Promise<number> {
  const { count } = await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

async function handleReuse(stored: { id: string; familyId: string; userId: string }): Promise<never> {
  const revokedCount = await revokeFamily(stored.familyId);

  if (revokedCount > 0) {
    logger.warn({ userId: stored.userId, familyId: stored.familyId }, 'Refresh token reuse detected');
    await prisma.auditLog.create({
      data: {
        actorId: stored.userId,
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        entityType: 'RefreshToken',
        entityId: stored.id,
        metadata: { familyId: stored.familyId, revokedCount },
      },
    });
  }
  throw new UnauthorizedError('Session is no longer valid. Please log in again.');
}

export async function refresh(rawToken: string, userAgent?: string): Promise<TokenPair> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { include: userWithRoleInclude } },
  });

  if (!stored) throw new UnauthorizedError('Invalid refresh token');
  if (stored.revokedAt) return handleReuse(stored);

  if (stored.expiresAt <= new Date()) throw new UnauthorizedError('Refresh token expired');

  if (!stored.user.isActive) {
    await revokeFamily(stored.familyId);
    throw new ForbiddenError('This account has been deactivated');
  }

  const rotated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) return null;

    const pair = await issueTokenPair(stored.user, {
      familyId: stored.familyId,
      ...(userAgent ? { userAgent } : {}),
      client: tx,
    });
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { replacedById: pair.refreshTokenId },
    });
    return pair;
  });

  if (!rotated) return handleReuse(stored);

  return rotated;
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { familyId: true },
  });
  if (stored) await revokeFamily(stored.familyId);
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}