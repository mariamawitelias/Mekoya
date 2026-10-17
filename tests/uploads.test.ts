import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { MAX_FILE_BYTES } from '../src/config/upload.js';
import * as auditService from '../src/services/audit.service.js';
import {
  auth,
  bookFor,
  checklistOf,
  cleanTransactionalData,
  http,
  JPEG_BYTES,
  loginAs,
  PDF_BYTES,
  PNG_BYTES,
  type Session,
  upload,
  uploadedFiles,
  USERS,
  waitFor,
} from './helpers.js';

let citizen1: Session;
let citizen2: Session;
let officerBole: Session;
let officerKirkos: Session;
let appointmentId: string;
let itemIds: string[];

beforeAll(async () => {
  citizen1 = await loginAs(USERS.citizen1);
  citizen2 = await loginAs(USERS.citizen2);
  officerBole = await loginAs(USERS.officerBole);
  officerKirkos = await loginAs(USERS.officerKirkos);
});

beforeEach(async () => {
  await cleanTransactionalData();
  appointmentId = await bookFor(citizen1);
  itemIds = (await checklistOf(citizen1, appointmentId)).filter((item) => item.isMandatory).map((item) => item.id);
});

const statusOf = async (documentId: string) =>
  (await prisma.documentSubmission.findUniqueOrThrow({ where: { id: documentId } })).status;

describe('upload validation', () => {
  it('requires a file', async () => {
    const res = await http()
      .post(`/api/v1/appointments/${appointmentId}/documents`)
      .set(auth(citizen1))
      .field('serviceRequirementId', itemIds[0]!);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_REQUIRED');
  });

  it('requires the checklist item id', async () => {
    const res = await http()
      .post(`/api/v1/appointments/${appointmentId}/documents`)
      .set(auth(citizen1))
      .attach('file', PNG_BYTES, { filename: 'good.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(uploadedFiles()).toHaveLength(0);
  });

  it('rejects file types outside the allowlist before anything is saved', async () => {
    const res = await upload(citizen1, appointmentId, itemIds[0]!, 'notes.txt', Buffer.from('plain text'), 'text/plain');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(uploadedFiles()).toHaveLength(0);
  });

  it('catches text disguised as an image by reading the file content', async () => {
    const res = await upload(citizen1, appointmentId, itemIds[0]!, 'fake.jpg', Buffer.from('this is not an image'), 'image/jpeg');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(uploadedFiles()).toHaveLength(0);
  });

  it('catches a file whose content does not match its declared type', async () => {
    const res = await upload(citizen1, appointmentId, itemIds[0]!, 'pdf-as-png.png', PDF_BYTES, 'image/png');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE_MISMATCH');
    expect(uploadedFiles()).toHaveLength(0);
  });

  it('accepts JPEG, PNG and PDF', async () => {
    const jpeg = await upload(citizen1, appointmentId, itemIds[0]!, 'a.jpg', JPEG_BYTES, 'image/jpeg');
    const png = await upload(citizen1, appointmentId, itemIds[1]!, 'b.png', PNG_BYTES, 'image/png');
    const pdf = await upload(citizen1, appointmentId, itemIds[2]!, 'c.pdf', PDF_BYTES, 'application/pdf');

    expect([jpeg.status, png.status, pdf.status]).toEqual([201, 201, 201]);
    expect(uploadedFiles().map((name) => path.extname(name)).sort()).toEqual(['.jpg', '.pdf', '.png']);
  });

  it('rejects files over 5 MB', async () => {
    const tooBig = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_FILE_BYTES)]);
    const res = await upload(citizen1, appointmentId, itemIds[0]!, 'huge.png', tooBig);

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(uploadedFiles()).toHaveLength(0);
  });
});

