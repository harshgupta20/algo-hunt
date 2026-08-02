import { pino } from 'pino';
import { config } from '../config/index.js';

/**
 * Centralized structured logger. Pretty-prints in development, JSON in prod.
 */
export const logger = pino({
  level: config.logLevel,
  ...(config.isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }),
});

/** Create a child logger tagged with a component name. */
export function childLogger(component: string) {
  return logger.child({ component });
}
