import cors from 'cors';
import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler.js';
import type { AppContext } from './context.js';
import { createRouter } from './routes/index.js';

export function createApp(ctx: AppContext): Express {
  const app = express();

  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json());
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  app.use('/api', createRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
