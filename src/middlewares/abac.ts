import type { RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { canAccessOwnedResource } from '../utils/access.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { requireUser } from '../utils/requestUser.js';

function getAppointmentIdParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function loadAppointmentRef(id: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: { userId: true, officeId: true },
  });
  if (!appointment) throw new NotFoundError('Appointment not found');
  return appointment;
}

// Citizens: the appointment must be theirs (Super Admin has elevated rights)
export const requireOwnership: RequestHandler = async (req, _res, next) => {
  const user = requireUser(req);
  const appointmentId = getAppointmentIdParam(req.params.id);
  if (!appointmentId) throw new NotFoundError('Appointment not found');

  const appointment = await loadAppointmentRef(appointmentId);

  if (!canAccessOwnedResource(user, appointment.userId)) {
    throw new ForbiddenError('You can only access your own appointments');
  }
  next();
};

// Officers: the appointment must belong to the office they are assigned to
export const requireOfficeScope: RequestHandler = async (req, _res, next) => {
  const user = requireUser(req);
  const appointmentId = getAppointmentIdParam(req.params.id);
  if (!appointmentId) throw new NotFoundError('Appointment not found');

  const appointment = await loadAppointmentRef(appointmentId);

  if (!user.officeId || appointment.officeId !== user.officeId) {
    throw new ForbiddenError('This appointment belongs to a different office');
  }
  next();
};