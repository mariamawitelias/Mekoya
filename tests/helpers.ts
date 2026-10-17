import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { DAY_MS, isWorkingDay, toAddisDate } from '../src/utils/time.js';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const http = () => request(app);

export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo!Pass2026';
export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@mekoya.test';
export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';

export const USERS = {
  citizen1: 'citizen1@mekoya.test',
  citizen2: 'citizen2@mekoya.test',
  citizen3: 'citizen3@mekoya.test',
  citizen4: 'citizen4@mekoya.test',
  officerBole: 'officer.bole@mekoya.test',
  officerKirkos: 'officer.kirkos@mekoya.test',
  contentAdmin: 'content.admin@mekoya.test',
} as const;

export const bearer = (token: string): string => `Bearer ${token}`;
export const uniqueEmail = (): string => `t${randomUUID().slice(0, 8)}@mekoya.test`;
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface Session {
  token: string;
  cookie: string;
  userId: string;
}

export function cookieFrom(res: Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((value) => value.startsWith('refreshToken='));
  if (!cookie) throw new Error('The response did not set a refresh cookie');
  return cookie.split(';')[0]!;
}

export async function loginAs(email: string, password: string = DEMO_PASSWORD): Promise<Session> {
  const res = await http().post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    token: res.body.data.accessToken as string,
    cookie: cookieFrom(res),
    userId: res.body.data.user.id as string,
  };
}

export async function createVerifiedCitizen() {
  const email = uniqueEmail();
  const password = 'Str0ng!Pass1';
  const res = await http().post('/api/v1/auth/register').send({ email, password, fullName: 'Test Citizen' });
  if (res.status !== 201) throw new Error(`Register failed: ${res.status} ${JSON.stringify(res.body)}`);
  await prisma.user.update({ where: { email }, data: { emailVerified: true } });
  return { email, password, ...(await loginAs(email, password)) };
}

export async function cleanTransactionalData(): Promise<void> {
  await sleep(200);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Appointment", "DocumentSubmission", "RefreshToken", "VerificationToken", "EmailLog", "AuditLog" RESTART IDENTITY CASCADE',
  );
    rmSync(path.resolve(process.env.UPLOAD_DIR ?? 'uploads'), { recursive: true, force: true });
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`Condition not met within ${timeoutMs} ms`);
}

function futureDate(minDaysAhead: number, workday: boolean): string {
  for (let days = minDaysAhead; days < minDaysAhead + 14; days++) {
    const date = toAddisDate(new Date(Date.now() + days * DAY_MS));
    if (isWorkingDay(date) === workday) return date;
  }
  throw new Error('No matching date found');
}
export const futureWorkday = (minDaysAhead = 3): string => futureDate(minDaysAhead, true);
export const futureWeekend = (minDaysAhead = 3): string => futureDate(minDaysAhead, false);

export interface BookingBody {
  officeId: string;
  serviceId: string;
  date: string;
  time: string;
}

export function bookingBody(overrides: Partial<BookingBody> = {}): BookingBody {
  return { officeId: 'office-bole', serviceId: 'svc-license-renewal', date: futureWorkday(), time: '08:30', ...overrides };
}
export const auth = (session: Session) => ({ Authorization: bearer(session.token) });
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
export const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

export function uploadedFiles(): string[] {
  const dir = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');
  return existsSync(dir) ? readdirSync(dir) : [];
}

export async function bookFor(session: Session, overrides: Partial<BookingBody> = {}): Promise<string> {
  const res = await http().post('/api/v1/appointments').set(auth(session)).send(bookingBody(overrides));
  if (res.status !== 201) throw new Error(`Booking failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

export async function checklistOf(session: Session, appointmentId: string) {
  const res = await http().get(`/api/v1/appointments/${appointmentId}`).set(auth(session));
  return res.body.data.checklist as Array<{ id: string; name: string; isMandatory: boolean }>;
}

export function upload(
  session: Session,
  appointmentId: string,
  itemId: string,
  filename: string,
  content: Buffer = PNG_BYTES,
  contentType = 'image/png',
) {
  return http()
    .post(`/api/v1/appointments/${appointmentId}/documents`)
    .set(auth(session))
    .field('serviceRequirementId', itemId)
    .attach('file', content, { filename, contentType });
}