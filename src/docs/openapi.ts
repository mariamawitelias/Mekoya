import { acceptInviteBodySchema, forgotPasswordBodySchema, googleBodySchema, loginBodySchema, registerBodySchema, resetPasswordBodySchema, verifyEmailBodySchema } from '../schemas/auth.schema.js';
import {
  completeBodySchema,
  createAppointmentBodySchema,
  myAppointmentsQuerySchema,
  officerQueueQuerySchema,
  rescheduleBodySchema,
  slotsQuerySchema,
} from '../schemas/appointment.schema.js';
import {
  createOfficeBodySchema,
  createRequirementBodySchema,
  createServiceBodySchema,
  linkRequirementBodySchema,
  listOfficesQuerySchema,
  listServicesQuerySchema,
  officeServiceBodySchema,
  officeServiceParamsSchema,
  serviceRequirementParamsSchema,
  updateOfficeBodySchema,
  updateRequirementBodySchema,
  updateServiceBodySchema,
} from '../schemas/catalog.schema.js';
import { checklistBodySchema } from '../schemas/checklist.schema.js';
import { idParamSchema } from '../schemas/common.schema.js';
import { officerDocumentsQuerySchema, reviewDocumentBodySchema } from '../schemas/document.schema.js';
import { auditQuerySchema, createStaffBodySchema, listUsersQuerySchema, setUserStatusBodySchema } from '../schemas/user.schema.js';
import { addPath, type Json, type Method, operation, type OperationInput, type Paths } from './builder.js';

const paths: Paths = {};
const route = (method: Method, path: string, input: OperationInput): void => addPath(paths, method, path, operation(input));

// ───────────────────────── Shared examples ─────────────────────────

const pageMeta = { page: 1, limit: 10, total: 4, totalPages: 1 };

const appointmentExample = {
  id: '5f6c1c3e-8d0a-4a39-9d5b-2f6b0d1c9a11',
  status: 'BOOKED',
  slotStart: '2026-10-19T05:30:00.000Z',
  date: '2026-10-19',
  time: '08:30',
  service: { id: 'svc-license-renewal', name: "Driver's License Renewal" },
  office: { id: 'office-bole', name: 'Bole Service Center (sample)', address: null, city: 'Addis Ababa' },
  closureNote: null,
  cancelledAt: null,
  createdAt: '2026-10-12T09:00:00.000Z',
};

const documentExample = {
  id: 'c2a4e6f0-1b3d-4c5e-8f70-9a1b2c3d4e5f',
  serviceRequirementId: '9829360f-a109-4d42-b82b-a77564f117c0',
  version: 1,
  status: 'PENDING',
  aiStatus: 'PENDING',
  originalName: 'id-card.png',
  mimeType: 'image/png',
  sizeBytes: 48211,
  uploadedAt: '2026-10-12T09:05:00.000Z',
};

const serviceSummary = {
  id: 'svc-license-renewal',
  slug: 'drivers-license-renewal',
  name: "Driver's License Renewal",
  description: "Renew an expiring driver's license.",
  category: 'Transport',
  feeInfo: null,
};

const officeSummary = {
  id: 'office-bole',
  name: 'Bole Service Center (sample)',
  address: null,
  city: 'Addis Ababa',
  slotTimes: ['08:30', '09:30', '10:30', '11:30', '14:00', '15:00'],
};

// ───────────────────────── Health ─────────────────────────

route('get', '/health', {
  tag: 'Health',
  summary: 'Check that the API and database are up',
  access: 'public',
  success: { description: 'The API is healthy', example: { status: 'ok', uptimeSeconds: 3600 } },
});

// ───────────────────────── Auth ─────────────────────────

route('post', '/auth/register', {
  tag: 'Auth',
  summary: 'Register a citizen account',
  description:
    'Always creates a `CITIZEN`: a role in the request body is ignored. Passwords need 8 to 72 characters with an uppercase letter, a lowercase letter, a number and a symbol, and are stored as bcrypt hashes (cost 12). A verification email is sent in the background, and a failure to send it never fails the registration.',
  access: 'public',
  body: registerBodySchema,
  bodyExample: { email: 'abebe@example.com', password: 'Str0ng!Pass1', fullName: 'Abebe Kebede', phone: '+251911000000', preferredLanguage: 'EN' },
  success: {
    status: 201,
    description: 'Account created',
    example: { id: '8d1e4b52-0c3f-4e7a-9b66-5a2d7f1c0e33', email: 'abebe@example.com', emailVerified: false, profile: { fullName: 'Abebe Kebede', preferredLanguage: 'EN' } },
  },
  errors: [409, 429],
});

