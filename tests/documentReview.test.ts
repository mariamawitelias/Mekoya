import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { setReviewerForTests } from '../src/services/ai.service.js';
import {
  auth,
  bookFor,
  checklistOf,
  cleanTransactionalData,
  http,
  loginAs,
  type Session,
  upload,
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

afterEach(() => setReviewerForTests(undefined));

const documentRow = (id: string) => prisma.documentSubmission.findUniqueOrThrow({ where: { id } });
const appointmentRow = () => prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });

async function uploadAndWait(itemIndex: number, filename: string): Promise<string> {
  const res = await upload(citizen1, appointmentId, itemIds[itemIndex]!, filename);
  expect(res.status).toBe(201);
  const id = res.body.data.document.id as string;
  await waitFor(async () => (await documentRow(id)).status !== 'PENDING');
  return id;
}

describe('automatic review decisions', () => {
  it('approves a clean document', async () => {
    const id = await uploadAndWait(0, 'good.png');
    const row = await documentRow(id);

    expect(row.status).toBe('AI_APPROVED');
    expect(row.aiStatus).toBe('DONE');
    expect(row.aiConfidence).toBeGreaterThan(0.85);
    expect(row.rejectionReason).toBeNull();
  });

  it('rejects an unreadable document with a fixed, citizen-safe reason, and emails the citizen', async () => {
    const id = await uploadAndWait(0, 'blurry.png');
    const row = await documentRow(id);

    expect(row.status).toBe('AI_REJECTED');
    expect(row.rejectionReason).toContain('not clearly readable');
    expect(row.rejectionReason).not.toContain('Text is blurred'); // the model's own words never reach the citizen

    await waitFor(async () => (await prisma.emailLog.count({ where: { template: 'DOCUMENT_REJECTED', status: 'SENT' } })) === 1);
  });

  it('rejects the wrong kind of document', async () => {
    const row = await documentRow(await uploadAndWait(0, 'wrong.png'));

    expect(row.status).toBe('AI_REJECTED');
    expect(row.rejectionReason).toContain('does not look like the requested document');
  });

  it('sends low-confidence documents to a human', async () => {
    const row = await documentRow(await uploadAndWait(0, 'unsure.png'));

    expect(row.status).toBe('NEEDS_HUMAN');
    expect(row.aiStatus).toBe('DONE');
  });

  it('falls back to a human when the AI provider fails, and the upload itself still succeeds', async () => {
    const row = await documentRow(await uploadAndWait(0, 'fail.png'));

    expect(row.status).toBe('NEEDS_HUMAN');
    expect(row.aiStatus).toBe('FALLBACK');
    expect(JSON.stringify(row.aiResult)).toContain('Mock AI failure');
  });

  it('falls back to a human when the AI returns output in the wrong shape', async () => {
    setReviewerForTests({ name: 'broken', review: async () => ({ looksFine: 'yes' }) });

    const row = await documentRow(await uploadAndWait(0, 'good.png'));
    expect(row.status).toBe('NEEDS_HUMAN');
    expect(row.aiStatus).toBe('FALLBACK');
  });
});

describe('auto-confirm', () => {
  it('confirms the appointment once every mandatory document is approved', async () => {
    for (const [index] of itemIds.entries()) await uploadAndWait(index, `good-${index}.png`);

    await waitFor(async () => (await appointmentRow()).status === 'CONFIRMED');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'APPOINTMENT_AUTO_CONFIRMED', entityId: appointmentId } });
    expect(audit.actorId).toBeNull(); // a system action, not a person
  });

  it('stays BOOKED while any mandatory document is missing or rejected', async () => {
    await uploadAndWait(0, 'good-0.png');
    await uploadAndWait(1, 'good-1.png');
    await uploadAndWait(2, 'blurry-2.png');

    expect((await appointmentRow()).status).toBe('BOOKED');
  });

  it('confirms correctly even when all documents are reviewed at the same moment', async () => {
    const results = await Promise.all(itemIds.map((itemId, index) => upload(citizen1, appointmentId, itemId, `good-${index}.png`)));
    expect(results.map((res) => res.status)).toEqual([201, 201, 201, 201]);

    await waitFor(async () => (await appointmentRow()).status === 'CONFIRMED');
    const documents = await prisma.documentSubmission.findMany({ where: { isCurrent: true } });
    expect(documents.every((doc) => doc.status === 'AI_APPROVED')).toBe(true);
  });
});

