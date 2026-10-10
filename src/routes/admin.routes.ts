import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import {
  createOfficeBodySchema,
  createRequirementBodySchema,
  createServiceBodySchema,
  linkRequirementBodySchema,
  officeServiceBodySchema,
  officeServiceParamsSchema,
  serviceRequirementParamsSchema,
  updateOfficeBodySchema,
  updateRequirementBodySchema,
  updateServiceBodySchema,
} from '../schemas/catalog.schema.js';
import { idParamSchema } from '../schemas/common.schema.js';

export const adminRouter = Router();

adminRouter.use(authenticate); // every admin route requires a valid access token

// Services
adminRouter.post('/services', requirePermission('service:manage'), validateRequest({ body: createServiceBodySchema }), admin.createService);
adminRouter.patch('/services/:id', requirePermission('service:manage'), validateRequest({ params: idParamSchema, body: updateServiceBodySchema }), admin.updateService);
adminRouter.delete('/services/:id', requirePermission('service:manage'), validateRequest({ params: idParamSchema }), admin.deactivateService);
adminRouter.put('/services/:id/requirements/:requirementId', requirePermission('service:manage'), validateRequest({ params: serviceRequirementParamsSchema, body: linkRequirementBodySchema }), admin.setServiceRequirement);
adminRouter.delete('/services/:id/requirements/:requirementId', requirePermission('service:manage'), validateRequest({ params: serviceRequirementParamsSchema }), admin.removeServiceRequirement);

// Requirements
adminRouter.post('/requirements', requirePermission('requirement:manage'), validateRequest({ body: createRequirementBodySchema }), admin.createRequirement);
adminRouter.patch('/requirements/:id', requirePermission('requirement:manage'), validateRequest({ params: idParamSchema, body: updateRequirementBodySchema }), admin.updateRequirement);
adminRouter.delete('/requirements/:id', requirePermission('requirement:manage'), validateRequest({ params: idParamSchema }), admin.deactivateRequirement);

// Offices
adminRouter.post('/offices', requirePermission('office:manage'), validateRequest({ body: createOfficeBodySchema }), admin.createOffice);
adminRouter.patch('/offices/:id', requirePermission('office:manage'), validateRequest({ params: idParamSchema, body: updateOfficeBodySchema }), admin.updateOffice);
adminRouter.delete('/offices/:id', requirePermission('office:manage'), validateRequest({ params: idParamSchema }), admin.deactivateOffice);
adminRouter.put('/offices/:id/services/:serviceId', requirePermission('office:manage'), validateRequest({ params: officeServiceParamsSchema, body: officeServiceBodySchema }), admin.setOfficeService);
adminRouter.delete('/offices/:id/services/:serviceId', requirePermission('office:manage'), validateRequest({ params: officeServiceParamsSchema }), admin.removeOfficeService);