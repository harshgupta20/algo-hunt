import type { AppContext } from '../context';
import type { Handler } from '../http';
import { parse, preferencesSchema } from '../schemas';

export function preferencesController(ctx: AppContext) {
  const get: Handler = () => ctx.store.preferences.get();
  const save: Handler = (req) => ctx.store.preferences.save(parse(preferencesSchema, req.body));
  return { get, save };
}
