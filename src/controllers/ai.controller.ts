import type { Request, Response } from 'express';
import type { ChecklistBody } from '../schemas/checklist.schema.js';
import { suggestChecklist } from '../services/checklist.service.js';
import { getLanguage } from '../utils/language.js';
import { ok } from '../utils/response.js';

export async function checklist(req: Request, res: Response): Promise<void> {
  const { description } = req.body as ChecklistBody;
  ok(res, await suggestChecklist(description, getLanguage(req)));
}