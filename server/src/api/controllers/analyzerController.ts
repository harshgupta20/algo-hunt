import type { RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import { analyzerChartSchema, analyzerParamsSchema, parse } from '../schemas.js';

export function analyzerController(ctx: AppContext) {
  /** Run the strategy over historical data and return alerts + statistics. */
  const run: RequestHandler = async (req, res) => {
    const params = parse(analyzerParamsSchema, req.body);
    res.json(await ctx.analyzer.runGroup(params));
  };

  /** Lazy-loaded windowed chart data around a selected alert bucket. */
  const chart: RequestHandler = async (req, res) => {
    const { params, center, span } = parse(analyzerChartSchema, req.body);
    res.json(await ctx.analyzer.chartWindow(params, center, span));
  };

  return { run, chart };
}
