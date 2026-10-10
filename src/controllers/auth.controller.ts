import type { Request, Response } from 'express';
import type {
  AcceptInviteBody,
  ForgotPasswordBody,
  GoogleBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from '../schemas/auth.schema.js';
import * as authService from '../services/auth.service.js';
import { AppError, UnauthorizedError } from '../utils/errors.js';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../utils/cookies.js';
import { ok } from '../utils/response.js';
import { requireUser } from '../utils/requestUser.js';
import * as verificationService from '../services/verification.service.js';
import * as userService from '../services/user.service.js';

export async function register(req: Request, res: Response): Promise<void> {
  const body = req.body as RegisterBody;
  const user = await authService.register(body);
  ok(res, user, 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = req.body as LoginBody;
  const { accessToken, refreshToken, user } = await authService.login(body, req.get('user-agent'));
  setRefreshCookie(res, refreshToken);
  ok(res, { accessToken, user });
}

export function me(req: Request, res: Response): void {
  if (!req.user) throw new UnauthorizedError();
  ok(res, req.user);
}
export async function refresh(req: Request, res: Response): Promise<void> {
  const cookie: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof cookie !== 'string' || cookie.length === 0) {
    throw new UnauthorizedError('Missing refresh token');
  }

  try {
    const { accessToken, refreshToken } = await authService.refresh(cookie, req.get('user-agent'));
    setRefreshCookie(res, refreshToken);
    ok(res, { accessToken });
  } catch (error) {

    if (error instanceof AppError) clearRefreshCookie(res);
    throw error;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const cookie: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  await authService.logout(typeof cookie === 'string' ? cookie : undefined);
  clearRefreshCookie(res);
  ok(res, { loggedOut: true });
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  await authService.logoutAll(req.user.id);
  clearRefreshCookie(res);
  ok(res, { loggedOut: true });
}
export async function google(req: Request, res: Response): Promise<void> {
  const { idToken } = req.body as GoogleBody;
  const { accessToken, refreshToken, user } = await authService.loginWithGoogle(idToken, req.get('user-agent'));
  setRefreshCookie(res, refreshToken);
  ok(res, { accessToken, user });
}
export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { token } = req.body as VerifyEmailBody;
  await verificationService.verifyEmail(token);
  ok(res, { verified: true });
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  await verificationService.resendVerification(requireUser(req).id);
  ok(res, { sent: true });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as ForgotPasswordBody;
  await verificationService.requestPasswordReset(email);
  ok(res, { message: 'If that email is registered, a reset link has been sent.' });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body as ResetPasswordBody;
  await verificationService.resetPassword(token, newPassword);
  clearRefreshCookie(res);
  ok(res, { reset: true });
}
export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as AcceptInviteBody;
  await userService.acceptInvite(token, password);
  ok(res, { activated: true });
}