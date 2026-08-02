import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../utils/logger.js';

/** Error carrying an intended HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

/** Kite's SDK (and some libs) reject with plain objects, not Errors. */
function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Internal server error';
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) logger.error({ err }, 'unhandled request error');
  res.status(status).json({ error: extractMessage(err) });
}

/** Wrap an async handler so rejected promises reach the error middleware. */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
