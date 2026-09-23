import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context';
import { HttpError, created, type Handler } from '../http';
import { configGroupInputSchema, configInputSchema, configUpdateSchema, parse } from '../schemas';
import { KiteNotConnectedError } from '../../services/kite/kiteClient';

export function configController(ctx: AppContext) {
  /** Activation resolves contracts + the ATM strike from live Kite data. */
  const requireKite = async () => {
    if (!(await ctx.kiteAuth.isConnected())) throw new KiteNotConnectedError();
  };

  const list: Handler = () => ctx.store.configs.list();

  const get: Handler = async (req) => {
    const cfg = await ctx.store.configs.getById(req.params.id!);
    if (!cfg) throw new HttpError(404, 'Configuration not found');
    return cfg;
  };

  const create: Handler = async (req) => created(await ctx.store.configs.create(parse(configInputSchema, req.body)));

  const update: Handler = async (req) => {
    const cfg = await ctx.store.configs.update(req.params.id!, parse(configUpdateSchema, req.body));
    if (!cfg) throw new HttpError(404, 'Configuration not found');
    // A running monitor keeps the contracts it locked at activation; re-activate to apply changes.
    if (cfg.active) {
      await requireKite();
      await ctx.monitors.activate(cfg);
    }
    return (await ctx.store.configs.getById(cfg.id)) ?? cfg;
  };

  const remove: Handler = async (req) => {
    // monitor_state rows cascade with the configuration.
    const ok = await ctx.store.configs.delete(req.params.id!);
    if (!ok) throw new HttpError(404, 'Configuration not found');
  };

  const activate: Handler = async (req) => {
    const cfg = await ctx.store.configs.getById(req.params.id!);
    if (!cfg) throw new HttpError(404, 'Configuration not found');
    await requireKite();
    try {
      return await ctx.monitors.activate(cfg);
    } catch (err) {
      if (err instanceof HttpError || err instanceof KiteNotConnectedError) throw err;
      throw new HttpError(400, err instanceof Error ? err.message : 'Activation failed');
    }
  };

  const deactivate: Handler = async (req) => {
    const id = req.params.id!;
    if (!(await ctx.store.configs.getById(id))) throw new HttpError(404, 'Configuration not found');
    await ctx.monitors.deactivate(id);
    return ctx.store.configs.getById(id);
  };

  const snapshots: Handler = () => ctx.monitors.snapshots();

  // ---- Group monitors: one config per member, sharing a groupId ----

  const configsInGroup = async (groupId: string) => (await ctx.store.configs.list()).filter((c) => c.groupId === groupId);

  const createGroup: Handler = async (req) => {
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
    return created({ groupId, groupName: input.groupName, configs });
  };

  const activateGroup: Handler = async (req) => {
    await requireKite();
    const configs = await configsInGroup(req.params.groupId!);
    let activated = 0;
    const errors: string[] = [];
    for (const c of configs) {
      try {
        await ctx.monitors.activate(c);
        activated++;
      } catch (err) {
        errors.push(`${c.underlying}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { activated, total: configs.length, errors };
  };

  const deactivateGroup: Handler = async (req) => {
    const configs = await configsInGroup(req.params.groupId!);
    for (const c of configs) await ctx.monitors.deactivate(c.id);
    return { deactivated: configs.length };
  };

  const removeGroup: Handler = async (req) => {
    const configs = await configsInGroup(req.params.groupId!);
    for (const c of configs) await ctx.store.configs.delete(c.id);
  };

  return { list, get, create, update, remove, activate, deactivate, snapshots, createGroup, activateGroup, deactivateGroup, removeGroup };
}
