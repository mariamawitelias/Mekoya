import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { HOUR_MS } from '../src/utils/time.js';
import {
  bearer,
  bookingBody,
  type BookingBody,
  cleanTransactionalData,
  futureWeekend,
  futureWorkday,
  http,
  loginAs,
  type Session,
  uniqueEmail,
  USERS,
  waitFor,
} from './helpers.js';

let citizen1: Session;
let citizen2: Session;
let citizen3: Session;
let citizen4: Session;
let officerBole: Session;
let officerKirkos: Session;

const as = (session: Session) => ({ Authorization: bearer(session.token) });

function book(session: Session, body: BookingBody = bookingBody(), idempotencyKey?: string) {
  const req = http().post('/api/v1/appointments').set(as(session));
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send(body);
}

async function bookOk(session: Session, body: BookingBody = bookingBody()): Promise<string> {
  const res = await book(session, body);
  if (res.status !== 201) throw new Error(`Booking failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

beforeAll(async () => {
  citizen1 = await loginAs(USERS.citizen1);
  citizen2 = await loginAs(USERS.citizen2);
  citizen3 = await loginAs(USERS.citizen3);
  citizen4 = await loginAs(USERS.citizen4);
  officerBole = await loginAs(USERS.officerBole);
  officerKirkos = await loginAs(USERS.officerKirkos);
});

beforeEach(cleanTransactionalData);

describe('booking rules', () => {
  it('requires a verified email', async () => {
    const email = uniqueEmail();
    await http().post('/api/v1/auth/register').send({ email, password: 'Str0ng!Pass1', fullName: 'Unverified' });
    const session = await loginAs(email, 'Str0ng!Pass1');

    const res = await book(session);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('books a slot, writes an audit entry and sends a confirmation email in the background', async () => {
    const res = await book(citizen1);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('BOOKED');
    expect(res.body.data.time).toBe('08:30');
    expect(await prisma.auditLog.count({ where: { action: 'APPOINTMENT_BOOKED' } })).toBe(1);

    await waitFor(
      async () => (await prisma.emailLog.count({ where: { template: 'APPOINTMENT_CONFIRMATION', status: 'SENT' } })) === 1,
    );
  });

  it('is idempotent: the same Idempotency-Key returns the same appointment', async () => {
    const body = bookingBody();
    const first = await book(citizen1, body, 'double-tap-key-1');
    const second = await book(citizen1, body, 'double-tap-key-1');

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await prisma.appointment.count()).toBe(1);
  });

  it('rejects times outside the office schedule, weekends and unsupported offices', async () => {
    const badTime = await book(citizen1, bookingBody({ time: '08:45' }));
    expect(badTime.status).toBe(400);
    expect(badTime.body.error.details.allowedTimes).toContain('08:30');

    const weekend = await book(citizen1, bookingBody({ date: futureWeekend() }));
    expect(weekend.status).toBe(400);
    expect(weekend.body.error.code).toBe('OFFICE_CLOSED');

    const wrongOffice = await book(citizen1, bookingBody({ officeId: 'office-arada' })); // Arada does not offer licenses
    expect(wrongOffice.status).toBe(404);
  });

  it('limits a citizen to two active appointments per service', async () => {
    const date = futureWorkday();
    expect((await book(citizen1, bookingBody({ date, time: '08:30' }))).status).toBe(201);
    expect((await book(citizen1, bookingBody({ date, time: '09:30' }))).status).toBe(201);

    const third = await book(citizen1, bookingBody({ date, time: '10:30' }));
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('LIMIT_REACHED');
  });

  it('blocks two appointments at the same time', async () => {
    const date = futureWorkday();
    await bookOk(citizen1, bookingBody({ date, time: '08:30' }));

    const clash = await book(citizen1, bookingBody({ serviceId: 'svc-trade-renewal', date, time: '08:30' }));
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('TIME_CONFLICT');
  });
});

describe('slot capacity', () => {
  it('never books more people than the slot capacity, even under simultaneous requests', async () => {
    const body = bookingBody({ time: '14:00' });
    const results = await Promise.all([citizen1, citizen2, citizen3, citizen4].map((session) => book(session, body)));

    expect(results.map((res) => res.status).sort()).toEqual([201, 201, 201, 409]);
    expect(results.find((res) => res.status === 409)?.body.error.code).toBe('SLOT_FULL');
    expect(await prisma.appointment.count({ where: { status: 'BOOKED' } })).toBe(3);
  });

  it('reports availability on the public slots endpoint', async () => {
    const body = bookingBody();
    await bookOk(citizen1, body);

    const res = await http().get(`/api/v1/offices/office-bole/slots?date=${body.date}&serviceId=${body.serviceId}`);
    expect(res.status).toBe(200);
    const slot = (res.body.data.slots as Array<{ time: string; booked: number; available: number }>).find((s) => s.time === '08:30');
    expect(slot).toMatchObject({ booked: 1, available: 2 });
  });
});

describe('citizen ownership (ABAC)', () => {
  it("stops one citizen from reading or cancelling another citizen's appointment", async () => {
    const id = await bookOk(citizen1);

    expect((await http().get(`/api/v1/appointments/${id}`).set(as(citizen2))).status).toBe(403);
    expect((await http().patch(`/api/v1/appointments/${id}/cancel`).set(as(citizen2))).status).toBe(403);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe('BOOKED');

    expect((await http().get(`/api/v1/appointments/${id}`).set(as(citizen1))).status).toBe(200);
    expect((await http().get(`/api/v1/appointments/${id}`)).status).toBe(401);
    expect((await http().get('/api/v1/appointments/00000000-0000-0000-0000-000000000000').set(as(citizen1))).status).toBe(404);
  });

  it('cancels once and refuses a second cancel', async () => {
    const id = await bookOk(citizen1);

    const first = await http().patch(`/api/v1/appointments/${id}/cancel`).set(as(citizen1));
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('CANCELLED');

    const second = await http().patch(`/api/v1/appointments/${id}/cancel`).set(as(citizen1));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVALID_STATE');
  });

  it('refuses to cancel less than 12 hours before the slot', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: USERS.citizen1 } });
    const soon = await prisma.appointment.create({
      data: {
        userId: owner.id,
        officeId: 'office-bole',
        serviceId: 'svc-license-renewal',
        slotStart: new Date(Date.now() + 3 * HOUR_MS),
      },
    });

    const res = await http().patch(`/api/v1/appointments/${soon.id}/cancel`).set(as(citizen1));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_LATE');
  });

  it('reschedules to another slot and records the change', async () => {
    const body = bookingBody();
    const id = await bookOk(citizen1, body);

    const res = await http().patch(`/api/v1/appointments/${id}/reschedule`).set(as(citizen1)).send({ date: body.date, time: '10:30' });
    expect(res.status).toBe(200);
    expect(res.body.data.time).toBe('10:30');
    expect(await prisma.auditLog.count({ where: { action: 'APPOINTMENT_RESCHEDULED', entityId: id } })).toBe(1);
  });
});

describe('officer office scope (ABAC)', () => {
  it("stops an officer from opening another office's appointment", async () => {
    const id = await bookOk(citizen1); // a Bole appointment

    const wrongOffice = await http().get(`/api/v1/officer/appointments/${id}`).set(as(officerKirkos));
    expect(wrongOffice.status).toBe(403);
    expect(wrongOffice.body.error.message).toContain('different office');

    const rightOffice = await http().get(`/api/v1/officer/appointments/${id}`).set(as(officerBole));
    expect(rightOffice.status).toBe(200);
    expect(rightOffice.body.data.citizen.email).toBe(USERS.citizen1);
  });

  it("shows each officer only their own office's queue", async () => {
    const body = bookingBody();
    const id = await bookOk(citizen1, body);

    const bole = await http().get(`/api/v1/officer/appointments?date=${body.date}`).set(as(officerBole));
    const kirkos = await http().get(`/api/v1/officer/appointments?date=${body.date}`).set(as(officerKirkos));

    expect((bole.body.data as Array<{ id: string }>).map((item) => item.id)).toContain(id);
    expect(kirkos.body.data).toHaveLength(0);
  });

  it('keeps citizens out of officer routes', async () => {
    const res = await http().get('/api/v1/officer/appointments').set(as(citizen1));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('appointment:view-office');
  });

  it('lets only the right officer complete a confirmed appointment, once', async () => {
    const id = await bookOk(citizen1);
    const complete = (session: Session) =>
      http().patch(`/api/v1/officer/appointments/${id}/complete`).set(as(session)).send({ closureNote: 'Checked at the counter' });

    const tooSoon = await complete(officerBole);
    expect(tooSoon.status).toBe(409);

    await prisma.appointment.update({ where: { id }, data: { status: 'CONFIRMED' } });

    expect((await complete(officerKirkos)).status).toBe(403);

    const done = await complete(officerBole);
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');

    expect((await complete(officerBole)).status).toBe(409);
  });
});