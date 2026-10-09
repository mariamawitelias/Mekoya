import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/jwt.js';

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const payload = verifyAccessToken(header.slice('Bearer '.length));
  req.user = {
    id: payload.sub,
    role: payload.role,
    permissions: payload.permissions,
    officeId: payload.officeId,
  };
  next();
};