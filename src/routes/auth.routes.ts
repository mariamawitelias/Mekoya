import { Router } from 'express';
import { google, login, logout, logoutAll, me, refresh, register } from '../controllers/auth.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authLimiter } from '../middlewares/rateLimiter.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import { googleBodySchema, loginBodySchema, registerBodySchema } from '../schemas/auth.schema.js';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validateRequest({ body: registerBodySchema }), register);
authRouter.post('/login', authLimiter, validateRequest({ body: loginBodySchema }), login);
authRouter.post('/refresh', authLimiter, refresh);
authRouter.post('/logout', logout);
authRouter.post('/logout-all', authenticate, logoutAll);
authRouter.get('/me', authenticate, me);
authRouter.post('/google', authLimiter, validateRequest({ body: googleBodySchema }), google);