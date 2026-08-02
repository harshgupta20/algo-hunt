import type { RequestHandler } from 'express';
import type { AppContext } from '../context.js';

export function analyticsController(ctx: AppContext) {
  const summary: RequestHandler = async (_req, res) => {
    res.json(await ctx.alertService.analytics());
  };
  return { summary };
}
