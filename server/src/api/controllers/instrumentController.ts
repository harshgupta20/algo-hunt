import type { RequestHandler } from 'express';
import { TIMEFRAMES, UNDERLYINGS } from '@ash/shared';
import type { AppContext } from '../context.js';
import { HttpError } from '../../middleware/errorHandler.js';

const STRIKE_SELECTIONS = ['ATM', 'ATM+1', 'ATM-1', 'ATM+2', 'ATM-2', 'CUSTOM'];

export function instrumentController(ctx: AppContext) {
  const underlyings: RequestHandler = (_req, res) => {
    const available = new Set(ctx.instrumentStore.underlyings());
    res.json(UNDERLYINGS.filter((u) => available.has(u.symbol)));
  };

  const expiries: RequestHandler = (req, res) => {
    const options = ctx.instrumentStore.expiryOptions(req.params.underlying!);
    if (options.length === 0) throw new HttpError(404, 'No expiries for underlying');
    res.json(options);
  };

  const strikes: RequestHandler = (req, res) => {
    const expiry = String(req.query.expiry ?? '');
    if (!expiry) throw new HttpError(400, 'expiry query param is required');
    res.json(ctx.instrumentStore.strikes(req.params.underlying!, expiry));
  };

  /** Static option lists for the configuration form. */
  const meta: RequestHandler = (_req, res) => {
    res.json({
      timeframes: TIMEFRAMES,
      strikeSelections: STRIKE_SELECTIONS,
      expiryTypes: [
        { type: 'current-weekly', label: 'Current Weekly' },
        { type: 'next-weekly', label: 'Next Weekly' },
        { type: 'monthly', label: 'Monthly' },
      ],
    });
  };

  return { underlyings, expiries, strikes, meta };
}
