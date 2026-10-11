import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';
import multer from 'multer';
import { MAX_FILE_MB } from '../config/upload.js';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

function isInvalidJsonError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed';
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  let status = 500;
  let error: ErrorBody = { code: 'INTERNAL_ERROR', message: 'Something went wrong' };

  if (err instanceof AppError) {
    status = err.statusCode;
    error = { code: err.code, message: err.message, details: err.details };
  } else if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      error = { code: 'FILE_TOO_LARGE', message: `The file is too large. The maximum size is ${MAX_FILE_MB} MB` };
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400;
      error = { code: 'UNEXPECTED_FILE_FIELD', message: 'Upload exactly one file in a form field named "file"' };
    } else {
      status = 400;
      error = { code: 'UPLOAD_ERROR', message: err.message };
    }
  } else if (err instanceof ZodError) {
    status = 400;
    error = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request payload',
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      error = { code: 'CONFLICT', message: 'Resource already exists', details: err.meta };
    } else if (err.code === 'P2025') {
      status = 404;
      error = { code: 'NOT_FOUND', message: 'Resource not found' };
    } else if (err.code === 'P2003') {
      status = 409;
      error = { code: 'CONFLICT', message: 'Related resource constraint failed' };
    }
  } else if (isInvalidJsonError(err)) {
    status = 400;
    error = { code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  }

  if (status >= 500) {
    logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
  }

  res.status(status).json({ success: false, error });
};