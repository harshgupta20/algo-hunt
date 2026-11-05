/**
 * One F&O backtest result from the parts run on different data (the re-picking backtest's NSE / BSE products, the
 * Kite-only backtest's MCX ones). Products never share a position (one open trade per product — simulate.ts), so
 * each part's trades are exactly what one combined run would make; only the totals are recomputed over all of them.
 */
import type { BacktestResult } from '@/shared/v2';
import { breakdowns, paperStats } from './summary';

export function mergeBacktests(parts: BacktestResult[], end: number): BacktestResult {
  if (!parts.length) throw new Error('Nothing to merge');
  if (parts.length === 1) return parts[0]!;
  const [first] = parts as [BacktestResult, ...BacktestResult[]];
  const trades = parts.flatMap((p) => p.trades).sort((a, b) => b.entryAt.localeCompare(a.entryAt));
  const from = parts.map((p) => p.from).sort()[0]!;
  const to = parts.map((p) => p.to).sort().at(-1)!;
  const sources = new Set(parts.map((p) => p.source ?? 'KITE'));
  const checks = parts.flatMap((p) => p.checks ?? []);
  return {
    strategyId: first.strategyId,
    strategyName: first.strategyName,
    from,
    to,
    triggerTimeframe: first.triggerTimeframe,
    summary: { from, overall: paperStats(trades, end), strategies: [], connections: [], ...breakdowns(trades) },
    products: parts.flatMap((p) => p.products).sort((a, b) => b.stats.netPnl - a.stats.netPnl),
    trades,
    skipped: parts.flatMap((p) => p.skipped).sort((a, b) => a.at.localeCompare(b.at)),
    requests: parts.reduce((n, p) => n + p.requests, 0),
    source: sources.size === 1 ? [...sources][0]! : 'MIXED',
    ...(checks.length ? { checks } : {}),
    notes: [...new Set(parts.flatMap((p) => p.notes))],
  };
}
