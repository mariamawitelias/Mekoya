import { Router } from 'express';
import { checklist } from '../controllers/ai.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { aiLimiter } from '../middlewares/rateLimiter.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import { checklistBodySchema } from '../schemas/checklist.schema.js';

export const aiRouter = Router();

aiRouter.post(
  '/checklist',
  authenticate,
  requirePermission('ai:use'),
  aiLimiter,
  validateRequest({ body: checklistBodySchema }),
  checklist,
);