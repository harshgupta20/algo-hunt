import type { Segment } from '@ash/shared';
import { EXPIRY_TYPES, TIMEFRAMES, underlyingsOf } from '@ash/shared';
import type { AppContext } from '../context';
import { HttpError, type Handler } from '../http';

const STRIKE_SELECTIONS = ['ATM', 'ATM+1', 'ATM-1', 'ATM+2', 'ATM-2', 'CUSTOM'];

/** `?segment=MCX` selects the MCX market; anything else is NSE/BSE (the default). */
function segmentParam(q: URLSearchParams): Segment {
  return q.get('segment') === 'MCX' ? 'MCX' : 'NSE';
}

export function instrumentController(ctx: AppContext) {
  const underlyings: Handler = async (req) => {
    await ctx.instrumentStore.load();
    const available = new Set(ctx.instrumentStore.underlyings());
    return underlyingsOf(segmentParam(req.query)).filter((u) => available.has(u.symbol));
  };

  const expiries: Handler = async (req) => {
    await ctx.instrumentStore.load();
    const options = ctx.instrumentStore.expiryOptions(req.params.underlying!);
    if (options.length === 0) throw new HttpError(404, 'No expiries for underlying');
    return options;
  };

  const strikes: Handler = async (req) => {
    const expiry = req.query.get('expiry') ?? '';
    if (!expiry) throw new HttpError(400, 'expiry query param is required');
    await ctx.instrumentStore.load();
    return ctx.instrumentStore.strikes(req.params.underlying!, expiry);
  };

  /** Static option lists for the configuration form (expiry choices differ per market). */
  const meta: Handler = (req) => ({
    timeframes: TIMEFRAMES,
    strikeSelections: STRIKE_SELECTIONS,
    expiryTypes: EXPIRY_TYPES[segmentParam(req.query)],
  });

  return { underlyings, expiries, strikes, meta };
}
