import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import * as emailService from '../src/services/email.service.js';
import { createVerificationToken } from '../src/services/verification.service.js';
import {
  bearer,
  cleanTransactionalData,
  cookieFrom,
  createVerifiedCitizen,
  DEMO_PASSWORD,
  http,
  loginAs,
  uniqueEmail,
  USERS,
} from './helpers.js';

const PASSWORD = 'Str0ng!Pass1';
const register = (body: Record<string, unknown>) => http().post('/api/v1/auth/register').send(body);
const login = (email: string, password: string) => http().post('/api/v1/auth/login').send({ email, password });
const refresh = (cookie: string) => http().post('/api/v1/auth/refresh').set('Cookie', cookie);

beforeEach(cleanTransactionalData);

describe('registration', () => {
  it('creates a citizen and never leaks secrets', async () => {
    const email = uniqueEmail();
    const res = await register({ email, password: PASSWORD, fullName: 'New Citizen' });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe(email);
    expect(res.body.data.emailVerified).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const stored = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
    expect(stored.role.name).toBe('CITIZEN');
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, cost factor 12
  });

  it('ignores a role sent in the request body', async () => {
    const email = uniqueEmail();
    await register({ email, password: PASSWORD, fullName: 'Sneaky User', role: 'SUPER_ADMIN' });

    const stored = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
    expect(stored.role.name).toBe('CITIZEN');
  });

  it('rejects a weak password and reports every invalid field', async () => {
    const res = await register({ email: uniqueEmail(), password: 'weak', fullName: 'T' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = (res.body.error.details as Array<{ path: string }>).map((issue) => issue.path);
    expect(paths).toContain('password');
    expect(paths).toContain('fullName');
    expect(paths.filter((path) => path === 'password').length).toBeGreaterThan(1);
  });

  it('rejects a duplicate email, even in a different letter case', async () => {
    const email = uniqueEmail();
    await register({ email, password: PASSWORD, fullName: 'First User' });
    const again = await register({ email: email.toUpperCase(), password: PASSWORD, fullName: 'Second User' });

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
  });

  it('still succeeds when the email service is broken', async () => {
    const spy = vi.spyOn(emailService, 'queueEmail').mockImplementation(() => {
      throw new Error('SMTP is down');
    });
    try {
      const res = await register({ email: uniqueEmail(), password: PASSWORD, fullName: 'Resilient User' });
      expect(res.status).toBe(201);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('login', () => {
  it('returns an access token and sets an httpOnly SameSite=Strict refresh cookie', async () => {
    const res = await login(USERS.citizen1, DEMO_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toContain('refreshToken'); // the refresh token only travels in the cookie

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((value) => value.startsWith('refreshToken='));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('stores only a hash of the refresh token', async () => {
    const res = await login(USERS.citizen1, DEMO_PASSWORD);
    const rawToken = cookieFrom(res).split('=')[1];

    const rows = await prisma.refreshToken.findMany({ where: { userId: res.body.data.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(rawToken);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await login(USERS.citizen1, 'Wrong!Pass123');
    const unknownEmail = await login('nobody@mekoya.test', 'Wrong!Pass123');

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('blocks a deactivated account', async () => {
    const user = await createVerifiedCitizen();
    await prisma.user.update({ where: { email: user.email }, data: { isActive: false } });

    const res = await login(user.email, user.password);
    expect(res.status).toBe(403);
  });
});

describe('access token', () => {
  it('protects /me and returns the role permissions', async () => {
    expect((await http().get('/api/v1/auth/me')).status).toBe(401);
    expect((await http().get('/api/v1/auth/me').set('Authorization', bearer('not.a.token'))).status).toBe(401);

    const { token } = await loginAs(USERS.citizen1);
    const me = await http().get('/api/v1/auth/me').set('Authorization', bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBe('CITIZEN');
    expect(me.body.data.permissions).toEqual(expect.arrayContaining(['appointment:book', 'document:upload', 'ai:use']));
  });
});

describe('refresh token rotation', () => {
  it('rotates the token on every refresh', async () => {
    const { cookie: first } = await loginAs(USERS.citizen1);
    const rotated = await refresh(first);

    expect(rotated.status).toBe(200);
    expect(rotated.body.data.accessToken).toEqual(expect.any(String));
    expect(cookieFrom(rotated)).not.toBe(first);
  });

  it('detects reuse of an old token and revokes the whole token family', async () => {
    const { cookie: first, userId } = await loginAs(USERS.citizen1);
    const rotated = await refresh(first);
    const second = cookieFrom(rotated);

    const replay = await refresh(first); // an attacker (or a stale client) replays the old token
    expect(replay.status).toBe(401);

    const legitimate = await refresh(second); // even the newest token is now dead
    expect(legitimate.status).toBe(401);

    const tokens = await prisma.refreshToken.findMany({ where: { userId } });
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(tokens.every((token: { revokedAt: Date | null }) => token.revokedAt !== null)).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'REFRESH_TOKEN_REUSE_DETECTED', actorId: userId } });
    expect(audit).not.toBeNull();
  });

  it('lets only one of two simultaneous refreshes with the same token win', async () => {
    const { cookie } = await loginAs(USERS.citizen1);
    const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);

    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it('rejects a missing or made-up cookie', async () => {
    expect((await http().post('/api/v1/auth/refresh')).status).toBe(401);
    expect((await refresh('refreshToken=not-a-real-token')).status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const { cookie } = await loginAs(USERS.citizen1);
    const out = await http().post('/api/v1/auth/logout').set('Cookie', cookie);

    expect(out.status).toBe(200);
    expect((await refresh(cookie)).status).toBe(401);
  });
});

describe('password reset and email verification', () => {
  it('resets the password, ends old sessions and works only once', async () => {
    const user = await createVerifiedCitizen();
    const token = await createVerificationToken(user.userId, 'PASSWORD_RESET');

    const reset = await http().post('/api/v1/auth/reset-password').send({ token, newPassword: 'NewPassw0rd!2' });
    expect(reset.status).toBe(200);

    expect((await refresh(user.cookie)).status).toBe(401); // the old session is gone
    expect((await login(user.email, user.password)).status).toBe(401); // the old password is dead
    expect((await login(user.email, 'NewPassw0rd!2')).status).toBe(200);

    const replay = await http().post('/api/v1/auth/reset-password').send({ token, newPassword: 'Another!Pass3' });
    expect(replay.status).toBe(400); // single use
  });

  it('verifies the email only with a token of the right type', async () => {
    const email = uniqueEmail();
    await register({ email, password: PASSWORD, fullName: 'Verify Me' });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const wrongType = await createVerificationToken(user.id, 'PASSWORD_RESET');
    expect((await http().post('/api/v1/auth/verify-email').send({ token: wrongType })).status).toBe(400);

    const rightType = await createVerificationToken(user.id, 'EMAIL_VERIFY');
    expect((await http().post('/api/v1/auth/verify-email').send({ token: rightType })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified).toBe(true);
  });
});