describe('appeal', () => {
  it('lets the owner send an AI rejection to a human', async () => {
    const id = await uploadAndWait(0, 'blurry.png');

    expect((await http().post(`/api/v1/documents/${id}/appeal`).set(auth(citizen2))).status).toBe(403);

    const res = await http().post(`/api/v1/documents/${id}/appeal`).set(auth(citizen1));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('NEEDS_HUMAN');
    expect((await documentRow(id)).appealRequested).toBe(true);
  });

  it('only allows appealing documents the AI rejected', async () => {
    const id = await uploadAndWait(0, 'good.png');

    const res = await http().post(`/api/v1/documents/${id}/appeal`).set(auth(citizen1));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });
});

describe('officer review', () => {
  it("shows needs-human documents only to the officer of that appointment's office", async () => {
    const id = await uploadAndWait(0, 'unsure.png');
    const idsFor = async (session: Session): Promise<string[]> => {
      const res = await http().get('/api/v1/officer/documents').set(auth(session));
      expect(res.status).toBe(200);
      return (res.body.data as Array<{ id: string }>).map((doc) => doc.id);
    };

    expect(await idsFor(officerBole)).toContain(id);
    expect(await idsFor(officerKirkos)).not.toContain(id);
  });

  it('enforces office scope and requires a reason to reject', async () => {
    const id = await uploadAndWait(0, 'unsure.png');
    const review = (session: Session, body: object) =>
      http().patch(`/api/v1/officer/documents/${id}/review`).set(auth(session)).send(body);

    expect((await review(officerKirkos, { decision: 'APPROVE' })).status).toBe(403);
    expect((await review(citizen1, { decision: 'APPROVE' })).status).toBe(403);

    const noReason = await review(officerBole, { decision: 'REJECT' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].path).toBe('reason');

    const approved = await review(officerBole, { decision: 'APPROVE', reason: 'Readable at the counter' });
    expect(approved.status).toBe(200);
    expect((await documentRow(id)).status).toBe('OFFICER_APPROVED');
  });

  it('lets an officer override an AI approval, which un-confirms the appointment, and the citizen can re-upload', async () => {
    const ids: string[] = [];
    for (const [index] of itemIds.entries()) ids.push(await uploadAndWait(index, `good-${index}.png`));
    await waitFor(async () => (await appointmentRow()).status === 'CONFIRMED');

    const override = await http()
      .patch(`/api/v1/officer/documents/${ids[0]}/review`)
      .set(auth(officerBole))
      .send({ decision: 'REJECT', reason: 'The photo does not match the applicant' });
    expect(override.status).toBe(200);
    expect(override.body.data.appointmentStatus).toBe('BOOKED');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'DOCUMENT_OFFICER_REVIEWED', entityId: ids[0]! } });
    expect(audit.metadata).toMatchObject({ previousStatus: 'AI_APPROVED', newStatus: 'OFFICER_REJECTED' });
    expect(audit.actorId).toBe(officerBole.userId);
    await waitFor(async () => (await prisma.emailLog.count({ where: { template: 'DOCUMENT_REJECTED' } })) >= 1);

    const replacement = await upload(citizen1, appointmentId, itemIds[0]!, 'replacement.png');
    expect(replacement.status).toBe(201);
    expect(replacement.body.data.document.version).toBe(2);
    await waitFor(async () => (await appointmentRow()).status === 'CONFIRMED');
  });
});