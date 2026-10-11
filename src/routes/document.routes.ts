import { Router } from 'express';
import * as controller from '../controllers/document.controller.js';
import { requireOwnership } from '../middlewares/abac.js';
import { authenticate } from '../middlewares/authenticate.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { uploadSingleFile } from '../middlewares/upload.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import { idParamSchema } from '../schemas/common.schema.js';
import { uploadDocumentBodySchema } from '../schemas/document.schema.js';

export const documentRouter = Router();

documentRouter.post(
  '/appointments/:id/documents',
  authenticate,
  requirePermission('document:upload'),
  validateRequest({ params: idParamSchema }),
  requireOwnership, 
  uploadSingleFile,
  validateRequest({ body: uploadDocumentBodySchema }), 
  controller.upload,
);

documentRouter.get(
  '/documents/:id/file',
  authenticate,
  validateRequest({ params: idParamSchema }),
  controller.download, 
);