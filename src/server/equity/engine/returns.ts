/**
 * Returns: how much a stock / index moved over 1D · 1W · 1M · 3M · 6M · 1Y · 2Y · 3Y, from its daily closes
 * (shared/equity/returns.ts has the rules). Price moves, not total returns: Kite's daily candles are adjusted for
 * splits, bonuses and large dividends (docs/equity.md §4), but most dividends aren't added back.
 */
import type { EqMove, EqReturnPeriod, EqReturnsRow } from '@/shared/equity';
import { EQ_RETURN_PERIODS, lastOnOrBefore, periodStart } from '@/shared/equity';
import type { StockCandles } from './backtest';

const round2 = (n: number) => Math.round(n * 100) / 100;
const NONE: EqMove = { pct: null, from: null, base: null };

const noMoves = () => Object.fromEntries(EQ_RETURN_PERIODS.map((p) => [p.key, NONE])) as Record<EqReturnPeriod, EqMove>;

export function stockReturns(c: StockCandles): EqReturnsRow {
  const blank: EqReturnsRow = { symbol: c.symbol, name: c.name, asOf: null, close: null, firstDate: null, moves: noMoves(), ...(c.index ? { index: true } : {}) };
  const b = c.daily;
  if (c.error || !b || !b.length) return { ...blank, error: c.error ?? 'No candles from Kite' };
  const last = b.length - 1;
  const asOf = b.date[last]!;
  const close = b.close[last]!;
  const moves = noMoves();
  for (const p of EQ_RETURN_PERIODS) {
    const start = periodStart(asOf, p);
    const i = start === null ? last - 1 : lastOnOrBefore(b.date, start);
    if (i < 0) continue;
    const base = b.close[i]!;
    if (!(base > 0)) continue;
    moves[p.key] = { pct: round2((close / base - 1) * 100), from: b.date[i]!, base: round2(base) };
  }
  return { ...blank, asOf, close: round2(close), firstDate: b.date[0]!, moves };
}
