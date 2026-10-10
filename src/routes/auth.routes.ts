import { Router } from 'express';
import {
  acceptInvite,
  forgotPassword,
  google,
  login,
  logout,
  logoutAll,
  me,
  refresh,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
} from '../controllers/auth.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authLimiter } from '../middlewares/rateLimiter.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import {
  acceptInviteBodySchema,
  forgotPasswordBodySchema,
  googleBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  verifyEmailBodySchema,
} from '../schemas/auth.schema.js';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validateRequest({ body: registerBodySchema }), register);
authRouter.post('/login', authLimiter, validateRequest({ body: loginBodySchema }), login);
authRouter.post('/refresh', authLimiter, refresh);
authRouter.post('/logout', logout);
authRouter.post('/logout-all', authenticate, logoutAll);
authRouter.get('/me', authenticate, me);
authRouter.post('/google', authLimiter, validateRequest({ body: googleBodySchema }), google);
authRouter.post('/verify-email', authLimiter, validateRequest({ body: verifyEmailBodySchema }), verifyEmail);
authRouter.post('/resend-verification', authLimiter, authenticate, resendVerification);
authRouter.post('/forgot-password', authLimiter, validateRequest({ body: forgotPasswordBodySchema }), forgotPassword);
authRouter.post('/reset-password', authLimiter, validateRequest({ body: resetPasswordBodySchema }), resetPassword);
authRouter.post('/accept-invite', authLimiter, validateRequest({ body: acceptInviteBodySchema }), acceptInvite);