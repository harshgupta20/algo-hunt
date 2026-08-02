import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { configGroupInputSchema, configInputSchema, configUpdateSchema, parse } from '../schemas.js';

export function configController(ctx: AppContext) {
  const list: RequestHandler = async (_req, res) => {
    res.json(await ctx.store.configs.list());
  };

  const get: RequestHandler = async (req, res) => {
    const cfg = await ctx.store.configs.getById(req.params.id!);
    if (!cfg) throw new HttpError(404, 'Configuration not found');
    res.json(cfg);
  };

  const create: RequestHandler = async (req, res) => {
    const input = parse(configInputSchema, req.body);
    const cfg = await ctx.store.configs.create(input);
    res.status(201).json(cfg);
  };

  const update: RequestHandler = async (req, res) => {
    const patch = parse(configUpdateSchema, req.body);
    const cfg = await ctx.store.configs.update(req.params.id!, patch);
    if (!cfg) throw new HttpError(404, 'Configuration not found');
    res.json(cfg);
  };

  const remove: RequestHandler = async (req, res) => {
    const id = req.params.id!;
    if (ctx.worker.isActive(id)) await ctx.worker.deactivate(id);
    const ok = await ctx.store.configs.delete(id);
    if (!ok) throw new HttpError(404, 'Configuration not found');
    res.status(204).end();
  };

  const activate: RequestHandler = async (req, res) => {
    const cfg = await ctx.store.configs.getById(req.params.id!);
    if (!cfg) throw new HttpError(404, 'Configuration not found');
    const activated = await ctx.worker.activate(cfg);
    res.json(activated);
  };

  const deactivate: RequestHandler = async (req, res) => {
    const id = req.params.id!;
    const cfg = await ctx.store.configs.getById(id);
    if (!cfg) throw new HttpError(404, 'Configuration not found');
    await ctx.worker.deactivate(id);
    const updated = await ctx.store.configs.getById(id);
    res.json(updated);
  };

  const snapshots: RequestHandler = (_req, res) => {
    res.json(ctx.worker.snapshots());
  };

  // ---- Group monitors: one config per member, sharing a groupId ----

  const configsInGroup = async (groupId: string) => (await ctx.store.configs.list()).filter((c) => c.groupId === groupId);

  const createGroup: RequestHandler = async (req, res) => {
    const input = parse(configGroupInputSchema, req.body);
    const groupId = randomUUID();
    const configs = [];
    for (const underlying of input.members) {
      configs.push(
        await ctx.store.configs.create({
          underlying,
          expiryType: input.expiryType,
          strikeSelection: input.strikeSelection,
          customStrike: input.customStrike,
          timeframe: input.timeframe,
          strategy: input.strategy,
          params: input.params,
          groupId,
          groupName: input.groupName,
        }),
      );
    }
    res.status(201).json({ groupId, groupName: input.groupName, configs });
  };

  const activateGroup: RequestHandler = async (req, res) => {
    const configs = await configsInGroup(req.params.groupId!);
    let activated = 0;
    const errors: string[] = [];
    for (const c of configs) {
      try {
        await ctx.worker.activate(c);
        activated++;
      } catch (err) {
        errors.push(`${c.underlying}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    res.json({ activated, total: configs.length, errors });
  };

  const deactivateGroup: RequestHandler = async (req, res) => {
    const configs = await configsInGroup(req.params.groupId!);
    for (const c of configs) await ctx.worker.deactivate(c.id);
    res.json({ deactivated: configs.length });
  };

  const removeGroup: RequestHandler = async (req, res) => {
    const configs = await configsInGroup(req.params.groupId!);
    for (const c of configs) {
      if (ctx.worker.isActive(c.id)) await ctx.worker.deactivate(c.id);
      await ctx.store.configs.delete(c.id);
    }
    res.status(204).end();
  };

  return { list, get, create, update, remove, activate, deactivate, snapshots, createGroup, activateGroup, deactivateGroup, removeGroup };
}
