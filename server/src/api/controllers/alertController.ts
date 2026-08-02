import type { RequestHandler } from 'express';
import type { AlertHistoryFilters, ScenarioId, Timeframe } from '@ash/shared';
import type { AppContext } from '../context.js';
import { HttpError } from '../../middleware/errorHandler.js';

function parseFilters(query: Record<string, unknown>): AlertHistoryFilters {
  const str = (v: unknown) => (typeof v === 'string' && v.length ? v : undefined);
  const num = (v: unknown) => {
    const n = Number(v);
    return typeof v === 'string' && v.length && Number.isFinite(n) ? n : undefined;
  };
  const scenario = num(query.scenario);
  return {
    from: str(query.from),
    to: str(query.to),
    underlying: str(query.underlying),
    expiry: str(query.expiry),
    timeframe: str(query.timeframe) as Timeframe | undefined,
    scenario: scenario === 1 || scenario === 2 ? (scenario as ScenarioId) : undefined,
    limit: num(query.limit),
    offset: num(query.offset),
  };
}

export function alertController(ctx: AppContext) {
  const list: RequestHandler = async (req, res) => {
    const filters = parseFilters(req.query as Record<string, unknown>);
    res.json(await ctx.alertService.list(filters));
  };

  const get: RequestHandler = async (req, res) => {
    const alert = await ctx.alertService.getById(req.params.id!);
    if (!alert) throw new HttpError(404, 'Alert not found');
    res.json(alert);
  };

  return { list, get };
}
