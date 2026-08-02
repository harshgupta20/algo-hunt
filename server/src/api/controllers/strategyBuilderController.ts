import type { RequestHandler } from 'express';
import type { StrategyDefInput } from '@ash/shared';
import type { AppContext } from '../context.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { parse, strategyDefInputSchema } from '../schemas.js';
import { builderCatalog } from '../../services/strategy/builderCatalog.js';
import { rsiSyncStrategyDef } from '../../services/strategy/builtinStrategies.js';
import { computeStrategyStats } from '../../db/store.js';

export function strategyBuilderController(ctx: AppContext) {
  const catalog: RequestHandler = (_req, res) => res.json(builderCatalog());

  /** Starter template: the RSI Multi Confirmation strategy as builder JSON. */
  const template: RequestHandler = (_req, res) => res.json(rsiSyncStrategyDef());

  const list: RequestHandler = async (_req, res) => res.json(await ctx.store.strategies.list());

  const get: RequestHandler = async (req, res) => {
    const s = await ctx.store.strategies.get(req.params.id!);
    if (!s) throw new HttpError(404, 'Strategy not found');
    res.json(s);
  };

  const create: RequestHandler = async (req, res) => {
    const input = parse(strategyDefInputSchema, req.body) as StrategyDefInput;
    res.status(201).json(await ctx.store.strategies.create(input));
  };

  const update: RequestHandler = async (req, res) => {
    const patch = parse(strategyDefInputSchema.partial(), req.body) as Partial<StrategyDefInput>;
    const s = await ctx.store.strategies.update(req.params.id!, patch);
    if (!s) throw new HttpError(404, 'Strategy not found');
    res.json(s);
  };

  const remove: RequestHandler = async (req, res) => {
    const ok = await ctx.store.strategies.delete(req.params.id!);
    if (!ok) throw new HttpError(404, 'Strategy not found');
    res.status(204).end();
  };

  const duplicate: RequestHandler = async (req, res) => {
    const s = await ctx.store.strategies.duplicate(req.params.id!);
    if (!s) throw new HttpError(404, 'Strategy not found');
    res.status(201).json(s);
  };

  const publish: RequestHandler = async (req, res) => {
    const s = await ctx.store.strategies.setStatus(req.params.id!, 'active');
    if (!s) throw new HttpError(404, 'Strategy not found');
    res.json(s);
  };

  const disable: RequestHandler = async (req, res) => {
    const s = await ctx.store.strategies.setStatus(req.params.id!, 'disabled');
    if (!s) throw new HttpError(404, 'Strategy not found');
    res.json(s);
  };

  const versions: RequestHandler = async (req, res) => res.json(await ctx.store.strategies.versions(req.params.id!));

  const stats: RequestHandler = async (req, res) => {
    const id = req.params.id!;
    const alerts = await ctx.store.alerts.list({ strategyId: id, limit: 5000 });
    res.json(computeStrategyStats(alerts, id));
  };

  return { catalog, template, list, get, create, update, remove, duplicate, publish, disable, versions, stats };
}
