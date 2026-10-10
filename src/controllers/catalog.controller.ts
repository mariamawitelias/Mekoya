import type { Request, Response } from 'express';
import { listOfficesQuerySchema, listServicesQuerySchema } from '../schemas/catalog.schema.js';
import * as catalogService from '../services/catalog.service.js';
import { getLanguage } from '../utils/language.js';
import { ok } from '../utils/response.js';

export async function listServices(req: Request, res: Response): Promise<void> {
  const query = listServicesQuerySchema.parse(req.query);
  const { items, meta } = await catalogService.listServices(query, getLanguage(req));
  ok(res, items, 200, meta);
}

export async function getService(req: Request, res: Response): Promise<void> {
  const serviceId = req.params.id;

  if (typeof serviceId !== 'string') {
    res.status(400).send('Invalid service id');
    return;
  }

  ok(res, await catalogService.getService(serviceId, getLanguage(req)));
}

export async function listOffices(req: Request, res: Response): Promise<void> {
  const query = listOfficesQuerySchema.parse(req.query);
  ok(res, await catalogService.listOffices(query, getLanguage(req)));
}