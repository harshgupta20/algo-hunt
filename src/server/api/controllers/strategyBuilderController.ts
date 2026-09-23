import type { StrategyDefInput } from '@ash/shared';
import type { AppContext } from '../context';
import { HttpError, created, type Handler } from '../http';
import { parse, strategyDefInputSchema } from '../schemas';
import { builderCatalog } from '../../services/strategy/builderCatalog';
import { rsiSyncStrategyDef } from '../../services/strategy/builtinStrategies';
import { computeStrategyStats } from '../../db/store';

export function strategyBuilderController(ctx: AppContext) {
  const catalog: Handler = () => builderCatalog();

  /** Starter template: the RSI Multi Confirmation strategy as builder JSON. */
  const template: Handler = () => rsiSyncStrategyDef();

  const list: Handler = () => ctx.store.strategies.list();

  const get: Handler = async (req) => {
    const s = await ctx.store.strategies.get(req.params.id!);
    if (!s) throw new HttpError(404, 'Strategy not found');
    return s;
  };

  const create: Handler = async (req) => {
    const input = parse(strategyDefInputSchema, req.body) as StrategyDefInput;
    return created(await ctx.store.strategies.create(input));
  };

  const update: Handler = async (req) => {
    const patch = parse(strategyDefInputSchema.partial(), req.body) as Partial<StrategyDefInput>;
    const s = await ctx.store.strategies.update(req.params.id!, patch);
    if (!s) throw new HttpError(404, 'Strategy not found');
    return s;
  };

  const remove: Handler = async (req) => {
    const ok = await ctx.store.strategies.delete(req.params.id!);
    if (!ok) throw new HttpError(404, 'Strategy not found');
  };

  const duplicate: Handler = async (req) => {
    const s = await ctx.store.strategies.duplicate(req.params.id!);
    if (!s) throw new HttpError(404, 'Strategy not found');
    return created(s);
  };

  const publish: Handler = async (req) => {
    const s = await ctx.store.strategies.setStatus(req.params.id!, 'active');
    if (!s) throw new HttpError(404, 'Strategy not found');
    return s;
  };

  const disable: Handler = async (req) => {
    const s = await ctx.store.strategies.setStatus(req.params.id!, 'disabled');
    if (!s) throw new HttpError(404, 'Strategy not found');
    return s;
  };

  const versions: Handler = (req) => ctx.store.strategies.versions(req.params.id!);

  const stats: Handler = async (req) => {
    const id = req.params.id!;
    const alerts = await ctx.store.alerts.list({ strategyId: id, limit: 5000 });
    return computeStrategyStats(alerts, id);
  };

  return { catalog, template, list, get, create, update, remove, duplicate, publish, disable, versions, stats };
}
