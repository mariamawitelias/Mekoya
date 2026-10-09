import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { signAccessToken } from '../utils/jwt.js';
import { generateOpaqueToken, hashToken } from '../utils/tokens.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
}

export const userWithRoleInclude = {
  profile: true,
  role: { include: { permissions: { include: { permission: true } } } },
} satisfies Prisma.UserInclude;

export type UserWithRole = Prisma.UserGetPayload<{ include: typeof userWithRoleInclude }>;

function getPermissionKeys(user: UserWithRole): string[] {
  return user.role.permissions.map((rolePermission) => rolePermission.permission.key);
}

export async function issueTokenPair(
  user: UserWithRole,
  options: { familyId?: string; userAgent?: string; client?: DbClient } = {},
): Promise<TokenPair> {
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role.name,
    permissions: getPermissionKeys(user),
    officeId: user.officeId,
  });

  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const db = options.client ?? prisma;

  const created = await db.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      familyId: options.familyId ?? randomUUID(),
      userId: user.id,
      expiresAt,
      userAgent: options.userAgent ?? null,
    },
    select: { id: true },
  });

  return { accessToken, refreshToken, refreshTokenId: created.id };
}