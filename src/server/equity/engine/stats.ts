/**
 * Backtest figures from the trades and the daily account values: win rate, profit factor, drawdown, CAGR,
 * month / year returns and the NIFTY 50 comparison (bought with the same money on the first day).
 */
import type { EqCurvePoint, EqStats, EqTrade } from '@/shared/equity';

const round2 = (n: number) => Math.round(n * 100) / 100;
const YEAR_DAYS = 365.25;
const DAY = 86_400_000;

export function tradeStats(trades: EqTrade[], exposedDays: number, days: number): EqStats {
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.netPnl, 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const net = trades.map((t) => t.netPnl);
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round2((wins.length / trades.length) * 100) : 0,
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    avgWinPct: wins.length ? round2(mean(wins.map((t) => t.returnPct))!) : null,
    avgLossPct: losses.length ? round2(mean(losses.map((t) => t.returnPct))!) : null,
    expectancy: round2(mean(net) ?? 0),
    avgHoldingDays: round2(mean(trades.map((t) => t.holdingDays)) ?? 0),
    bestTrade: round2(net.length ? Math.max(...net) : 0),
    worstTrade: round2(net.length ? Math.min(...net) : 0),
    charges: round2(trades.reduce((a, t) => a + t.charges, 0)),
    adds: trades.reduce((a, t) => a + t.adds, 0),
    exposurePct: days ? round2((exposedDays / days) * 100) : 0,
  };
}

/** Peak-to-trough fall of a value series: the deepest in ₹ and in % (of the peak). */
export function drawdowns(values: number[], start: number): { pct: number[]; maxPct: number; maxAmount: number } {
  let peak = start;
  let maxPct = 0;
  let maxAmount = 0;
  const pct = values.map((v) => {
    peak = Math.max(peak, v);
    const dd = v - peak;
    maxAmount = Math.min(maxAmount, dd);
    const p = peak > 0 ? (dd / peak) * 100 : 0;
    maxPct = Math.min(maxPct, p);
    return round2(p);
  });
  return { pct, maxPct: round2(maxPct), maxAmount: round2(maxAmount) };
}

/** Compound annual growth from `start` to `end` over the dates (null under a month, or a wiped-out account). */
export function cagr(start: number, end: number, from: string, to: string): number | null {
  const years = (Date.parse(to) - Date.parse(from)) / DAY / YEAR_DAYS;
  if (years < 30 / YEAR_DAYS || start <= 0 || end <= 0) return null;
  return round2((Math.pow(end / start, 1 / years) - 1) * 100);
}

/** Return of each calendar month / year from the account value at its last trading day. */
export function periodReturns(curve: Array<{ date: string; equity: number }>, start: number, len: 7 | 4): Array<{ key: string; returnPct: number }> {
  const out: Array<{ key: string; returnPct: number }> = [];
  let prev = start;
  for (let i = 0; i < curve.length; i++) {
    const key = curve[i]!.date.slice(0, len);
    const last = i === curve.length - 1 || curve[i + 1]!.date.slice(0, len) !== key;
    if (!last) continue;
    const v = curve[i]!.equity;
    out.push({ key, returnPct: prev > 0 ? round2((v / prev - 1) * 100) : 0 });
    prev = v;
  }
  return out;
}

/** At most `max` points, always keeping the first, the last and the deepest drawdown. */
export function thin(points: EqCurvePoint[], max: number): EqCurvePoint[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const keep = new Set<number>([0, points.length - 1]);
  for (let i = 0; i < max; i++) keep.add(Math.floor(i * step));
  let worst = 0;
  points.forEach((p, i) => {
    if (p.drawdownPct < points[worst]!.drawdownPct) worst = i;
  });
  keep.add(worst);
  return [...keep].sort((a, b) => a - b).map((i) => points[i]!);
}
