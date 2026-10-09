import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

export function requirePermission(...required: string[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) throw new UnauthorizedError();

    const missing = required.filter((permission) => !user.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenError(`Missing permission: ${missing.join(', ')}`);
    }
    next();
  };
}