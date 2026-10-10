import type { Request, Response } from 'express';
import type {
  CreateOfficeBody,
  CreateRequirementBody,
  CreateServiceBody,
  LinkRequirementBody,
  OfficeServiceBody,
  UpdateOfficeBody,
  UpdateRequirementBody,
  UpdateServiceBody,
} from '../schemas/catalog.schema.js';
import * as catalogService from '../services/catalog.service.js';
import { ok } from '../utils/response.js';
import { requireUser } from '../utils/requestUser.js';

const getRouteParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    const firstValue = value[0];
    if (typeof firstValue !== 'string' || firstValue.length === 0) {
      throw new Error('Missing route parameter');
    }
    return firstValue;
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Missing route parameter');
  }

  return value;
};

// ── Services ──
export async function createService(req: Request, res: Response): Promise<void> {
  ok(res, await catalogService.createService(req.body as CreateServiceBody, requireUser(req).id), 201);
}
export async function updateService(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  ok(res, await catalogService.updateService(id, req.body as UpdateServiceBody, requireUser(req).id));
}
export async function deactivateService(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  ok(res, await catalogService.updateService(id, { isActive: false }, requireUser(req).id));
}
export async function setServiceRequirement(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  const requirementId = getRouteParam(req.params.requirementId);
  ok(res, await catalogService.setServiceRequirement(id, requirementId, req.body as LinkRequirementBody, requireUser(req).id));
}
export async function removeServiceRequirement(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  const requirementId = getRouteParam(req.params.requirementId);
  ok(res, await catalogService.removeServiceRequirement(id, requirementId, requireUser(req).id));
}

// ── Requirements ──
export async function createRequirement(req: Request, res: Response): Promise<void> {
  ok(res, await catalogService.createRequirement(req.body as CreateRequirementBody, requireUser(req).id), 201);
}
export async function updateRequirement(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  ok(res, await catalogService.updateRequirement(id, req.body as UpdateRequirementBody, requireUser(req).id));
}
export async function deactivateRequirement(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  ok(res, await catalogService.updateRequirement(id, { isActive: false }, requireUser(req).id));
}

// ── Offices ──
export async function createOffice(req: Request, res: Response): Promise<void> {
  ok(res, await catalogService.createOffice(req.body as CreateOfficeBody, requireUser(req).id), 201);
}
export async function updateOffice(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  ok(res, await catalogService.updateOffice(id, req.body as UpdateOfficeBody, requireUser(req).id));
}
export async function deactivateOffice(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  ok(res, await catalogService.updateOffice(id, { isActive: false }, requireUser(req).id));
}
export async function setOfficeService(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  const serviceId = getRouteParam(req.params.serviceId);
  ok(res, await catalogService.setOfficeService(id, serviceId, req.body as OfficeServiceBody, requireUser(req).id));
}
export async function removeOfficeService(req: Request, res: Response): Promise<void> {
  const id = getRouteParam(req.params.id);
  const serviceId = getRouteParam(req.params.serviceId);
  ok(res, await catalogService.removeOfficeService(id, serviceId, requireUser(req).id));
}