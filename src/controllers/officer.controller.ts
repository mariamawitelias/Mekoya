import type { Request, Response } from 'express';
import { officerQueueQuerySchema } from '../schemas/appointment.schema.js';
import type { CompleteBody } from '../schemas/appointment.schema.js';
import { getAppointmentDetail } from '../services/appointment.service.js';
import * as officerService from '../services/officer.service.js';
import { ForbiddenError } from '../utils/errors.js';
import { getLanguage } from '../utils/language.js';
import { requireUser } from '../utils/requestUser.js';
import { ok } from '../utils/response.js';

function getRequiredParamId(req: Request, paramName: string): string {
  const value = req.params[paramName];

  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const firstValue = value[0];
    if (typeof firstValue === 'string') return firstValue;
  }

  throw new Error(`${paramName} is required`);
}

export async function queue(req: Request, res: Response): Promise<void> {
  const officer = requireUser(req);
  if (!officer.officeId) throw new ForbiddenError('You are not assigned to an office');

  const { items, meta, date } = await officerService.listOfficeQueue(
    officer.officeId,
    officerQueueQuerySchema.parse(req.query),
    getLanguage(req),
  );
  ok(res, items, 200, { ...meta, date });
}

export async function detail(req: Request, res: Response): Promise<void> {
  const appointmentId = getRequiredParamId(req, 'id');
  ok(res, await getAppointmentDetail(appointmentId, getLanguage(req), 'staff'));
}

export async function complete(req: Request, res: Response): Promise<void> {
  const { closureNote } = req.body as CompleteBody;
  const appointmentId = getRequiredParamId(req, 'id');
  ok(res, await officerService.completeAppointment(appointmentId, requireUser(req), closureNote));
}

export async function noShow(req: Request, res: Response): Promise<void> {
  const appointmentId = getRequiredParamId(req, 'id');
  ok(res, await officerService.markNoShow(appointmentId, requireUser(req)));
}