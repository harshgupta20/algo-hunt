import type { UnderlyingGroupInput } from '@ash/shared';
import type { AppContext } from '../context';
import { HttpError, created, type Handler } from '../http';
import { groupInputSchema, parse } from '../schemas';

export function groupController(ctx: AppContext) {
  const list: Handler = () => ctx.store.groups.list();

  const get: Handler = async (req) => {
    const g = await ctx.store.groups.get(req.params.id!);
    if (!g) throw new HttpError(404, 'Group not found');
    return g;
  };

  const create: Handler = async (req) =>
    created(await ctx.store.groups.create(parse(groupInputSchema, req.body) as UnderlyingGroupInput));

  const update: Handler = async (req) => {
    const patch = parse(groupInputSchema.partial(), req.body) as Partial<UnderlyingGroupInput>;
    const g = await ctx.store.groups.update(req.params.id!, patch);
    if (!g) throw new HttpError(404, 'Group not found or not editable');
    return g;
  };

  const remove: Handler = async (req) => {
    const ok = await ctx.store.groups.delete(req.params.id!);
    if (!ok) throw new HttpError(404, 'Group not found');
  };

  return { list, get, create, update, remove };
}
