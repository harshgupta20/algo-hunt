import type { RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import { parse, preferencesSchema } from '../schemas.js';

export function preferencesController(ctx: AppContext) {
  const get: RequestHandler = async (_req, res) => {
    res.json(await ctx.store.preferences.get());
  };

  const save: RequestHandler = async (req, res) => {
    const prefs = parse(preferencesSchema, req.body);
    res.json(await ctx.store.preferences.save(prefs));
  };

  return { get, save };
}
