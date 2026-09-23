import type { AlertHistoryFilters, ScenarioId, Timeframe } from '@ash/shared';
import type { AppContext } from '../context';
import { HttpError, type Handler } from '../http';

function parseFilters(q: URLSearchParams): AlertHistoryFilters {
  const str = (k: string) => q.get(k) || undefined;
  const num = (k: string) => {
    const v = q.get(k);
    const n = Number(v);
    return v && Number.isFinite(n) ? n : undefined;
  };
  const scenario = num('scenario');
  return {
    from: str('from'),
    to: str('to'),
    underlying: str('underlying'),
    expiry: str('expiry'),
    timeframe: str('timeframe') as Timeframe | undefined,
    scenario: scenario === 1 || scenario === 2 ? (scenario as ScenarioId) : undefined,
    strategyId: str('strategyId'),
    groupId: str('groupId'),
    configId: str('configId'),
    limit: Math.min(num('limit') ?? 100, 1000),
    offset: num('offset'),
  };
}

export function alertController(ctx: AppContext) {
  const list: Handler = (req) => ctx.alertService.list(parseFilters(req.query));

  const get: Handler = async (req) => {
    const alert = await ctx.alertService.getById(req.params.id!);
    if (!alert) throw new HttpError(404, 'Alert not found');
    return alert;
  };

  return { list, get };
}
