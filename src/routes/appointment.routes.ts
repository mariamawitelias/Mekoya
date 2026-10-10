import { Router } from 'express';
import * as controller from '../controllers/appointment.controller.js';
import { requireOwnership } from '../middlewares/abac.js';
import { authenticate } from '../middlewares/authenticate.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import {
  createAppointmentBodySchema,
  myAppointmentsQuerySchema,
  rescheduleBodySchema,
  slotsQuerySchema,
} from '../schemas/appointment.schema.js';
import { idParamSchema } from '../schemas/common.schema.js';

export const appointmentRouter = Router();


appointmentRouter.get(
  '/offices/:id/slots',
  validateRequest({ params: idParamSchema, query: slotsQuerySchema }),
  controller.getSlots,
);

appointmentRouter.post(
  '/appointments',
  authenticate,
  requirePermission('appointment:book'),
  validateRequest({ body: createAppointmentBodySchema }),
  controller.book,
);

appointmentRouter.get(
  '/appointments/me',
  authenticate,
  requirePermission('appointment:view-own'),
  validateRequest({ query: myAppointmentsQuerySchema }),
  controller.listMine,
);

appointmentRouter.get(
  '/appointments/:id',
  authenticate,
  requirePermission('appointment:view-own'),
  validateRequest({ params: idParamSchema }),
  requireOwnership,
  controller.getMine,
);

appointmentRouter.patch(
  '/appointments/:id/cancel',
  authenticate,
  requirePermission('appointment:book'),
  validateRequest({ params: idParamSchema }),
  requireOwnership,
  controller.cancel,
);

appointmentRouter.patch(
  '/appointments/:id/reschedule',
  authenticate,
  requirePermission('appointment:book'),
  validateRequest({ params: idParamSchema, body: rescheduleBodySchema }),
  requireOwnership,
  controller.reschedule,
);