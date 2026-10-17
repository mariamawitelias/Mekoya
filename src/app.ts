import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFoundHandler } from './middlewares/notFound.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { catalogRouter } from './routes/catalog.routes.js';
import { appointmentRouter } from './routes/appointment.routes.js';
import { officerRouter } from './routes/officer.routes.js';
import { documentRouter } from './routes/document.routes.js';
import { aiRouter } from './routes/ai.routes.js';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './docs/openapi.js';

export const app = express();
app.get('/api/docs.json', (_req, res) => {
  res.json(openApiDocument);
});
app.use(
  '/api/docs',
  helmet({ contentSecurityPolicy: false }),
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: 'Mekoya API docs',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  }),
);
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(
  pinoHttp({
    logger,
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/officer', officerRouter);
app.use('/api/v1', appointmentRouter);
app.use('/api/v1', catalogRouter);
app.use('/api/v1/catalog', catalogRouter);
app.use('/api/v1', documentRouter);
app.use('/api/v1/ai', aiRouter);
app.use(notFoundHandler);
app.use(errorHandler);