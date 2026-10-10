import type { TokenType } from '@prisma/client';
import { type DbClient, prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { hashPassword } from '../utils/password.js';
import { generateOpaqueToken, hashToken } from '../utils/tokens.js';
import { recordAudit } from './audit.service.js';
import { queueEmail } from './email.service.js';

const TOKEN_TTL_MS: Record<TokenType, number> = {
  EMAIL_VERIFY: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 30 * 60 * 1000,
  OFFICER_INVITE: 72 * 60 * 60 * 1000,
};

function buildLink(path: string, token: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/${path}?token=${encodeURIComponent(token)}`;
}

export async function createVerificationToken(
  userId: string,
  type: TokenType,
  db: DbClient = prisma,
): Promise<string> {
  const rawToken = generateOpaqueToken();

  // Only the newest link of each type works
  await db.verificationToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.verificationToken.create({
    data: {
      tokenHash: hashToken(rawToken),
      type,
      userId,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]),
    },
  });
  return rawToken;
}

export async function consumeVerificationToken(rawToken: string, type: TokenType, db: DbClient): Promise<string> {
  const invalid = new BadRequestError('This link is invalid or has expired');

  const stored = await db.verificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true },
  });
  if (!stored || stored.type !== type || stored.usedAt || stored.expiresAt <= new Date()) throw invalid;

  const claimed = await db.verificationToken.updateMany({
    where: { id: stored.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) throw invalid;

  return stored.userId;
}



export async function sendVerificationEmail(user: { id: string; email: string }, name: string): Promise<void> {
  try {
    const token = await createVerificationToken(user.id, 'EMAIL_VERIFY');
    queueEmail(
      { template: 'WELCOME_VERIFY', data: { name, verifyUrl: buildLink('verify-email', token), token } },
      { to: user.email, userId: user.id },
    );
  } catch (error) {
    logger.error({ err: error, userId: user.id }, 'Could not queue verification email');
  }
}

export async function verifyEmail(rawToken: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const userId = await consumeVerificationToken(rawToken, 'EMAIL_VERIFY', tx);
    await tx.user.update({ where: { id: userId }, data: { emailVerified: true } });
  });
}

export async function resendVerification(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
  if (!user) throw new NotFoundError('User not found');
  if (user.emailVerified) throw new BadRequestError('Email is already verified');
  await sendVerificationEmail(user, user.profile?.fullName ?? user.email);
}

// ── Password reset ──

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, include: { profile: true } });
  if (!user || !user.isActive) return; // same response either way, so emails can't be enumerated

  const token = await createVerificationToken(user.id, 'PASSWORD_RESET');
  queueEmail(
    {
      template: 'PASSWORD_RESET',
      data: {
        name: user.profile?.fullName ?? user.email,
        resetUrl: buildLink('reset-password', token),
        token,
        expiresMinutes: TOKEN_TTL_MS.PASSWORD_RESET / 60_000,
      },
    },
    { to: user.email, userId: user.id },
  );
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  // Hash before the transaction: bcrypt takes ~250ms and we should not hold a transaction open for it
  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    const userId = await consumeVerificationToken(rawToken, 'PASSWORD_RESET', tx);

    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, emailVerified: true }, // clicking the emailed link proves mailbox ownership
    });
    // Everyone who had a session (including a thief) must log in again with the new password
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit({ actorId: userId, action: 'PASSWORD_RESET', entityType: 'User', entityId: userId }, tx);
  });
}