route('post', '/auth/login', {
  tag: 'Auth',
  summary: 'Log in with email and password',
  description:
    'Returns a short-lived access token (15 minutes) in the body and sets the refresh token as an httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`. The same generic 401 is returned for a wrong password, an unknown email and a Google-only account, so account existence is not revealed. Citizens can log in before verifying their email, but cannot book until they do.',
  access: 'public',
  body: loginBodySchema,
  bodyExample: { email: 'citizen1@mekoya.test', password: 'Demo!Pass2026' },
  success: {
    description: 'Logged in',
    setsCookie: true,
    example: {
      accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      user: { id: 'f66b8733-6bd8-4fd2-9f28-e0940be40fbb', email: 'citizen1@mekoya.test', role: 'CITIZEN', fullName: 'Sample Citizen One', emailVerified: true },
    },
  },
  errors: [401, 403, 429],
});

route('post', '/auth/google', {
  tag: 'Auth',
  summary: 'Log in or register with a Google ID token',
  description:
    'Verifies the Google ID token (signature, expiry, audience and verified email). Existing accounts are **linked** by email, and unknown emails get a new citizen account with no password. If the existing account was never email-verified, linking clears its password and revokes its sessions, which stops pre-registration takeover. Returns 503 `GOOGLE_NOT_CONFIGURED` when the server has no Google client id.',
  access: 'public',
  body: googleBodySchema,
  bodyExample: { idToken: 'eyJhbGciOiJSUzI1NiIs...' },
  success: { description: 'Logged in', setsCookie: true, example: { accessToken: 'eyJhbGciOiJIUzI1NiIs...', user: { id: '...', email: 'person@gmail.com', role: 'CITIZEN', fullName: 'Person Name', emailVerified: true } } },
  errors: [401, 403, 409, 429],
});

route('post', '/auth/refresh', {
  tag: 'Auth',
  summary: 'Get a new access token (refresh token rotation)',
  description:
    'Reads the refresh token from the httpOnly cookie, so there is no request body. Every refresh token works **once**: it is replaced by a new one in the same family. Presenting an already-used token is treated as theft, so the **whole family is revoked** and an audit entry is written. In Swagger UI the browser sends the cookie automatically after you log in here.',
  access: 'public',
  success: { description: 'New access token, and a new refresh cookie', setsCookie: true, example: { accessToken: 'eyJhbGciOiJIUzI1NiIs...' } },
  errors: [401, 403, 429],
});

route('post', '/auth/logout', {
  tag: 'Auth',
  summary: 'Log out of this session',
  description: 'Revokes the refresh token family of the cookie and clears the cookie. Always succeeds, even if the cookie is missing or unknown. An access token already issued stays valid until it expires (up to 15 minutes).',
  access: 'public',
  success: { description: 'Logged out', example: { loggedOut: true } },
});

route('post', '/auth/logout-all', {
  tag: 'Auth',
  summary: 'Log out of every device',
  access: 'authenticated',
  success: { description: 'All refresh tokens revoked', example: { loggedOut: true } },
});

route('get', '/auth/me', {
  tag: 'Auth',
  summary: 'Show who the access token belongs to',
  description: 'Returns the claims inside the access token, including permissions. Permission changes reach a token the next time it is refreshed.',
  access: 'authenticated',
  success: {
    description: 'The token claims',
    example: { id: 'f66b8733-6bd8-4fd2-9f28-e0940be40fbb', role: 'CITIZEN', permissions: ['appointment:book', 'appointment:view-own', 'document:upload', 'ai:use'], officeId: null },
  },
});

route('post', '/auth/verify-email', {
  tag: 'Auth',
  summary: 'Verify an email address with the emailed token',
  description: 'The token is single use and expires after 24 hours. It is a POST on purpose: email security scanners open every link in a message, and a GET link would verify on their request.',
  access: 'public',
  body: verifyEmailBodySchema,
  success: { description: 'Email verified', example: { verified: true } },
  errors: [429],
});

route('post', '/auth/resend-verification', {
  tag: 'Auth',
  summary: 'Send a new verification email',
  access: 'authenticated',
  success: { description: 'A new email was queued', example: { sent: true } },
  errors: [400, 404, 429],
});

route('post', '/auth/forgot-password', {
  tag: 'Auth',
  summary: 'Request a password reset email',
  description: 'Always answers the same way, whether or not the email is registered, so registered emails cannot be discovered. The reset link lasts 30 minutes.',
  access: 'public',
  body: forgotPasswordBodySchema,
  success: { description: 'Accepted', example: { message: 'If that email is registered, a reset link has been sent.' } },
  errors: [429],
});

route('post', '/auth/reset-password', {
  tag: 'Auth',
  summary: 'Set a new password with the emailed token',
  description: 'Single use. Revokes every existing session of the account.',
  access: 'public',
  body: resetPasswordBodySchema,
  success: { description: 'Password changed', example: { reset: true } },
  errors: [429],
});

