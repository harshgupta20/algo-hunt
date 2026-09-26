import { DEFAULT_USER_PREFERENCES } from '@ash/shared';
import type { AppContext } from '../context';
import type { Handler } from '../http';
import { parse, preferencesSchema } from '../schemas';

export function preferencesController(ctx: AppContext) {
  const get: Handler = () => ctx.store.preferences.get();
  // Older clients may omit newer fields: fill them from the defaults.
  const save: Handler = (req) => ctx.store.preferences.save({ ...DEFAULT_USER_PREFERENCES, ...parse(preferencesSchema, req.body) });
  return { get, save };
}
