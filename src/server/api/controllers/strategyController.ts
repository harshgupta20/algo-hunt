import type { StrategyKey } from '@ash/shared';
import type { AppContext } from '../context';
import { HttpError, type Handler } from '../http';

export function strategyController(ctx: AppContext) {
  const list: Handler = () => ctx.engine.list().map((s) => s.definition);

  const get: Handler = (req) => {
    const strategy = ctx.engine.get(req.params.key as StrategyKey);
    if (!strategy) throw new HttpError(404, 'Strategy not found');
    return strategy.definition;
  };

  return { list, get };
}