route('post', '/auth/accept-invite', {
  tag: 'Auth',
  summary: 'Activate a staff account from an invitation',
  description: 'Staff accounts are created by the Super Admin without a password. The invited person sets it here with the token from the invitation email (valid for 72 hours, single use).',
  access: 'public',
  body: acceptInviteBodySchema,
  success: { description: 'Account activated', example: { activated: true } },
  errors: [403, 429],
});

// ───────────────────────── Catalog (public) ─────────────────────────

route('get', '/services', {
  tag: 'Catalog',
  summary: 'Search and browse services',
  description: 'Only active services are listed. Names and descriptions follow `Accept-Language` (`am` or `en`), falling back to English field by field.',
  access: 'public',
  query: listServicesQuerySchema,
  localized: true,
  success: { description: 'A page of services', example: [serviceSummary], meta: pageMeta },
});

route('get', '/services/{id}', {
  tag: 'Catalog',
  summary: 'Get a service with its document checklist and offices',
  description: 'Each requirement `id` is the **checklist item id** that uploads attach to.',
  access: 'public',
  params: idParamSchema,
  localized: true,
  success: {
    description: 'The service',
    example: {
      ...serviceSummary,
      requirements: [{ id: '9829360f-a109-4d42-b82b-a77564f117c0', requirementId: 'req-photo', name: 'Passport-size photo', description: null, isMandatory: true, notes: null }],
      offices: [{ ...officeSummary, slotCapacity: 3 }],
    },
  },
  errors: [404],
});

route('get', '/offices', {
  tag: 'Catalog',
  summary: 'List offices, optionally by city or the service they offer',
  access: 'public',
  query: listOfficesQuerySchema,
  localized: true,
  success: { description: 'Offices', example: [officeSummary] },
});

route('get', '/offices/{id}/slots', {
  tag: 'Appointments',
  summary: 'See free time slots at an office for a service and date',
  description: 'Times are Addis Ababa time (UTC+3). Offices are closed on weekends. The result is a snapshot: a slot shown as free can be taken a moment later, and booking re-checks capacity.',
  access: 'public',
  params: idParamSchema,
  query: slotsQuerySchema,
  success: {
    description: 'The slots of that day',
    example: {
      date: '2026-10-19',
      open: true,
      timezone: 'Africa/Addis_Ababa (UTC+3)',
      slots: [{ time: '08:30', startsAt: '2026-10-19T05:30:00.000Z', capacity: 3, booked: 1, available: 2, bookable: true }],
    },
  },
  errors: [404],
});

// ───────────────────────── Appointments (citizen) ─────────────────────────

route('post', '/appointments', {
  tag: 'Appointments',
  summary: 'Book an appointment',
  description:
    'Requires a **verified email** (`403 EMAIL_NOT_VERIFIED`). Capacity is enforced under a database lock, so simultaneous bookings can never exceed the slot capacity (`409 SLOT_FULL`). Other rules: a citizen can hold at most 2 active appointments per service (`LIMIT_REACHED`), cannot hold two at the same time (`TIME_CONFLICT`), and must book 60 minutes to 60 days ahead (`SLOT_TOO_SOON`, `SLOT_TOO_FAR`, `OFFICE_CLOSED` on weekends).\n\nSend an `Idempotency-Key` to make retries safe: repeating the same key returns the **same appointment** with status 200 and an `Idempotent-Replay: true` header instead of booking twice.',
  access: 'appointment:book',
  body: createAppointmentBodySchema,
  bodyExample: { officeId: 'office-bole', serviceId: 'svc-license-renewal', date: '2026-10-19', time: '08:30' },
  headers: [
    {
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description: '8 to 100 letters, numbers, hyphens or underscores. Use a new random value per booking attempt.',
      schema: { type: 'string', example: 'booking-2026-10-19-abc123' },
    },
  ],
  success: { status: 201, description: 'Booked. A confirmation email is sent in the background.', example: appointmentExample },
  errors: [404, 409],
});

route('get', '/appointments/me', {
  tag: 'Appointments',
  summary: 'List my appointments',
  access: 'appointment:view-own',
  query: myAppointmentsQuerySchema,
  localized: true,
  success: { description: 'A page of my appointments', example: [appointmentExample], meta: pageMeta },
});

