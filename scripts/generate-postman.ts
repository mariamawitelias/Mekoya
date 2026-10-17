import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openApiDocument } from '../src/docs/openapi.js';

type Json = Record<string, unknown>;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const ROLE_VARS = {
  none: null,
  citizen: 'citizenToken',
  citizen2: 'citizen2Token',
  unverified: 'unverifiedToken',
  bole: 'officerBoleToken',
  kirkos: 'officerKirkosToken',
  content: 'contentAdminToken',
  admin: 'adminToken',
} as const;
type Role = keyof typeof ROLE_VARS;

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo!Pass2026';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@mekoya.test';
const SAMPLE_FILE = 'postman/sample-document.png';
const TEXT_FILE = 'postman/not-allowed.txt';

const script = (listen: 'test' | 'prerequest', lines: string[]): Json => ({
  listen,
  script: { type: 'text/javascript', exec: lines },
});

function buildUrl(path: string): Json {
  const [pathname = '', queryString] = path.split('?');
  const query = queryString
    ? queryString.split('&').map((pair) => {
        const [key, value] = pair.split('=');
        return { key, value };
      })
    : [];
  return {
    raw: `{{baseUrl}}${path}`,
    host: ['{{baseUrl}}'],
    path: pathname.split('/').filter(Boolean),
    ...(query.length > 0 ? { query } : {}),
  };
}

function authFor(role: Role): Json {
  const variable = ROLE_VARS[role];
  return variable
    ? { type: 'bearer', bearer: [{ key: 'token', value: `{{${variable}}}`, type: 'string' }] }
    : { type: 'noauth' };
}

interface Step {
  name: string;
  method: Method;
  path: string;
  as: Role;
  expect: number;
  body?: unknown;
  form?: Array<{ key: string; value?: string; file?: string }>;
  headers?: Record<string, string>;
  checks?: Array<[title: string, expression: string]>; // expressions can use `json`
  save?: Record<string, string>;
  pre?: string[];
  raw?: string[]; // extra test script lines, run before the checks
  note?: string;
}

