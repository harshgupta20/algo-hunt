import type { AppContext } from '../context';
import { HttpError, type Handler } from '../http';
import { analyzerChartSchema, analyzerParamsSchema, parse } from '../schemas';
import { KiteNotConnectedError } from '../../services/kite/kiteClient';

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
  const run: Handler = (req) => {
    const params = parse(analyzerParamsSchema, req.body);
    return guarded(() => ctx.analyzer.runGroup(params));
  };

  /** Lazy-loaded windowed chart data around a selected alert bucket. */
  const chart: Handler = (req) => {
    const { params, center, span } = parse(analyzerChartSchema, req.body);
    return guarded(() => ctx.analyzer.chartWindow(params, center, span));
  };

  return { run, chart };
}
