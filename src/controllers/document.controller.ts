import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { UploadDocumentBody } from '../schemas/document.schema.js';
import * as documentService from '../services/document.service.js';
import { requireUser } from '../utils/requestUser.js';
import { ok } from '../utils/response.js';
import * as reviewService from '../services/documentReview.service.js';

export async function upload(req: Request, res: Response): Promise<void> {
  const { serviceRequirementId } = req.body as UploadDocumentBody;
  const appointmentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!appointmentId) {
    res.status(400).json({ message: 'Appointment id is required' });
    return;
  }

  const result = await documentService.uploadDocument({
    appointmentId,
    serviceRequirementId,
    file: req.file,
    actor: requireUser(req),
  });
  ok(res, result, 201);
}

export async function download(req: Request, res: Response): Promise<void> {
  const appointmentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!appointmentId) {
    res.status(400).json({ message: 'Appointment id is required' });
    return;
  }

  const file = await documentService.openDocumentFile(appointmentId, requireUser(req));

  res.attachment(file.originalName); 
  res.type(file.mimeType); 
  res.setHeader('Content-Length', file.size);
  await pipeline(file.stream, res);
}
export async function appeal(req: Request, res: Response): Promise<void> {
  const appointmentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!appointmentId) {
    res.status(400).json({ message: 'Appointment id is required' });
    return;
  }

  ok(res, await reviewService.appealDocument(appointmentId, requireUser(req)));
}