function step(s: Step): Json {
  const tests = [
    'const json = (() => { try { return pm.response.json(); } catch (e) { return {}; } })();',
    `pm.test('Status is ${s.expect}', () => pm.response.to.have.status(${s.expect}));`,
    ...(s.raw ?? []),
    ...(s.checks ?? []).map(([title, expression]) => `pm.test(${JSON.stringify(title)}, () => pm.expect(Boolean(${expression})).to.be.true);`),
    ...Object.entries(s.save ?? {}).map(
      ([name, expression]) => `if (pm.response.code === ${s.expect}) { pm.collectionVariables.set('${name}', ${expression}); }`,
    ),
  ];

  const headers = Object.entries({
    ...(s.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(s.headers ?? {}),
  }).map(([key, value]) => ({ key, value }));

  const body = s.form
    ? {
        mode: 'formdata',
        formdata: s.form.map((field) =>
          field.file ? { key: field.key, type: 'file', src: field.file } : { key: field.key, value: field.value, type: 'text' },
        ),
      }
    : s.body === undefined
      ? undefined
      : { mode: 'raw', raw: JSON.stringify(s.body, null, 2), options: { raw: { language: 'json' } } };

  return {
    name: s.name,
    event: [...(s.pre ? [script('prerequest', s.pre)] : []), script('test', tests)],
    request: {
      method: s.method.toUpperCase(),
      header: headers,
      url: buildUrl(s.path),
      auth: authFor(s.as),
      ...(body ? { body } : {}),
      ...(s.note ? { description: s.note } : {}),
    },
  };
}

const folder = (name: string, description: string, item: Json[]): Json => ({ name, description, item });

// Reads the refresh cookie from a response so the reuse scenario can replay it later
const grabCookie = (variable: string): string[] => [
  "const setCookie = String(pm.response.headers.get('Set-Cookie') || '');",
  `const cookieMatch = setCookie.match(/refreshToken=([^;]+)/);`,
  `if (cookieMatch) { pm.collectionVariables.set('${variable}', cookieMatch[1]); }`,
];

const SETUP_SCRIPT = [
  'const day = (n) => new Date(Date.now() + n * 86400000);',
  'const iso = (d) => d.toISOString().slice(0, 10);',
  'let n = 5; while ([0, 6].includes(day(n).getUTCDay())) { n++; }',
  "pm.collectionVariables.set('bookingDate', iso(day(n)));",
  'let w = 3; while (day(w).getUTCDay() !== 6) { w++; }',
  "pm.collectionVariables.set('weekendDate', iso(day(w)));",
  'const stamp = Date.now();',
  "pm.collectionVariables.set('idemKey', 'postman-' + stamp);",
  "pm.collectionVariables.set('newEmail', 'pm' + stamp + '@mekoya.test');",
  "pm.collectionVariables.set('staffEmail', 'staff' + stamp + '@mekoya.test');",
  "pm.collectionVariables.set('newSlug', 'postman-' + stamp);",
];

const bookingBody = (extra: Json = {}): Json => ({
  officeId: 'office-bole',
  serviceId: 'svc-license-renewal',
  date: '{{bookingDate}}',
  time: '08:30',
  ...extra,
});

// ───────────────────────── Scenarios ─────────────────────────

const setup = folder('1. Setup: log in as every role', 'Run this folder first. It stores an access token for each demo user in collection variables.', [
  step({ name: 'Login: citizen1', method: 'post', path: '/auth/login', as: 'none', expect: 200, pre: SETUP_SCRIPT, body: { email: 'citizen1@mekoya.test', password: '{{demoPassword}}' }, save: { citizenToken: 'json.data.accessToken' }, checks: [['Returns an access token', 'typeof json.data.accessToken === "string"']] }),
  step({ name: 'Login: citizen2', method: 'post', path: '/auth/login', as: 'none', expect: 200, body: { email: 'citizen2@mekoya.test', password: '{{demoPassword}}' }, save: { citizen2Token: 'json.data.accessToken' } }),
  step({ name: 'Login: officer (Bole office)', method: 'post', path: '/auth/login', as: 'none', expect: 200, body: { email: 'officer.bole@mekoya.test', password: '{{demoPassword}}' }, save: { officerBoleToken: 'json.data.accessToken' }, checks: [['Role is OFFICER', 'json.data.user.role === "OFFICER"']] }),
  step({ name: 'Login: officer (Kirkos office)', method: 'post', path: '/auth/login', as: 'none', expect: 200, body: { email: 'officer.kirkos@mekoya.test', password: '{{demoPassword}}' }, save: { officerKirkosToken: 'json.data.accessToken' } }),
  step({ name: 'Login: content admin', method: 'post', path: '/auth/login', as: 'none', expect: 200, body: { email: 'content.admin@mekoya.test', password: '{{demoPassword}}' }, save: { contentAdminToken: 'json.data.accessToken' } }),
  step({ name: 'Login: Super Admin', method: 'post', path: '/auth/login', as: 'none', expect: 200, body: { email: '{{adminEmail}}', password: '{{adminPassword}}' }, save: { adminToken: 'json.data.accessToken' }, checks: [['Role is SUPER_ADMIN', 'json.data.user.role === "SUPER_ADMIN"']], note: 'Set the adminPassword collection variable to SEED_ADMIN_PASSWORD from your .env first.' }),
]);

const auth = folder('2. Auth', 'Registration, validation errors, token handling, refresh token rotation with reuse detection, and logout.', [
  step({ name: 'Register a new citizen (201)', method: 'post', path: '/auth/register', as: 'none', expect: 201, body: { email: '{{newEmail}}', password: 'Str0ng!Pass1', fullName: 'Postman Citizen', preferredLanguage: 'EN' }, checks: [['Email is not verified yet', 'json.data.emailVerified === false'], ['No password hash in the response', 'pm.response.text().indexOf("passwordHash") === -1']] }),
  step({ name: 'Register with a weak password (400)', method: 'post', path: '/auth/register', as: 'none', expect: 400, body: { email: 'weak@mekoya.test', password: 'weak', fullName: 'T' }, checks: [['Error code is VALIDATION_ERROR', 'json.error.code === "VALIDATION_ERROR"'], ['The password field is reported', 'json.error.details.some((d) => d.path === "password")'], ['The name field is reported too', 'json.error.details.some((d) => d.path === "fullName")']] }),
  step({ name: 'Register the same email again (409)', method: 'post', path: '/auth/register', as: 'none', expect: 409, body: { email: '{{newEmail}}', password: 'Str0ng!Pass1', fullName: 'Postman Citizen' }, checks: [['Error code is CONFLICT', 'json.error.code === "CONFLICT"']] }),
  step({ name: 'Login as the new, unverified user (200)', method: 'post', path: '/auth/login', as: 'none', expect: 200, body: { email: '{{newEmail}}', password: 'Str0ng!Pass1' }, save: { unverifiedToken: 'json.data.accessToken' }, checks: [['Email is not verified', 'json.data.user.emailVerified === false']] }),
  step({ name: 'Login with a wrong password (401)', method: 'post', path: '/auth/login', as: 'none', expect: 401, body: { email: 'citizen1@mekoya.test', password: 'Wrong!Pass123' } }),
  step({ name: 'Login with an unknown email (401, same message)', method: 'post', path: '/auth/login', as: 'none', expect: 401, body: { email: 'nobody@mekoya.test', password: 'Wrong!Pass123' }, checks: [['Gives nothing away about which emails exist', 'json.error.message === "Invalid email or password"']] }),
  step({ name: 'Who am I (200)', method: 'get', path: '/auth/me', as: 'citizen', expect: 200, checks: [['Role is CITIZEN', 'json.data.role === "CITIZEN"'], ['Has the booking permission', 'json.data.permissions.includes("appointment:book")']] }),
  step({ name: 'Who am I without a token (401)', method: 'get', path: '/auth/me', as: 'none', expect: 401 }),
  step({ name: 'Who am I with a garbage token (401)', method: 'get', path: '/auth/me', as: 'none', expect: 401, headers: { Authorization: 'Bearer not.a.real.token' } }),

  step({ name: 'Refresh demo, 1: log in (stores the refresh cookie)', method: 'post', path: '/auth/login', as: 'none', expect: 200, body: { email: 'citizen1@mekoya.test', password: '{{demoPassword}}' }, raw: grabCookie('oldRefresh'), checks: [['A refresh cookie was set', 'pm.collectionVariables.get("oldRefresh")'], ['The refresh token is not in the body', 'pm.response.text().indexOf("refreshToken") === -1']] }),
  step({ name: 'Refresh demo, 2: refresh (200, new token)', method: 'post', path: '/auth/refresh', as: 'none', expect: 200, raw: grabCookie('newRefresh'), checks: [['A new access token is returned', 'typeof json.data.accessToken === "string"'], ['The refresh cookie was rotated', 'pm.collectionVariables.get("newRefresh") !== pm.collectionVariables.get("oldRefresh")']] }),
  step({ name: 'Refresh demo, 3: replay the OLD cookie (401, reuse detected)', method: 'post', path: '/auth/refresh', as: 'none', expect: 401, headers: { Cookie: 'refreshToken={{oldRefresh}}' }, checks: [['The reason is not revealed', 'json.error.message.includes("no longer valid")']], note: 'This request sends the old cookie through an explicit Cookie header. If Postman also adds its own stored cookie and this returns 200, clear cookies for localhost in the Cookies manager and run again, or use the curl script. The automated test suite proves this scenario either way.' }),
  step({ name: 'Refresh demo, 4: the NEWEST cookie is dead too (401, family revoked)', method: 'post', path: '/auth/refresh', as: 'none', expect: 401, headers: { Cookie: 'refreshToken={{newRefresh}}' }, checks: [['The whole family was revoked', 'json.error.message.includes("no longer valid")']] }),

  step({ name: 'Logout demo, 1: log in', method: 'post', path: '/auth/login', as: 'none', expect: 200, body: { email: 'citizen2@mekoya.test', password: '{{demoPassword}}' }, raw: grabCookie('logoutRefresh') }),
  step({ name: 'Logout demo, 2: log out (200)', method: 'post', path: '/auth/logout', as: 'none', expect: 200, checks: [['Reports logged out', 'json.data.loggedOut === true']] }),
  step({ name: 'Logout demo, 3: the old cookie no longer refreshes (401)', method: 'post', path: '/auth/refresh', as: 'none', expect: 401, headers: { Cookie: 'refreshToken={{logoutRefresh}}' } }),
]);

const catalog = folder('3. Public catalog', 'No login needed.', [
  step({ name: 'List services (200, paginated)', method: 'get', path: '/services', as: 'none', expect: 200, checks: [['Returns services', 'json.data.length > 0'], ['Has pagination metadata', 'json.meta.total >= 4 && json.meta.page === 1']] }),
  step({ name: 'Search with a limit (200)', method: 'get', path: '/services?search=license&limit=2', as: 'none', expect: 200, checks: [['Respects the limit', 'json.data.length <= 2 && json.meta.limit === 2']] }),
  step({ name: 'Get one service with its checklist (200)', method: 'get', path: '/services/svc-license-renewal', as: 'none', expect: 200, checks: [['Has required documents', 'json.data.requirements.length > 0'], ['Lists offices', 'json.data.offices.length > 0']] }),
  step({ name: 'Same service in Amharic (200)', method: 'get', path: '/services/svc-license-renewal', as: 'none', expect: 200, headers: { 'Accept-Language': 'am' }, checks: [['Name comes back in Amharic', 'json.data.name === "የመንጃ ፈቃድ እድሳት"']] }),
  step({ name: 'Invalid limit (400)', method: 'get', path: '/services?limit=500', as: 'none', expect: 400, checks: [['Error code is VALIDATION_ERROR', 'json.error.code === "VALIDATION_ERROR"'], ['Names the field and where it was', 'json.error.details[0].location === "query" && json.error.details[0].path === "limit"']] }),
  step({ name: 'Unknown service (404)', method: 'get', path: '/services/does-not-exist', as: 'none', expect: 404, checks: [['Error code is NOT_FOUND', 'json.error.code === "NOT_FOUND"']] }),
  step({ name: 'Offices offering a service (200)', method: 'get', path: '/offices?serviceId=svc-tin', as: 'none', expect: 200, checks: [['Returns offices', 'json.data.length > 0']] }),
  step({ name: 'Free slots on a weekday (200)', method: 'get', path: '/offices/office-bole/slots?date={{bookingDate}}&serviceId=svc-license-renewal', as: 'none', expect: 200, checks: [['The office is open', 'json.data.open === true'], ['Six slots', 'json.data.slots.length === 6']] }),
  step({ name: 'Slots on a weekend (200, closed)', method: 'get', path: '/offices/office-bole/slots?date={{weekendDate}}&serviceId=svc-license-renewal', as: 'none', expect: 200, checks: [['Closed with no slots', 'json.data.open === false && json.data.slots.length === 0']] }),
]);

const booking = folder('4. Booking and ownership (ABAC)', 'Slot booking rules, idempotency, and citizens being unable to touch each other\'s appointments.', [
  step({ name: 'Book without a verified email (403)', method: 'post', path: '/appointments', as: 'unverified', expect: 403, body: bookingBody(), checks: [['Error code is EMAIL_NOT_VERIFIED', 'json.error.code === "EMAIL_NOT_VERIFIED"']] }),
  step({ name: 'Book without a token (401)', method: 'post', path: '/appointments', as: 'none', expect: 401, body: bookingBody() }),
  step({ name: 'Book an appointment (201)', method: 'post', path: '/appointments', as: 'citizen', expect: 201, headers: { 'Idempotency-Key': '{{idemKey}}' }, body: bookingBody(), save: { appointmentId: 'json.data.id' }, checks: [['Status is BOOKED', 'json.data.status === "BOOKED"'], ['Time is as requested', 'json.data.time === "08:30"']] }),
  step({ name: 'Repeat with the same Idempotency-Key (200, same appointment)', method: 'post', path: '/appointments', as: 'citizen', expect: 200, headers: { 'Idempotency-Key': '{{idemKey}}' }, body: bookingBody(), checks: [['Returns the same appointment', 'json.data.id === pm.collectionVariables.get("appointmentId")'], ['Marked as a replay', 'pm.response.headers.get("Idempotent-Replay") === "true"']] }),
  step({ name: 'A time the office does not offer (400)', method: 'post', path: '/appointments', as: 'citizen', expect: 400, body: bookingBody({ time: '08:45' }), checks: [['Lists the allowed times', 'json.error.details.allowedTimes.includes("08:30")']] }),
  step({ name: 'A weekend date (400)', method: 'post', path: '/appointments', as: 'citizen', expect: 400, body: bookingBody({ date: '{{weekendDate}}' }), checks: [['Error code is OFFICE_CLOSED', 'json.error.code === "OFFICE_CLOSED"']] }),
  step({ name: 'An office that does not offer the service (404)', method: 'post', path: '/appointments', as: 'citizen', expect: 404, body: bookingBody({ officeId: 'office-arada' }) }),
  step({ name: 'Another service at the same time (409)', method: 'post', path: '/appointments', as: 'citizen', expect: 409, body: bookingBody({ serviceId: 'svc-trade-renewal' }), checks: [['Error code is TIME_CONFLICT', 'json.error.code === "TIME_CONFLICT"']] }),
  step({ name: 'My appointments (200)', method: 'get', path: '/appointments/me?upcoming=true', as: 'citizen', expect: 200, checks: [['Contains the new appointment', 'json.data.some((a) => a.id === pm.collectionVariables.get("appointmentId"))']] }),
  step({ name: 'My appointment with its checklist (200)', method: 'get', path: '/appointments/{{appointmentId}}', as: 'citizen', expect: 200, save: { itemId0: 'json.data.checklist[0].id', itemId1: 'json.data.checklist[1].id', itemId2: 'json.data.checklist[2].id', itemId3: 'json.data.checklist[3].id' }, checks: [['Four mandatory documents', 'json.data.checklist.length === 4'], ['No document uploaded yet', 'json.data.checklist.every((item) => item.document === null)']] }),
  step({ name: 'IDOR: another citizen reads it (403)', method: 'get', path: '/appointments/{{appointmentId}}', as: 'citizen2', expect: 403, checks: [['Error code is FORBIDDEN', 'json.error.code === "FORBIDDEN"']] }),
  step({ name: 'IDOR: another citizen cancels it (403)', method: 'patch', path: '/appointments/{{appointmentId}}/cancel', as: 'citizen2', expect: 403 }),
  step({ name: 'Reschedule to 10:30 (200)', method: 'patch', path: '/appointments/{{appointmentId}}/reschedule', as: 'citizen', expect: 200, body: { date: '{{bookingDate}}', time: '10:30' }, checks: [['The time changed', 'json.data.time === "10:30"']] }),
]);

const documents = folder('5. Documents', `Needs the Postman working directory set to the project root so "${SAMPLE_FILE}" resolves (see the README).`, [
  step({ name: 'Upload a valid PNG (201)', method: 'post', path: '/appointments/{{appointmentId}}/documents', as: 'citizen', expect: 201, form: [{ key: 'serviceRequirementId', value: '{{itemId0}}' }, { key: 'file', file: SAMPLE_FILE }], save: { documentId: 'json.data.document.id' }, checks: [['Waiting for the automatic review', 'json.data.document.status === "PENDING"'], ['Version 1', 'json.data.document.version === 1'], ['Never exposes a server path', 'pm.response.text().indexOf("filePath") === -1']], note: `Uses ${SAMPLE_FILE}. If the file field is empty, pick any small PNG, JPEG or PDF.` }),
  step({ name: 'Upload a text file (415)', method: 'post', path: '/appointments/{{appointmentId}}/documents', as: 'citizen', expect: 415, form: [{ key: 'serviceRequirementId', value: '{{itemId1}}' }, { key: 'file', file: TEXT_FILE }], checks: [['Error code is UNSUPPORTED_FILE_TYPE', 'json.error.code === "UNSUPPORTED_FILE_TYPE"']] }),
  step({ name: 'Upload without a file (400)', method: 'post', path: '/appointments/{{appointmentId}}/documents', as: 'citizen', expect: 400, form: [{ key: 'serviceRequirementId', value: '{{itemId1}}' }], checks: [['Error code is FILE_REQUIRED', 'json.error.code === "FILE_REQUIRED"']] }),
  step({ name: 'IDOR: another citizen uploads to it (403)', method: 'post', path: '/appointments/{{appointmentId}}/documents', as: 'citizen2', expect: 403, form: [{ key: 'serviceRequirementId', value: '{{itemId1}}' }, { key: 'file', file: SAMPLE_FILE }] }),
  step({ name: 'Download as the owner (200)', method: 'get', path: '/documents/{{documentId}}/file', as: 'citizen', expect: 200, checks: [['Served as an attachment', 'String(pm.response.headers.get("Content-Disposition")).includes("attachment")']] }),
  step({ name: 'Download as another citizen (403)', method: 'get', path: '/documents/{{documentId}}/file', as: 'citizen2', expect: 403 }),
  step({ name: 'Download as an officer of ANOTHER office (403)', method: 'get', path: '/documents/{{documentId}}/file', as: 'kirkos', expect: 403 }),
  step({ name: 'Download as the officer of this office (200)', method: 'get', path: '/documents/{{documentId}}/file', as: 'bole', expect: 200 }),
  step({ name: 'Download without a token (401)', method: 'get', path: '/documents/{{documentId}}/file', as: 'none', expect: 401 }),
  step({ name: 'Appeal a document that was not rejected (409)', method: 'post', path: '/documents/{{documentId}}/appeal', as: 'citizen', expect: 409, checks: [['Error code is INVALID_STATE', 'json.error.code === "INVALID_STATE"']] }),
]);

const officer = folder('6. Officer and office scope (ABAC)', 'Officers see only their own office.', [
  step({ name: 'Bole officer queue (200, includes the appointment)', method: 'get', path: '/officer/appointments?date={{bookingDate}}', as: 'bole', expect: 200, checks: [['Contains the appointment', 'json.data.some((a) => a.id === pm.collectionVariables.get("appointmentId"))']] }),
  step({ name: 'Kirkos officer queue (200, empty)', method: 'get', path: '/officer/appointments?date={{bookingDate}}', as: 'kirkos', expect: 200, checks: [['Sees nothing from Bole', 'json.data.length === 0']] }),
  step({ name: 'IDOR: Kirkos officer opens a Bole appointment (403)', method: 'get', path: '/officer/appointments/{{appointmentId}}', as: 'kirkos', expect: 403, checks: [['Explains why', 'json.error.message.includes("different office")']] }),
  step({ name: 'Bole officer opens it (200, with citizen details)', method: 'get', path: '/officer/appointments/{{appointmentId}}', as: 'bole', expect: 200, checks: [['Shows the citizen', 'json.data.citizen.email === "citizen1@mekoya.test"']] }),
  step({ name: 'A citizen on an officer route (403)', method: 'get', path: '/officer/appointments', as: 'citizen', expect: 403, checks: [['Names the missing permission', 'json.error.message.includes("appointment:view-office")']] }),
  step({ name: 'Complete before all documents are approved (409)', method: 'patch', path: '/officer/appointments/{{appointmentId}}/complete', as: 'bole', expect: 409, body: {}, checks: [['Error code is INVALID_STATE', 'json.error.code === "INVALID_STATE"']] }),
  step({ name: 'Documents waiting for a human (200)', method: 'get', path: '/officer/documents', as: 'bole', expect: 200, checks: [['Returns a list', 'Array.isArray(json.data)']] }),
  step({ name: 'Review a document from another office (403)', method: 'patch', path: '/officer/documents/{{documentId}}/review', as: 'kirkos', expect: 403, body: { decision: 'APPROVE' } }),
  step({ name: 'Reject without a reason (400)', method: 'patch', path: '/officer/documents/{{documentId}}/review', as: 'bole', expect: 400, body: { decision: 'REJECT' }, checks: [['The reason field is reported', 'json.error.details[0].path === "reason"']] }),
]);

const ai = folder('7. AI smart checklist', 'Works with the mock provider (keyword fallback) and with real Gemini.', [
  step({ name: 'Find the right service (200)', method: 'post', path: '/ai/checklist', as: 'citizen', expect: 200, body: { description: 'I need to renew my drivers license that is about to expire' }, checks: [['A valid status', '["MATCHED", "NO_CONFIDENT_MATCH"].includes(json.data.status)'], ['Says which engine answered', '["gemini", "keyword"].includes(json.data.provider)'], ['Has a document list', 'Array.isArray(json.data.requiredDocuments)']] }),
  step({ name: 'A situation that needs real understanding (200)', method: 'post', path: '/ai/checklist', as: 'citizen', expect: 200, body: { description: 'my baby was born last week and I need the official paperwork' }, checks: [['Never errors, even if the AI is down', '["MATCHED", "NO_CONFIDENT_MATCH"].includes(json.data.status)']] }),
  step({ name: 'Description too short (400)', method: 'post', path: '/ai/checklist', as: 'citizen', expect: 400, body: { description: 'license' }, checks: [['Error code is VALIDATION_ERROR', 'json.error.code === "VALIDATION_ERROR"']] }),
  step({ name: 'No token (401)', method: 'post', path: '/ai/checklist', as: 'none', expect: 401, body: { description: 'I need to renew my drivers license' } }),
  step({ name: 'Content admin lacks ai:use (403)', method: 'post', path: '/ai/checklist', as: 'content', expect: 403, body: { description: 'I need to renew my drivers license' }, checks: [['Names the missing permission', 'json.error.message.includes("ai:use")']] }),
]);

const admin = folder('8. Admin (PBAC)', 'Permission checks: the same endpoint answers differently for each role.', [
  step({ name: 'Create a service as a citizen (403)', method: 'post', path: '/admin/services', as: 'citizen', expect: 403, body: { slug: '{{newSlug}}', nameEn: 'Postman Service', category: 'Test' }, checks: [['Names the missing permission', 'json.error.message.includes("service:manage")']] }),
  step({ name: 'Create a service with an invalid body (400)', method: 'post', path: '/admin/services', as: 'content', expect: 400, body: { slug: 'Bad Slug', category: '' }, checks: [['Reports every invalid field', 'json.error.details.length >= 3']] }),
  step({ name: 'Create a service as content admin (201)', method: 'post', path: '/admin/services', as: 'content', expect: 201, body: { slug: '{{newSlug}}', nameEn: 'Postman Service', category: 'Test' }, save: { newServiceId: 'json.data.id' }, checks: [['Active by default', 'json.data.isActive === true']] }),
  step({ name: 'Create the same slug again (409)', method: 'post', path: '/admin/services', as: 'content', expect: 409, body: { slug: '{{newSlug}}', nameEn: 'Postman Service', category: 'Test' }, checks: [['Error code is CONFLICT', 'json.error.code === "CONFLICT"']] }),
  step({ name: 'Update the service (200)', method: 'patch', path: '/admin/services/{{newServiceId}}', as: 'content', expect: 200, body: { nameEn: 'Postman Service (renamed)' }, checks: [['The name changed', 'json.data.nameEn === "Postman Service (renamed)"']] }),
  step({ name: 'Create a requirement (201)', method: 'post', path: '/admin/requirements', as: 'content', expect: 201, body: { nameEn: 'Postman requirement', expectedType: 'PROOF_OF_ADDRESS' }, save: { newRequirementId: 'json.data.id' } }),
  step({ name: 'Attach the requirement to the service (200)', method: 'put', path: '/admin/services/{{newServiceId}}/requirements/{{newRequirementId}}', as: 'content', expect: 200, body: { isMandatory: true } }),
  step({ name: 'Create an office (201)', method: 'post', path: '/admin/offices', as: 'content', expect: 201, body: { nameEn: 'Postman Office', city: 'Addis Ababa', slotTimes: ['09:00', '10:00'] }, save: { newOfficeId: 'json.data.id' } }),
  step({ name: 'Offer the service at the office (200)', method: 'put', path: '/admin/offices/{{newOfficeId}}/services/{{newServiceId}}', as: 'content', expect: 200, body: { slotCapacity: 2 } }),
  step({ name: 'Deactivate the service (200, soft delete)', method: 'delete', path: '/admin/services/{{newServiceId}}', as: 'content', expect: 200, checks: [['Now inactive', 'json.data.isActive === false']] }),
  step({ name: 'The deactivated service is hidden publicly (404)', method: 'get', path: '/services/{{newServiceId}}', as: 'none', expect: 404 }),
  step({ name: 'List users as content admin (403)', method: 'get', path: '/admin/users', as: 'content', expect: 403, checks: [['Names the missing permission', 'json.error.message.includes("user:manage")']] }),
  step({ name: 'List users as Super Admin (200)', method: 'get', path: '/admin/users?role=OFFICER', as: 'admin', expect: 200, checks: [['Returns officers', 'json.data.length >= 2'], ['Never returns password hashes', 'pm.response.text().indexOf("passwordHash") === -1']] }),
  step({ name: 'Invite an officer without an office (400)', method: 'post', path: '/admin/users', as: 'admin', expect: 400, body: { email: '{{staffEmail}}', fullName: 'Postman Officer', role: 'OFFICER' }, checks: [['The office field is reported', 'json.error.details.some((d) => d.path === "officeId")']] }),
  step({ name: 'Try to create a Super Admin (400)', method: 'post', path: '/admin/users', as: 'admin', expect: 400, body: { email: '{{staffEmail}}', fullName: 'Too Powerful', role: 'SUPER_ADMIN' } }),
  step({ name: 'Invite an officer (201)', method: 'post', path: '/admin/users', as: 'admin', expect: 201, body: { email: '{{staffEmail}}', fullName: 'Postman Officer', role: 'OFFICER', officeId: 'office-arada' }, save: { staffUserId: 'json.data.id' }, checks: [['Waiting to activate', 'json.data.status === "INVITED"']] }),
  step({ name: 'Resend the invitation (200)', method: 'post', path: '/admin/users/{{staffUserId}}/resend-invite', as: 'admin', expect: 200 }),
  step({ name: 'Deactivate the invited user (200)', method: 'patch', path: '/admin/users/{{staffUserId}}/status', as: 'admin', expect: 200, body: { isActive: false }, checks: [['Now inactive', 'json.data.isActive === false']] }),
  step({ name: 'Audit log as content admin (403)', method: 'get', path: '/admin/audit-logs', as: 'content', expect: 403 }),
  step({ name: 'Audit log as Super Admin (200, filtered)', method: 'get', path: '/admin/audit-logs?action=SERVICE_CREATED&limit=5', as: 'admin', expect: 200, checks: [['Has entries', 'json.data.length > 0'], ['Only the requested action', 'json.data.every((entry) => entry.action === "SERVICE_CREATED")']] }),
]);

const cleanup = folder('9. Cleanup', 'Cancels the appointment this run created.', [
  step({ name: 'Cancel my appointment (200)', method: 'patch', path: '/appointments/{{appointmentId}}/cancel', as: 'citizen', expect: 200, checks: [['Status is CANCELLED', 'json.data.status === "CANCELLED"']] }),
  step({ name: 'Cancel it again (409)', method: 'patch', path: '/appointments/{{appointmentId}}/cancel', as: 'citizen', expect: 409, checks: [['Error code is INVALID_STATE', 'json.error.code === "INVALID_STATE"']] }),
]);

const scenarios = folder('Scenarios', 'Ordered, self-checking requests. Run the folders in order, or run the whole folder in the Collection Runner or with Newman.', [setup, auth, catalog, booking, documents, officer, ai, admin, cleanup]);

// ───────────────────────── Reference (generated from the OpenAPI document) ─────────────────────────

const doc = openApiDocument as Json;
const paths = doc.paths as Record<string, Record<string, Json>>;

const PERMISSION_ROLE: Record<string, Role> = {
  'appointment:book': 'citizen',
  'appointment:view-own': 'citizen',
  'document:upload': 'citizen',
  'ai:use': 'citizen',
  'appointment:view-office': 'bole',
  'appointment:complete': 'bole',
  'document:review': 'bole',
  'service:manage': 'content',
  'office:manage': 'content',
  'requirement:manage': 'content',
  'user:manage': 'admin',
  'audit:read': 'admin',
};

function roleFor(op: Json): Role {
  const description = String(op.description ?? '');
  if (description.startsWith('**Public.**')) return 'none';
  const match = description.match(/`([a-z-]+:[a-z-]+)` permission/);
  const permission = match?.[1];
  return (permission ? PERMISSION_ROLE[permission] : undefined) || 'citizen';
}

function fillPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (name === 'requirementId') return '{{newRequirementId}}';
    if (name === 'serviceId') return '{{newServiceId}}';
    if (path.startsWith('/documents') || path.startsWith('/officer/documents')) return '{{documentId}}';
    if (path.startsWith('/appointments') || path.startsWith('/officer/appointments')) return '{{appointmentId}}';
    if (path.startsWith('/offices')) return 'office-bole';
    if (path.startsWith('/services')) return 'svc-license-renewal';
    if (path.startsWith('/admin/services')) return '{{newServiceId}}';
    if (path.startsWith('/admin/requirements')) return '{{newRequirementId}}';
    if (path.startsWith('/admin/offices')) return '{{newOfficeId}}';
    if (path.startsWith('/admin/users')) return '{{staffUserId}}';
    return '{{id}}';
  });
}

