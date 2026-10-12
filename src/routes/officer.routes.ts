import { Router } from 'express';
import * as controller from '../controllers/officer.controller.js';
import { requireOfficeScope } from '../middlewares/abac.js';
import { authenticate } from '../middlewares/authenticate.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import { completeBodySchema, officerQueueQuerySchema } from '../schemas/appointment.schema.js';
import { idParamSchema } from '../schemas/common.schema.js';
import { officerDocumentsQuerySchema, reviewDocumentBodySchema } from '../schemas/document.schema.js';

export const officerRouter = Router();

officerRouter.use(authenticate);

officerRouter.get(
  '/appointments',
  requirePermission('appointment:view-office'),
  validateRequest({ query: officerQueueQuerySchema }),
  controller.queue,
);

officerRouter.get(
  '/appointments/:id',
  requirePermission('appointment:view-office'),
  validateRequest({ params: idParamSchema }),
  requireOfficeScope,
  controller.detail,
);

officerRouter.patch(
  '/appointments/:id/complete',
  requirePermission('appointment:complete'),
  validateRequest({ params: idParamSchema, body: completeBodySchema }),
  requireOfficeScope,
  controller.complete,
);

officerRouter.patch(
  '/appointments/:id/no-show',
  requirePermission('appointment:complete'),
  validateRequest({ params: idParamSchema }),
  requireOfficeScope,
  controller.noShow,
);
officerRouter.get(
  '/documents',
  requirePermission('document:review'),
  validateRequest({ query: officerDocumentsQuerySchema }),
  controller.listDocuments,
);

officerRouter.patch(
  '/documents/:id/review',
  requirePermission('document:review'),
  validateRequest({ params: idParamSchema, body: reviewDocumentBodySchema }),
  controller.reviewDocument,
);