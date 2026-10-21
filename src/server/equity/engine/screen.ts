/**
 * Screener: where each stock stands at its LAST completed check — entry conditions true, a fresh signal
 * (true now, not at the check before), exit conditions (for stocks already held), and every condition's values.
 */
import type { EqScreenRow, EqStrategyDefinition } from '@/shared/equity';
import { leavesOf } from '@/shared/equity';
import { prepareStock, type StockCandles } from './backtest';
import { TRUE, UNKNOWN } from './evaluate';

const round2 = (n: number) => Math.round(n * 100) / 100;
const tri = (v: number | undefined) => (v === undefined || v === UNKNOWN ? null : v === TRUE);

export function screenStock(def: EqStrategyDefinition, c: StockCandles, endDate: string): EqScreenRow {
  const blank: EqScreenRow = { symbol: c.symbol, name: c.name, asOf: null, close: null, changePct: null, entry: null, fresh: false, exit: null, leaves: [] };
  if (c.error || !c.daily || !c.daily.length) return { ...blank, error: c.error ?? 'No candles from Kite' };
  const { stock, evaluator } = prepareStock(def, c.symbol, c.name, c.daily, endDate, c.index);
  const t = stock.timeline;
  const k = t.daily.length - 1;
  if (k < 0) return { ...blank, error: def.timeframe === '1w' ? 'No completed week yet' : 'No candles' };
  const i = t.daily[k]!;
  const close = c.daily.close[i]!;
  const prev = k > 0 ? c.daily.close[t.daily[k - 1]!]! : null;
  const entry = tri(stock.entry[k]);
  return {
    symbol: c.symbol,
    name: c.name,
    asOf: c.daily.date[i]!,
    close: round2(close),
    changePct: prev ? round2((close / prev - 1) * 100) : null,
    entry,
    fresh: entry === true && (k === 0 || stock.entry[k - 1] !== TRUE),
    exit: stock.exit ? tri(stock.exit[k]) : null,
    leaves: evaluator.leaves(def.entry.when, k).concat(def.exit.when && leavesOf(def.exit.when).length ? evaluator.leaves(def.exit.when, k).map((l) => ({ ...l, text: `Exit: ${l.text}` })) : []),
  };
}
