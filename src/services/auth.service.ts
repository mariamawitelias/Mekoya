import { prisma } from '../config/prisma.js';
import type { LoginBody, RegisterBody } from '../schemas/auth.schema.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../utils/password.js';
import { issueTokenPair, userWithRoleInclude } from './token.service.js';

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