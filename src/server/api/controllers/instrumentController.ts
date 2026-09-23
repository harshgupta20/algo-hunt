import { TIMEFRAMES, UNDERLYINGS } from '@ash/shared';
import type { AppContext } from '../context';
import { HttpError, type Handler } from '../http';

const STRIKE_SELECTIONS = ['ATM', 'ATM+1', 'ATM-1', 'ATM+2', 'ATM-2', 'CUSTOM'];

export function instrumentController(ctx: AppContext) {
  const underlyings: Handler = async () => {
    await ctx.instrumentStore.load();
    const available = new Set(ctx.instrumentStore.underlyings());
    return UNDERLYINGS.filter((u) => available.has(u.symbol));
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

  /** Static option lists for the configuration form. */
  const meta: Handler = () => ({
    timeframes: TIMEFRAMES,
    strikeSelections: STRIKE_SELECTIONS,
    expiryTypes: [
      { type: 'current-weekly', label: 'Current Weekly' },
      { type: 'next-weekly', label: 'Next Weekly' },
      { type: 'monthly', label: 'Monthly' },
    ],
  });

  return { underlyings, expiries, strikes, meta };
}
