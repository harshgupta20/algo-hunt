import type { AppContext } from '../context';
import { HttpError, type Handler } from '../http';
import { analyzerChartSchema, analyzerParamsSchema, parse } from '../schemas';
import { KiteNotConnectedError } from '../../services/kite/kiteClient';
import { resolveAnalyzerParams } from '../../services/strategy/runContext';

export function analyzerController(ctx: AppContext) {
  /** Historical data comes from Kite, so fail fast (409) with a clear message when it's not connected. */
  const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!(await ctx.kiteAuth.isConnected())) throw new KiteNotConnectedError();
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError || err instanceof KiteNotConnectedError) throw err;
      // Resolution problems (no expiry / contract for the selection) are user-correctable.
      if (err instanceof Error && /^(No |Could not resolve|Unknown underlying|Custom date range|Strategy not found)/.test(err.message)) {
        throw new HttpError(400, err.message);
      }
      throw err;
    }
  };

  /** Run the strategy over historical Kite data and return alerts + statistics. */
  const run: Handler = async (req) => {
    // The strategy's fixed market fields win; a basket strategy runs on all of its underlyings.
    const params = await resolveAnalyzerParams(ctx.store, parse(analyzerParamsSchema, req.body));
    return guarded(() => ctx.analyzer.runGroup(params));
  };

  /** Lazy-loaded windowed chart data around a selected alert bucket. */
  const chart: Handler = async (req) => {
    const body = parse(analyzerChartSchema, req.body);
    const params = await resolveAnalyzerParams(ctx.store, body.params, { forChart: true });
    return guarded(() => ctx.analyzer.chartWindow(params, body.center, body.span));
  };

  return { run, chart };
}
