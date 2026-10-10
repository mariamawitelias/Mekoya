import type { AppointmentStatus } from '@prisma/client';

export const APPOINTMENT_RULES = {
  minLeadMinutes: 60,
  maxAdvanceDays: 60,
  cancelCutoffHours: 12,
  maxOpenPerService: 2,
  completeEarlyMinutes: 30,
  noShowGraceMinutes: 30,
} as const;

export const CAPACITY_STATUSES: AppointmentStatus[] = ['BOOKED', 'CONFIRMED', 'COMPLETED'];

export const OPEN_STATUSES: AppointmentStatus[] = ['BOOKED', 'CONFIRMED'];