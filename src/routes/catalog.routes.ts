import { Router } from 'express';
import { getService, listOffices, listServices } from '../controllers/catalog.controller.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import { idParamSchema } from '../schemas/common.schema.js';
import { listOfficesQuerySchema, listServicesQuerySchema } from '../schemas/catalog.schema.js';

export const catalogRouter = Router();

catalogRouter.get('/services', validateRequest({ query: listServicesQuerySchema }), listServices);
catalogRouter.get('/services/:id', validateRequest({ params: idParamSchema }), getService);
catalogRouter.get('/offices', validateRequest({ query: listOfficesQuerySchema }), listOffices);