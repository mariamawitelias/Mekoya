import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { createVerificationToken } from '../src/services/verification.service.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, bearer, http, loginAs, type Session, uniqueEmail, USERS } from './helpers.js';

let citizen: Session;
let officer: Session;
let contentAdmin: Session;
let superAdmin: Session;

const as = (session: Session) => ({ Authorization: bearer(session.token) });
const newService = () => ({ slug: `test-${randomUUID().slice(0, 8)}`, nameEn: 'Test Service', category: 'Test' });

beforeAll(async () => {
  citizen = await loginAs(USERS.citizen1);
  officer = await loginAs(USERS.officerBole);
  contentAdmin = await loginAs(USERS.contentAdmin);
  superAdmin = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { slug: { startsWith: 'test-' } } });
});

describe('permission checks (PBAC) on admin routes', () => {
  it('answers 401 without a token', async () => {
    expect((await http().post('/api/v1/admin/services').send(newService())).status).toBe(401);
  });

  it('answers 403 for citizens and officers', async () => {
    const asCitizen = await http().post('/api/v1/admin/services').set(as(citizen)).send(newService());
    expect(asCitizen.status).toBe(403);
    expect(asCitizen.body.error.code).toBe('FORBIDDEN');
    expect(asCitizen.body.error.message).toContain('service:manage');

    expect((await http().post('/api/v1/admin/services').set(as(officer)).send(newService())).status).toBe(403);
  });

  it('lets a content admin create a service and records who did it', async () => {
    const res = await http().post('/api/v1/admin/services').set(as(contentAdmin)).send(newService());

    expect(res.status).toBe(201);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'SERVICE_CREATED', entityId: res.body.data.id },
    });
    expect(audit?.actorId).toBe(contentAdmin.userId);
  });

  it('keeps user management and audit logs for the Super Admin only', async () => {
    const users = '/api/v1/admin/users';
    const audit = '/api/v1/admin/audit-logs';

    expect((await http().get(users).set(as(contentAdmin))).status).toBe(403);
    expect((await http().get(audit).set(as(contentAdmin))).status).toBe(403);
    expect((await http().get(users).set(as(superAdmin))).status).toBe(200);
    expect((await http().get(audit).set(as(superAdmin))).status).toBe(200);
  });
});

describe('staff accounts', () => {
  it('requires an office for an officer and refuses to create a Super Admin', async () => {
    const noOffice = await http().post('/api/v1/admin/users').set(as(superAdmin))
      .send({ email: uniqueEmail(), fullName: 'No Office', role: 'OFFICER' });
    expect(noOffice.status).toBe(400);

    const escalation = await http().post('/api/v1/admin/users').set(as(superAdmin))
      .send({ email: uniqueEmail(), fullName: 'Too Powerful', role: 'SUPER_ADMIN' });
    expect(escalation.status).toBe(400);
  });

  it('invites an officer who can log in only after accepting the invitation', async () => {
    const email = uniqueEmail();
    const password = 'Officer!Pass2026';

    const created = await http().post('/api/v1/admin/users').set(as(superAdmin))
      .send({ email, fullName: 'New Officer', role: 'OFFICER', officeId: 'office-arada' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('INVITED');

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).toBeNull();
    expect((await http().post('/api/v1/auth/login').send({ email, password })).status).toBe(401);

    const token = await createVerificationToken(stored.id, 'OFFICER_INVITE');
    const accepted = await http().post('/api/v1/auth/accept-invite').send({ token, password });
    expect(accepted.status).toBe(200);
    expect((await http().post('/api/v1/auth/accept-invite').send({ token, password })).status).toBe(400); // single use

    const session = await loginAs(email, password);
    const me = await http().get('/api/v1/auth/me').set(as(session));
    expect(me.body.data.role).toBe('OFFICER');
    expect(me.body.data.officeId).toBe('office-arada');
    expect(me.body.data.permissions).toContain('document:review');
  });
});

describe('public catalog', () => {
  it('lists services with pagination metadata', async () => {
    const res = await http().get('/api/v1/services?limit=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 2 });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(4);
  });

  it('returns Amharic names when asked, and falls back to English per field', async () => {
    const res = await http().get('/api/v1/services/svc-license-renewal').set('Accept-Language', 'am');

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('የመንጃ ፈቃድ እድሳት');
    expect(res.body.data.requirements.length).toBeGreaterThan(0);
  });

  it('rejects an invalid query with the standard error shape', async () => {
    const res = await http().get('/api/v1/services?limit=500');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(res.body.error.details[0]).toMatchObject({ location: 'query', path: 'limit' });
  });

  it('answers 404 for an unknown service and for an unknown route', async () => {
    expect((await http().get('/api/v1/services/does-not-exist')).status).toBe(404);
    const unknownRoute = await http().get('/api/v1/nope');
    expect(unknownRoute.status).toBe(404);
    expect(unknownRoute.body.success).toBe(false);
  });

  it('hides a deactivated service but keeps its data (soft delete)', async () => {
    const created = await http().post('/api/v1/admin/services').set(as(contentAdmin)).send(newService());
    const id = created.body.data.id as string;
    expect((await http().get(`/api/v1/services/${id}`)).status).toBe(200);

    expect((await http().delete(`/api/v1/admin/services/${id}`).set(as(contentAdmin))).status).toBe(200);

    expect((await http().get(`/api/v1/services/${id}`)).status).toBe(404);
    expect((await prisma.service.findUniqueOrThrow({ where: { id } })).isActive).toBe(false);
  });
});