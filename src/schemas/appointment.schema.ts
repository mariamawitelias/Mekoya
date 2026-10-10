import { z } from 'zod';
import { isRealDate } from '../utils/time.js';
import { idString, paginationQuerySchema } from './common.schema.js';

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isRealDate, 'Not a real calendar date');

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, for example 08:30');

const statusEnum = z.enum(['BOOKED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key must be 8 to 100 letters, numbers, hyphens or underscores');

export const slotsQuerySchema = z.object({ date: dateString, serviceId: idString });

export const createAppointmentBodySchema = z.object({
  officeId: idString,
  serviceId: idString,
  date: dateString,
  time: timeString,
});

export const rescheduleBodySchema = z.object({
  officeId: idString.optional(), // omit to keep the same office
  date: dateString,
  time: timeString,
});

export const myAppointmentsQuerySchema = paginationQuerySchema.extend({
  status: statusEnum.optional(),
  upcoming: z.enum(['true', 'false']).optional(),
});

export const officerQueueQuerySchema = paginationQuerySchema.extend({
  date: dateString.optional(), // defaults to today
  status: statusEnum.optional(),
});

export const completeBodySchema = z.object({ closureNote: z.string().trim().min(1).max(500).optional() });

export type SlotsQuery = z.infer<typeof slotsQuerySchema>;
export type CreateAppointmentBody = z.infer<typeof createAppointmentBodySchema>;
export type RescheduleBody = z.infer<typeof rescheduleBodySchema>;
export type MyAppointmentsQuery = z.infer<typeof myAppointmentsQuerySchema>;
export type OfficerQueueQuery = z.infer<typeof officerQueueQuerySchema>;
export type CompleteBody = z.infer<typeof completeBodySchema>;