// A minimal example value for a JSON Schema, used when an endpoint has no hand-written example
function sample(schema: Json | undefined): unknown {
  if (!schema) return {};
  if ('default' in schema) return schema.default;
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const variants = (schema.anyOf ?? schema.oneOf) as Json[] | undefined;
  if (variants) return sample(variants.find((variant) => variant.type !== 'null') ?? variants[0]);
  switch (schema.type) {
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, Json>;
      const required = new Set((schema.required ?? []) as string[]);
      return Object.fromEntries(Object.entries(properties).filter(([key]) => required.has(key)).map(([key, value]) => [key, sample(value)]));
    }
    case 'array':
      return [sample(schema.items as Json)];
    case 'integer':
    case 'number':
      return (schema.minimum as number | undefined) ?? 1;
    case 'boolean':
      return true;
    default:
      return schema.format === 'date-time' ? new Date().toISOString() : 'string';
  }
}

function referenceItem(path: string, method: string, op: Json): Json {
  const parameters = (op.parameters ?? []) as Json[];
  const query = parameters.filter((p) => p.in === 'query').map((p) => ({ key: p.name, value: String(sample(p.schema as Json)), disabled: true }));
  const headers = parameters.flatMap((p) => {
    if (typeof p.$ref === 'string') return [{ key: 'Accept-Language', value: 'en', disabled: true }];
    if (p.in === 'header') return [{ key: String(p.name), value: p.name === 'Idempotency-Key' ? '{{idemKey}}' : 'value', disabled: true }];
    return [];
  });

  const requestBody = op.requestBody as { content: Record<string, { schema?: Json; example?: unknown }> } | undefined;
  const json = requestBody?.content['application/json'];
  const multipart = requestBody?.content['multipart/form-data'];

  let body: Json | undefined;
  if (json) {
    headers.push({ key: 'Content-Type', value: 'application/json', disabled: false });
    body = { mode: 'raw', raw: JSON.stringify(json.example ?? sample(json.schema), null, 2), options: { raw: { language: 'json' } } };
  } else if (multipart) {
    body = {
      mode: 'formdata',
      formdata: [
        { key: 'serviceRequirementId', value: '{{itemId0}}', type: 'text' },
        { key: 'file', type: 'file', src: SAMPLE_FILE },
      ],
    };
  }

  const url = buildUrl(fillPath(path)) as { raw: string; query?: unknown };
  return {
    name: `${method.toUpperCase()} ${path}`,
    request: {
      method: method.toUpperCase(),
      header: headers,
      url: { ...url, ...(query.length > 0 ? { query } : {}) },
      auth: authFor(roleFor(op)),
      description: `${String(op.summary)}\n\n${String(op.description ?? '')}`,
      ...(body ? { body } : {}),
    },
  };
}