route('get', '/appointments/{id}', {
  tag: 'Appointments',
  summary: 'Get one of my appointments with its checklist and document status',
  description: '**Ownership check (ABAC):** only the owner, or a Super Admin, may read it. Anyone else gets 403.',
  access: 'appointment:view-own',
  params: idParamSchema,
  localized: true,
  success: {
    description: 'The appointment and, for each checklist item, the current document',
    example: {
      ...appointmentExample,
      checklist: [
        {
          id: '9829360f-a109-4d42-b82b-a77564f117c0',
          name: 'Passport-size photo',
          isMandatory: true,
          notes: null,
          document: { id: documentExample.id, status: 'AI_APPROVED', rejectionReason: null, originalName: 'photo.png', mimeType: 'image/png', sizeBytes: 48211, appealRequested: false, uploadedAt: '2026-10-12T09:05:00.000Z' },
        },
      ],
    },
  },
  errors: [404],
});

route('patch', '/appointments/{id}/cancel', {
  tag: 'Appointments',
  summary: 'Cancel an appointment',
  description: 'Owner only. Allowed until 12 hours before the slot (`409 TOO_LATE`), and only while the appointment is active (`409 INVALID_STATE`).',
  access: 'appointment:book',
  params: idParamSchema,
  success: { description: 'Cancelled', example: { ...appointmentExample, status: 'CANCELLED', cancelledAt: '2026-10-13T09:00:00.000Z' } },
  errors: [404, 409],
});

route('patch', '/appointments/{id}/reschedule', {
  tag: 'Appointments',
  summary: 'Move an appointment to another slot or office',
  description: 'Owner only, with the same rules and cutoff as booking and cancelling. Uploaded documents stay attached. The reminder email is re-armed for the new time.',
  access: 'appointment:book',
  params: idParamSchema,
  body: rescheduleBodySchema,
  bodyExample: { date: '2026-10-20', time: '10:30' },
  success: { description: 'Rescheduled', example: { ...appointmentExample, date: '2026-10-20', time: '10:30' } },
  errors: [404, 409],
});

// ───────────────────────── Documents ─────────────────────────

route('post', '/appointments/{id}/documents', {
  tag: 'Documents',
  summary: 'Upload a document for a checklist item',
  description:
    'Multipart form with the `file` and the `serviceRequirementId` (the checklist item id from the appointment). JPEG, PNG or PDF up to **5 MB**. The type is verified by reading the file\'s first bytes, not only the declared type. Files are stored under a random name.\n\nUploading again for the same item creates a **new version** and keeps the old one as history. An approved document cannot be replaced. The response returns immediately and an **automatic review runs in the background**: poll the appointment to see `AI_APPROVED`, `AI_REJECTED` or `NEEDS_HUMAN`. When every mandatory document is approved, the appointment becomes `CONFIRMED` automatically.',
  access: 'document:upload',
  params: idParamSchema,
  requestBody: {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['file', 'serviceRequirementId'],
          properties: {
            serviceRequirementId: { type: 'string', description: 'Checklist item id from `GET /appointments/{id}`' },
            file: { type: 'string', format: 'binary', description: 'JPEG, PNG or PDF, at most 5 MB' },
          },
        },
      },
    },
  },
  success: { status: 201, description: 'Stored. The automatic review has been queued.', example: { document: documentExample, appointmentStatus: 'BOOKED' } },
  errors: [404, 409, 413, 415],
});

