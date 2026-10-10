import type { Request, Response } from 'express';
import {
  idempotencyKeySchema,
  myAppointmentsQuerySchema,
  slotsQuerySchema,
} from '../schemas/appointment.schema.js';
import type { CreateAppointmentBody, RescheduleBody } from '../schemas/appointment.schema.js';
import * as appointmentService from '../services/appointment.service.js';
import { getLanguage } from '../utils/language.js';
import { requireUser } from '../utils/requestUser.js';
import { ok } from '../utils/response.js';

function getRequiredParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) {
    const routeParam = value[0];
    if (typeof routeParam === 'string') return routeParam;
  }
  throw new Error('Missing required route parameter');
}

export async function getSlots(req: Request, res: Response): Promise<void> {
  const appointmentId = getRequiredParam(req.params.id);
  ok(res, await appointmentService.getSlots(appointmentId, slotsQuerySchema.parse(req.query)));
}

export async function book(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateAppointmentBody;
  const headerValue = req.get('idempotency-key');
  const key = idempotencyKeySchema.optional().parse(Array.isArray(headerValue) ? headerValue[0] : headerValue);

  const { appointment, created } = await appointmentService.bookAppointment(requireUser(req).id, body, key);

  if (!created) res.setHeader('Idempotent-Replay', 'true');
  ok(res, appointmentService.toAppointmentDto(appointment, getLanguage(req)), created ? 201 : 200);
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const { items, meta } = await appointmentService.listMyAppointments(
    requireUser(req).id,
    myAppointmentsQuerySchema.parse(req.query),
    getLanguage(req),
  );
  ok(res, items, 200, meta);
}

export async function getMine(req: Request, res: Response): Promise<void> {
  const appointmentId = getRequiredParam(req.params.id);
  ok(res, await appointmentService.getAppointmentDetail(appointmentId, getLanguage(req), 'citizen'));
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const appointmentId = getRequiredParam(req.params.id);
  const appointment = await appointmentService.cancelAppointment(appointmentId, requireUser(req));
  ok(res, appointmentService.toAppointmentDto(appointment, getLanguage(req)));
}

export async function reschedule(req: Request, res: Response): Promise<void> {
  const appointmentId = getRequiredParam(req.params.id);
  const appointment = await appointmentService.rescheduleAppointment(
    appointmentId,
    requireUser(req),
    req.body as RescheduleBody,
  );
  ok(res, appointmentService.toAppointmentDto(appointment, getLanguage(req)));
}