const tags = (doc.tags as Array<{ name: string; description: string }>).map((tag) => ({ ...tag, item: [] as Json[] }));
let referenceCount = 0;
for (const [path, methods] of Object.entries(paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const tag = tags.find((candidate) => candidate.name === (op.tags as string[])[0]);
    if (!tag) throw new Error(`Unknown tag on ${method} ${path}`);
    tag.item.push(referenceItem(path, method, op));
    referenceCount += 1;
  }
}
const reference = folder(
  'Reference: every endpoint',
  'One request per documented endpoint, generated from the OpenAPI document, so it always matches the API. Run the Setup folder first so the tokens exist.',
  tags.filter((tag) => tag.item.length > 0).map((tag) => folder(tag.name, tag.description, tag.item)),
);

// ───────────────────────── Collection ─────────────────────────

const variables: Record<string, string> = {
  baseUrl: 'http://localhost:4000/api/v1',
  demoPassword: DEMO_PASSWORD,
  adminEmail: ADMIN_EMAIL,
  adminPassword: '',
};
for (const name of [
  ...Object.values(ROLE_VARS).filter((value): value is NonNullable<typeof value> => value !== null),
  'appointmentId', 'documentId', 'itemId0', 'itemId1', 'itemId2', 'itemId3', 'bookingDate', 'weekendDate', 'idemKey',
  'newEmail', 'staffEmail', 'newSlug', 'newServiceId', 'newRequirementId', 'newOfficeId', 'staffUserId',
  'oldRefresh', 'newRefresh', 'logoutRefresh',
]) {
  variables[name] = '';
}

const collection = {
  info: {
    name: 'Mekoya API',
    description:
      'Government service guide and appointment platform.\n\n1. Start the API (npm run dev).\n2. Set the adminPassword variable to SEED_ADMIN_PASSWORD from your .env.\n3. Run the "Scenarios" folder in order (Collection Runner, or Newman).\n\nGenerated by scripts/generate-postman.ts from the OpenAPI document.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: Object.entries(variables).map(([key, value]) => ({ key, value })),
  item: [scenarios, reference],
};

writeFileSync('mekoya.postman_collection.json', `${JSON.stringify(collection, null, 2)}\n`);

// Small files the upload scenarios need, so nobody has to find one
mkdirSync('postman', { recursive: true });
writeFileSync(
  SAMPLE_FILE,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);
writeFileSync(TEXT_FILE, 'This file type is not allowed, so the upload scenario expects a 415.\n');

const scenarioCount = (scenarios.item as Json[]).reduce((sum, group) => sum + (group.item as Json[]).length, 0);
console.log(`Wrote mekoya.postman_collection.json: ${scenarioCount} scenario requests, ${referenceCount} reference requests`);
console.log(`Wrote ${SAMPLE_FILE} and ${TEXT_FILE}`);