import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError, UnauthorizedError } from '../utils/errors.js';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string | null;
}

const client = new OAuth2Client();

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured on this server');
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (error) {
    logger.warn(
      {
        err: error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
      },
      'Google ID token verification failed',
    );
    throw new UnauthorizedError('Invalid Google token');
  }

  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw new UnauthorizedError('Google account email is not verified');
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name ?? null,
  };
}