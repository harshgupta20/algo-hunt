import type { RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { parse, simulateSchema } from '../schemas.js';

export function simulateController(ctx: AppContext) {
  /** Dev/demo: drive a scenario through the real engine to fire one alert. */
  const trigger: RequestHandler = async (req, res) => {
    const { configId, scenario } = parse(simulateSchema, req.body);
    try {
      const fired = await ctx.worker.replayScenario(configId, scenario);
      res.json({ fired });
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'Simulation failed');
    }
  };

  return { trigger };
}
