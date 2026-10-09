import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { signAccessToken } from '../utils/jwt.js';
import { generateOpaqueToken, hashToken } from '../utils/tokens.js';

export const userWithRoleInclude = {
  profile: true,
  role: { include: { permissions: { include: { permission: true } } } },
} satisfies Prisma.UserInclude;

export type UserWithRole = Prisma.UserGetPayload<{ include: typeof userWithRoleInclude }>;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export function getPermissionKeys(user: UserWithRole): string[] {
  return user.role.permissions.map((rp) => rp.permission.key);
}

export async function issueTokenPair(
  user: UserWithRole,
  options: { familyId?: string; userAgent?: string } = {},
): Promise<TokenPair> {
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role.name,
    permissions: getPermissionKeys(user),
    officeId: user.officeId,
  });

  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      familyId: options.familyId ?? randomUUID(),
      userId: user.id,
      expiresAt,
      userAgent: options.userAgent ?? null,
    },
  });

  return { accessToken, refreshToken };
}