route('get', '/documents/{id}/file', {
  tag: 'Documents',
  summary: 'Download a document',
  description: 'Allowed for the owning citizen (and Super Admin), and for an officer with `document:review` **whose office matches the appointment**. Always served as an attachment.',
  access: 'authenticated',
  params: idParamSchema,
  success: {
    description: 'The file',
    content: {
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
      'image/png': { schema: { type: 'string', format: 'binary' } },
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  },
  errors: [404],
});

route('post', '/documents/{id}/appeal', {
  tag: 'Documents',
  summary: 'Ask an officer to review a document the automatic check rejected',
  description: 'Owner only, and only for documents with status `AI_REJECTED`. The document moves to the officers\' `NEEDS_HUMAN` queue.',
  access: 'document:upload',
  params: idParamSchema,
  success: { description: 'Sent to a human', example: { id: documentExample.id, status: 'NEEDS_HUMAN' } },
  errors: [404, 409],
});

// ───────────────────────── AI ─────────────────────────

route('post', '/ai/checklist', {
  tag: 'AI',
  summary: 'Find the right service and document checklist from a free-text description',
  description:
    'The citizen describes their situation, and the AI model **picks a service from the real catalog**. The document list is always read from the database, never written by the model, and an invented service id is discarded. If the model is unsure the response is `NO_CONFIDENT_MATCH` with candidates and a clarifying question. If the AI is down or slow, a keyword matcher answers instead (`provider: keyword`, `aiStatus: FALLBACK`) so the endpoint never fails because of the AI, and after a failure the AI is skipped for 60 seconds.\n\n`situationNotes` is AI-generated advice, **not official guidance**. Do not include ID numbers or other personal details in the description. The text is sent to the AI provider. Limited to 10 requests per minute per user in production.',
  access: 'ai:use',
  body: checklistBodySchema,
  bodyExample: { description: 'I just opened a small shop and need a tax number' },
  localized: true,
  success: {
    description: 'A match, or a request for clarification',
    example: {
      status: 'MATCHED',
      provider: 'gemini',
      aiStatus: 'DONE',
      confidence: 0.95,
      service: { id: 'svc-tin', slug: 'tin-registration', name: 'TIN Registration', description: 'Register for a taxpayer identification number.', category: 'Tax', feeInfo: null },
      requiredDocuments: [{ id: '...', name: 'ID card copy', description: null, notes: null }],
      optionalDocuments: [],
      offices: [{ ...officeSummary, slotCapacity: 3 }],
      alternatives: [],
      clarifyingQuestion: null,
      situationNotes: ['Bring the original documents as well as copies.'],
    },
  },
  errors: [429],
});

// ───────────────────────── Officer ─────────────────────────

route('get', '/officer/appointments', {
  tag: 'Officer',
  summary: "Today's queue for my office",
  description: '**Office scope (ABAC):** the office comes from the officer\'s own account, and there is no way to ask for another office. Defaults to today (Addis Ababa time).',
  access: 'appointment:view-office',
  query: officerQueueQuerySchema,
  localized: true,
  success: {
    description: 'Appointments with document counts',
    example: [{ id: appointmentExample.id, status: 'BOOKED', date: '2026-10-19', time: '08:30', service: appointmentExample.service, citizenName: 'Sample Citizen One', documents: { total: 4, approved: 3, rejected: 0, needsHuman: 1, pending: 0 } }],
    meta: { ...pageMeta, date: '2026-10-19' },
  },
});

route('get', '/officer/appointments/{id}', {
  tag: 'Officer',
  summary: 'Open an appointment in my office, with the citizen and AI details',
  description: '**Office scope (ABAC):** an officer of another office gets 403.',
  access: 'appointment:view-office',
  params: idParamSchema,
  localized: true,
  success: { description: 'The appointment, checklist, AI results and citizen contact details', example: { ...appointmentExample, checklist: [], citizen: { email: 'citizen1@mekoya.test', fullName: 'Sample Citizen One', phone: null } } },
  errors: [404],
});

route('patch', '/officer/appointments/{id}/complete', {
  tag: 'Officer',
  summary: 'Complete a confirmed appointment',
  description: 'Only `CONFIRMED` appointments (all mandatory documents approved) in the officer\'s own office. Allowed from 30 minutes before the slot.',
  access: 'appointment:complete',
  params: idParamSchema,
  body: completeBodySchema,
  bodyExample: { closureNote: 'Originals checked at the counter' },
  success: { description: 'Completed', example: { ...appointmentExample, status: 'COMPLETED', closureNote: 'Originals checked at the counter' } },
  errors: [404, 409],
});

route('patch', '/officer/appointments/{id}/no-show', {
  tag: 'Officer',
  summary: 'Mark an appointment as a no-show',
  description: 'Only after the slot time has passed, from `BOOKED` or `CONFIRMED`, in the officer\'s own office.',
  access: 'appointment:complete',
  params: idParamSchema,
  success: { description: 'Marked as no-show', example: { ...appointmentExample, status: 'NO_SHOW' } },
  errors: [404, 409],
});

route('get', '/officer/documents', {
  tag: 'Officer',
  summary: 'Documents waiting for a human decision in my office',
  description: 'Defaults to `NEEDS_HUMAN` (low AI confidence, AI failure, or a citizen appeal). Each item includes the AI observation so the officer sees what the model reported.',
  access: 'document:review',
  query: officerDocumentsQuerySchema,
  localized: true,
  success: {
    description: 'A page of documents',
    example: [{ id: documentExample.id, appointmentId: appointmentExample.id, status: 'NEEDS_HUMAN', appealRequested: false, aiStatus: 'DONE', aiConfidence: 0.5, requirement: 'ID card copy', service: "Driver's License Renewal", citizenName: 'Sample Citizen One' }],
    meta: pageMeta,
  },
});

route('patch', '/officer/documents/{id}/review', {
  tag: 'Officer',
  summary: 'Approve, reject or override a document decision',
  description:
    'Works on any **current** document in the officer\'s own office while the appointment is open, including overriding an AI decision in either direction. A rejection needs a `reason`, which is emailed to the citizen. The audit log records the previous status, so an override is visible. The appointment is confirmed or un-confirmed automatically to match.',
  access: 'document:review',
  params: idParamSchema,
  body: reviewDocumentBodySchema,
  bodyExample: { decision: 'REJECT', reason: 'The photo does not match the applicant' },
  success: { description: 'Decision recorded', example: { id: documentExample.id, status: 'OFFICER_REJECTED', appointmentStatus: 'BOOKED' } },
  errors: [404, 409],
});

// ───────────────────────── Admin: catalog ─────────────────────────

route('post', '/admin/services', {
  tag: 'Admin: catalog',
  summary: 'Create a service',
  access: 'service:manage',
  body: createServiceBodySchema,
  bodyExample: { slug: 'vehicle-registration', nameEn: 'Vehicle Registration', nameAm: 'የተሽከርካሪ ምዝገባ', category: 'Transport' },
  success: { status: 201, description: 'Created', example: { id: '486eeaa5-5f6c-41fa-934b-ea3e74348cd1', slug: 'vehicle-registration', nameEn: 'Vehicle Registration', category: 'Transport', isActive: true } },
  errors: [409],
});

route('patch', '/admin/services/{id}', {
  tag: 'Admin: catalog',
  summary: 'Update a service (send only the fields to change)',
  description: 'Set `isActive: true` to bring back a deactivated service.',
  access: 'service:manage',
  params: idParamSchema,
  body: updateServiceBodySchema,
  success: { description: 'Updated', example: { id: 'svc-tin', nameEn: 'TIN Registration', isActive: true } },
  errors: [404, 409],
});

route('delete', '/admin/services/{id}', {
  tag: 'Admin: catalog',
  summary: 'Deactivate a service (soft delete)',
  description: 'Nothing is deleted: the service disappears from public listings, and existing appointments stay valid.',
  access: 'service:manage',
  params: idParamSchema,
  success: { description: 'Deactivated', example: { id: 'svc-tin', isActive: false } },
  errors: [404],
});

route('put', '/admin/services/{id}/requirements/{requirementId}', {
  tag: 'Admin: catalog',
  summary: 'Attach a requirement to a service, or change its mandatory flag and notes',
  description: 'Idempotent: calling it again sets the same state.',
  access: 'service:manage',
  params: serviceRequirementParamsSchema,
  body: linkRequirementBodySchema,
  bodyExample: { isMandatory: true, notesEn: 'Original and one copy' },
  success: { description: 'Linked', example: { id: '...', serviceId: 'svc-tin', requirementId: 'req-id', isMandatory: true } },
  errors: [404],
});

route('delete', '/admin/services/{id}/requirements/{requirementId}', {
  tag: 'Admin: catalog',
  summary: 'Remove a requirement from a service',
  description: 'Fails with 409 if citizens already uploaded documents against it. Deactivate the requirement instead.',
  access: 'service:manage',
  params: serviceRequirementParamsSchema,
  success: { description: 'Removed', example: { id: '...', serviceId: 'svc-tin', requirementId: 'req-id' } },
  errors: [404, 409],
});

route('post', '/admin/requirements', {
  tag: 'Admin: catalog',
  summary: 'Create a requirement (a kind of document)',
  description: '`expectedType` is the code the AI review checks against, for example `PASSPORT_PHOTO`.',
  access: 'requirement:manage',
  body: createRequirementBodySchema,
  bodyExample: { nameEn: 'Proof of address', expectedType: 'PROOF_OF_ADDRESS' },
  success: { status: 201, description: 'Created', example: { id: '...', nameEn: 'Proof of address', expectedType: 'PROOF_OF_ADDRESS', isActive: true } },
});

route('patch', '/admin/requirements/{id}', {
  tag: 'Admin: catalog',
  summary: 'Update a requirement',
  access: 'requirement:manage',
  params: idParamSchema,
  body: updateRequirementBodySchema,
  success: { description: 'Updated', example: { id: 'req-photo', isActive: true } },
  errors: [404],
});

route('delete', '/admin/requirements/{id}', {
  tag: 'Admin: catalog',
  summary: 'Deactivate a requirement (soft delete)',
  access: 'requirement:manage',
  params: idParamSchema,
  success: { description: 'Deactivated', example: { id: 'req-photo', isActive: false } },
  errors: [404],
});

route('post', '/admin/offices', {
  tag: 'Admin: catalog',
  summary: 'Create an office',
  description: '`slotTimes` are daily appointment start times in Addis Ababa time, in `HH:mm`.',
  access: 'office:manage',
  body: createOfficeBodySchema,
  bodyExample: { nameEn: 'Yeka Service Center', city: 'Addis Ababa', slotTimes: ['08:30', '09:30', '10:30'] },
  success: { status: 201, description: 'Created', example: { id: '...', nameEn: 'Yeka Service Center', city: 'Addis Ababa', slotTimes: ['08:30', '09:30', '10:30'], isActive: true } },
});

route('patch', '/admin/offices/{id}', {
  tag: 'Admin: catalog',
  summary: 'Update an office',
  access: 'office:manage',
  params: idParamSchema,
  body: updateOfficeBodySchema,
  success: { description: 'Updated', example: { id: 'office-bole', isActive: true } },
  errors: [404],
});

route('delete', '/admin/offices/{id}', {
  tag: 'Admin: catalog',
  summary: 'Deactivate an office (soft delete)',
  access: 'office:manage',
  params: idParamSchema,
  success: { description: 'Deactivated', example: { id: 'office-bole', isActive: false } },
  errors: [404],
});

route('put', '/admin/offices/{id}/services/{serviceId}', {
  tag: 'Admin: catalog',
  summary: 'Offer a service at an office, with its seats per time slot',
  access: 'office:manage',
  params: officeServiceParamsSchema,
  body: officeServiceBodySchema,
  bodyExample: { slotCapacity: 3 },
  success: { description: 'Set', example: { officeId: 'office-bole', serviceId: 'svc-tin', slotCapacity: 3 } },
  errors: [404],
});

route('delete', '/admin/offices/{id}/services/{serviceId}', {
  tag: 'Admin: catalog',
  summary: 'Stop offering a service at an office',
  access: 'office:manage',
  params: officeServiceParamsSchema,
  success: { description: 'Removed', example: { officeId: 'office-bole', serviceId: 'svc-tin', slotCapacity: 3 } },
  errors: [404],
});


route('post', '/admin/users', {
  tag: 'Admin: users',
  summary: 'Invite a staff member (officer or content admin)',
  description: 'Creates the account **without a password** and emails an invitation (valid 72 hours). An officer must be assigned to an active office. A `SUPER_ADMIN` cannot be created through the API.',
  access: 'user:manage',
  body: createStaffBodySchema,
  bodyExample: { email: 'new.officer@example.com', fullName: 'New Officer', role: 'OFFICER', officeId: 'office-arada' },
  success: { status: 201, description: 'Invited', example: { id: '...', email: 'new.officer@example.com', fullName: 'New Officer', role: 'OFFICER', officeId: 'office-arada', status: 'INVITED' } },
  errors: [404, 409],
});

route('get', '/admin/users', {
  tag: 'Admin: users',
  summary: 'List users',
  description: '`status` is `INVITED` (no way to log in yet), `ACTIVE` or `DEACTIVATED`.',
  access: 'user:manage',
  query: listUsersQuerySchema,
  success: { description: 'A page of users', example: [{ id: '...', email: 'officer.bole@mekoya.test', fullName: 'Officer Bole', role: 'OFFICER', officeId: 'office-bole', emailVerified: true, status: 'ACTIVE' }], meta: pageMeta },
});

route('patch', '/admin/users/{id}/status', {
  tag: 'Admin: users',
  summary: 'Deactivate or reactivate a user',
  description: 'Deactivating revokes every refresh token. You cannot change your own status or a Super Admin.',
  access: 'user:manage',
  params: idParamSchema,
  body: setUserStatusBodySchema,
  success: { description: 'Updated', example: { id: '...', isActive: false } },
  errors: [404],
});

route('post', '/admin/users/{id}/resend-invite', {
  tag: 'Admin: users',
  summary: 'Resend a staff invitation',
  description: 'Only for accounts that have not been activated. The previous link stops working.',
  access: 'user:manage',
  params: idParamSchema,
  success: { description: 'Queued', example: { sent: true } },
  errors: [404],
});

route('get', '/admin/audit-logs', {
  tag: 'Admin: users',
  summary: 'Read the audit log',
  description: 'Append-only. Entries with no actor are system actions (automatic review, auto-confirm).',
  access: 'audit:read',
  query: auditQuerySchema,
  success: {
    description: 'A page of audit entries, newest first',
    example: [{ id: '...', actorId: null, action: 'DOCUMENT_AI_REVIEWED', entityType: 'DocumentSubmission', entityId: '...', metadata: { status: 'AI_APPROVED', confidence: 0.95 }, createdAt: '2026-10-12T09:05:08.000Z', actor: null }],
    meta: pageMeta,
  },
});

// ───────────────────────── Components and top-level document ─────────────────────────

const errorResponse = (description: string, code: string, message: string, details?: unknown): Json => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
      example: { success: false, error: { code, message, ...(details === undefined ? {} : { details }) } },
    },
  },
});

