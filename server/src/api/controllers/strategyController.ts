import type { RequestHandler } from 'express';
import type { StrategyKey } from '@ash/shared';
import type { AppContext } from '../context.js';
import { HttpError } from '../../middleware/errorHandler.js';

export function strategyController(ctx: AppContext) {
  const list: RequestHandler = (_req, res) => {
    res.json(ctx.engine.list().map((s) => s.definition));
  };

  const get: RequestHandler = (req, res) => {
    const strategy = ctx.engine.get(req.params.key as StrategyKey);
    if (!strategy) throw new HttpError(404, 'Strategy not found');
    res.json(strategy.definition);
  };

  return { list, get };
}
