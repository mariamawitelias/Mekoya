import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

const accessPayloadSchema = z.object({
  sub: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
  officeId: z.string().nullable(),
});

export type AccessTokenPayload = z.infer<typeof accessPayloadSchema>;

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    return accessPayloadSchema.parse(decoded);
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}