describe('storing the upload', () => {
  it('saves the file under a random name and never exposes server paths', async () => {
    const res = await upload(citizen1, appointmentId, itemIds[0]!, 'My Passport (final).PNG');

    expect(res.status).toBe(201);
    expect(res.body.data.document).toMatchObject({ version: 1, status: 'PENDING', mimeType: 'image/png', sizeBytes: PNG_BYTES.length });
    expect(JSON.stringify(res.body)).not.toContain('filePath');

    const files = uploadedFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.png$/);

    const row = await prisma.documentSubmission.findUniqueOrThrow({ where: { id: res.body.data.document.id } });
    expect(row.filePath).toBe(files[0]);
    expect(row.mimeType).toBe('image/png');
  });

  it('cannot be tricked into writing outside the upload folder with a hostile file name', async () => {
    const res = await upload(citizen1, appointmentId, itemIds[0]!, '../../evil.png');

    expect(res.status).toBe(201);
    expect(uploadedFiles()).toHaveLength(1);
    expect(uploadedFiles()[0]).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(existsSync(path.resolve('evil.png'))).toBe(false);
  });

  it('keeps old versions when a document is replaced', async () => {
    const first = await upload(citizen1, appointmentId, itemIds[0]!, 'unsure-1.png'); // the mock AI sends it to a human
    await waitFor(async () => (await statusOf(first.body.data.document.id)) === 'NEEDS_HUMAN');

    const second = await upload(citizen1, appointmentId, itemIds[0]!, 'unsure-2.png');
    expect(second.status).toBe(201);
    expect(second.body.data.document.version).toBe(2);

    const rows = await prisma.documentSubmission.findMany({ orderBy: { version: 'asc' } });
    expect(rows.map((row) => [row.version, row.isCurrent])).toEqual([[1, false], [2, true]]);
    expect(uploadedFiles()).toHaveLength(2); // history is kept
  });

  it('does not let an approved document be replaced', async () => {
    const first = await upload(citizen1, appointmentId, itemIds[0]!, 'good.png');
    await waitFor(async () => (await statusOf(first.body.data.document.id)) === 'AI_APPROVED');

    const again = await upload(citizen1, appointmentId, itemIds[0]!, 'swapped.png');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DOCUMENT_ALREADY_APPROVED');
    expect(uploadedFiles()).toHaveLength(1); // the rejected upload left nothing behind
  });

  it('removes the stored file when the database write fails', async () => {
    const spy = vi.spyOn(auditService, 'recordAudit').mockRejectedValueOnce(new Error('simulated database failure'));
    try {
      const res = await upload(citizen1, appointmentId, itemIds[0]!, 'good.png');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).not.toContain('simulated'); // internals are never leaked
      expect(await prisma.documentSubmission.count()).toBe(0);
      expect(uploadedFiles()).toHaveLength(0); // no orphaned file
    } finally {
      spy.mockRestore();
    }
  });
});

describe('who may upload', () => {
  it("refuses another citizen's appointment without saving anything", async () => {
    const res = await upload(citizen2, appointmentId, itemIds[0]!, 'good.png');

    expect(res.status).toBe(403);
    expect(uploadedFiles()).toHaveLength(0);
    expect(await prisma.documentSubmission.count()).toBe(0);
  });

  it('requires a token', async () => {
    const res = await http()
      .post(`/api/v1/appointments/${appointmentId}/documents`)
      .field('serviceRequirementId', itemIds[0]!)
      .attach('file', PNG_BYTES, { filename: 'good.png', contentType: 'image/png' });

    expect(res.status).toBe(401);
  });

  it('rejects a checklist item that belongs to a different service', async () => {
    const foreign = await prisma.serviceRequirement.findFirstOrThrow({ where: { serviceId: 'svc-tin' } });
    const res = await upload(citizen1, appointmentId, foreign.id, 'good.png');

    expect(res.status).toBe(404);
    expect(uploadedFiles()).toHaveLength(0);
  });

  it('refuses uploads to a cancelled appointment', async () => {
    await http().patch(`/api/v1/appointments/${appointmentId}/cancel`).set(auth(citizen1));
    const res = await upload(citizen1, appointmentId, itemIds[0]!, 'good.png');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
    expect(uploadedFiles()).toHaveLength(0);
  });
});

describe('downloading', () => {
  async function uploadedDocumentId(): Promise<string> {
    const res = await upload(citizen1, appointmentId, itemIds[0]!, 'good.png');
    return res.body.data.document.id as string;
  }

  it('gives the owner the exact bytes as an attachment', async () => {
    const id = await uploadedDocumentId();
    const res = await http().get(`/api/v1/documents/${id}/file`).set(auth(citizen1));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(Buffer.isBuffer(res.body) && res.body.equals(PNG_BYTES)).toBe(true);
  });

  it("blocks other citizens and officers from other offices, but lets this office's officer in", async () => {
    const id = await uploadedDocumentId();
    const fetchAs = (session: Session) => http().get(`/api/v1/documents/${id}/file`).set(auth(session));

    expect((await fetchAs(citizen2)).status).toBe(403);
    expect((await fetchAs(officerKirkos)).status).toBe(403);
    expect((await fetchAs(officerBole)).status).toBe(200);
    expect((await http().get(`/api/v1/documents/${id}/file`)).status).toBe(401);
  });

  it('answers 404 for an unknown document', async () => {
    const res = await http().get('/api/v1/documents/00000000-0000-0000-0000-000000000000/file').set(auth(citizen1));
    expect(res.status).toBe(404);
  });
});