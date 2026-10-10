import type { Request, Response } from 'express';
import { auditQuerySchema, listUsersQuerySchema } from '../schemas/user.schema.js';
import type { CreateStaffBody, SetUserStatusBody } from '../schemas/user.schema.js';
import { listAuditLogs } from '../services/audit.service.js';
import * as userService from '../services/user.service.js';
import { requireUser } from '../utils/requestUser.js';
import { ok } from '../utils/response.js';

export async function createStaff(req: Request, res: Response): Promise<void> {
  ok(res, await userService.createStaff(req.body as CreateStaffBody, requireUser(req).id), 201);
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const { items, meta } = await userService.listUsers(listUsersQuerySchema.parse(req.query));
  ok(res, items, 200, meta);
}

export async function setUserStatus(req: Request, res: Response): Promise<void> {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId) {
    throw new Error('User id is required');
  }

  const { isActive } = req.body as SetUserStatusBody;
  ok(res, await userService.setUserActive(userId, isActive, requireUser(req).id));
}

export async function resendInvite(req: Request, res: Response): Promise<void> {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId) {
    throw new Error('User id is required');
  }

  await userService.resendInvite(userId, requireUser(req).id);
  ok(res, { sent: true });
}

export async function getAuditLogs(req: Request, res: Response): Promise<void> {
  const { items, meta } = await listAuditLogs(auditQuerySchema.parse(req.query));
  ok(res, items, 200, meta);
}