export const openApiDocument: Json = {
  openapi: '3.1.0',
  info: {
    title: 'Mekoya API',
    version: '1.0.0',
    description: `Backend for **Mekoya**, a government service guide and appointment platform. Citizens find which documents a service needs, book a time slot, and upload their documents. An automatic AI check approves clear cases, and officers handle the exceptions.

## Quick start
1. Call **POST /auth/login** with a demo account (emails and the shared password are in the README and \`.env.example\`).
2. Copy \`data.accessToken\`, click **Authorize**, and paste it (without the word "Bearer").
3. Try any endpoint. Each one states which permission it needs. Try an admin endpoint as a citizen to see the 403.

Access tokens last **15 minutes**. **POST /auth/refresh** gets a new one, using the httpOnly refresh cookie that login set.

## Responses
Success: \`{ "success": true, "data": ..., "meta": ... }\` (\`meta\` carries pagination).
Failure: \`{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }\`.

## Roles
| Role | Permissions |
|---|---|
| Citizen | appointment:book, appointment:view-own, document:upload, ai:use |
| Officer | appointment:view-office, appointment:complete, document:review |
| Content Admin | service:manage, office:manage, requirement:manage, source-document:manage |
| Super Admin | all of the above, plus user:manage and audit:read |

Permissions say **what** a role may do. Ownership and office scope (ABAC) decide **which records**: citizens reach only their own appointments and documents, and officers only those of their own office.

## Notes
- All times are **Addis Ababa time (UTC+3)**. Offices are closed on weekends.
- Names follow the \`Accept-Language\` header (\`am\` or \`en\`).
- Offices, services and requirements in the seed data are **sample data**, not official guidance.
- AI output is advisory. An automatic approval means the document looks valid, and officers verify originals at the counter.
- Rate limits: 20 authentication attempts per 15 minutes per IP and 10 AI requests per minute per user in production, with much higher limits in development. Exceeding them returns 429.`,
  },
  servers: [{ url: '/api/v1', description: 'This server' }],
  tags: [
    { name: 'Health', description: 'Liveness check' },
    { name: 'Auth', description: 'Registration, login, Google sign-in, token refresh, email verification, password reset and staff invitations' },
    { name: 'Catalog', description: 'Public browsing of services, requirements and offices' },
    { name: 'Appointments', description: 'Slots, booking, cancelling and rescheduling' },
    { name: 'Documents', description: 'Uploads, downloads and appeals. Automatic review runs in the background' },
    { name: 'AI', description: 'Smart checklist: describe a situation, get the right service and documents' },
    { name: 'Officer', description: 'The office queue, completing visits, and reviewing documents that need a human' },
    { name: 'Admin: catalog', description: 'Content admin: services, requirements, offices and their links' },
    { name: 'Admin: users', description: 'Super Admin: staff invitations, user status and the audit log' },
  ],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The `accessToken` from login, valid for 15 minutes' },
    },
    parameters: {
      AcceptLanguage: {
        name: 'Accept-Language',
        in: 'header',
        required: false,
        description: '`am` for Amharic. Anything else gives English. Missing Amharic text falls back to English.',
        schema: { type: 'string', examples: ['en', 'am'] },
      },
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { description: 'The result. Its shape depends on the endpoint.' },
          meta: { type: 'object', description: 'Pagination, for list endpoints', additionalProperties: true },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', description: 'A stable, machine-readable code' },
              message: { type: 'string', description: 'A human-readable explanation' },
              details: { description: 'Extra information, for example the list of invalid fields' },
            },
          },
        },
      },
    },
    responses: {
      ValidationError: errorResponse('The request did not pass validation. Every invalid field is listed.', 'VALIDATION_ERROR', 'Invalid request payload', [
        { location: 'body', path: 'password', message: 'Password must contain an uppercase letter' },
      ]),
      Unauthorized: errorResponse('No token, an invalid or expired token, or wrong credentials', 'UNAUTHORIZED', 'Missing or malformed Authorization header'),
      Forbidden: errorResponse('Logged in, but not allowed to do this or to touch this record', 'FORBIDDEN', 'Missing permission: service:manage'),
      NotFound: errorResponse('The record does not exist', 'NOT_FOUND', 'Appointment not found'),
      Conflict: errorResponse('The request conflicts with the current state, for example a full slot or a duplicate', 'SLOT_FULL', 'This time slot is full. Please choose another'),
      PayloadTooLarge: errorResponse('The file is larger than 5 MB', 'FILE_TOO_LARGE', 'The file is too large. The maximum size is 5 MB'),
      UnsupportedMediaType: errorResponse('Not a JPEG, PNG or PDF, or the content does not match the declared type', 'UNSUPPORTED_FILE_TYPE', 'The file content is not a valid JPEG, PNG or PDF'),
      TooManyRequests: errorResponse('Rate limit exceeded', 'TOO_MANY_REQUESTS', 'Too many attempts, please try again later'),
      ServerError: errorResponse('Unexpected error. Details are logged on the server, never returned.', 'INTERNAL_ERROR', 'Something went wrong'),
    },
  },
};