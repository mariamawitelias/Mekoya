import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError } from '../utils/errors.js';

interface RequestSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

interface ValidationIssue {
  location: 'body' | 'query' | 'params';
  path: string;
  message: string;
}

const LOCATIONS = ['body', 'query', 'params'] as const;

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const issues: ValidationIssue[] = [];

    for (const location of LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;

      const result = schema.safeParse(req[location]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({ location, path: issue.path.join('.'), message: issue.message });
        }
        continue;
      }

      Object.defineProperty(req, location, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    if (issues.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request payload', issues);
    }
    next();
  };
}