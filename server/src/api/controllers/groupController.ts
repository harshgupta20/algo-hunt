import type { RequestHandler } from 'express';
import type { UnderlyingGroupInput } from '@ash/shared';
import type { AppContext } from '../context.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { groupInputSchema, parse } from '../schemas.js';

export function groupController(ctx: AppContext) {
  const list: RequestHandler = async (_req, res) => res.json(await ctx.store.groups.list());

  const get: RequestHandler = async (req, res) => {
    const g = await ctx.store.groups.get(req.params.id!);
    if (!g) throw new HttpError(404, 'Group not found');
    res.json(g);
  };

  const create: RequestHandler = async (req, res) => {
    const input = parse(groupInputSchema, req.body) as UnderlyingGroupInput;
    res.status(201).json(await ctx.store.groups.create(input));
  };

  const update: RequestHandler = async (req, res) => {
    const patch = parse(groupInputSchema.partial(), req.body) as Partial<UnderlyingGroupInput>;
    const g = await ctx.store.groups.update(req.params.id!, patch);
    if (!g) throw new HttpError(404, 'Group not found or not editable');
    res.json(g);
  };

  const remove: RequestHandler = async (req, res) => {
    const ok = await ctx.store.groups.delete(req.params.id!);
    if (!ok) throw new HttpError(404, 'Group not found');
    res.status(204).end();
  };

  return { list, get, create, update, remove };
}
