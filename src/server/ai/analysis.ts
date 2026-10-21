/**
 * What the AI is told about a backtest — computed here, never by the model: the figures, each year against NIFTY 50,
 * the two halves of the period, where the P&L came from (concentration), exits, the worst drawdown, signals not
 * taken and the data notes. Compact (a few hundred tokens) because Groq's free plan allows 8,000 tokens a minute.
 * And the strategy variants a robustness check runs (every period ±20 %).
 */
import type { EqBacktestResult, EqCurvePoint, EqNode, EqOperand, EqStrategyDefinition } from '@/shared/equity';

const r1 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const r2 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Compound yearly growth between two values over [from, to]. */
function cagr(start: number, end: number, from: string, to: string): number | null {
  const years = days(from, to) / 365.25;
  if (!(start > 0) || !(end > 0) || years < 0.25) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

/** Each calendar year's return of the account and of NIFTY 50 (from the curve's year-end points). */
function years(curve: EqCurvePoint[]): Array<[string, number | null, number | null]> {
  const out: Array<[string, number | null, number | null]> = [];
  let prev: EqCurvePoint | null = null;
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i]!;
    const last = i === curve.length - 1 || curve[i + 1]!.date.slice(0, 4) !== p.date.slice(0, 4);
    if (!last) continue;
    const base: EqCurvePoint = prev ?? curve[0]!;
    const ret = base.equity > 0 ? (p.equity / base.equity - 1) * 100 : null;
    const bench = base.benchmark && p.benchmark ? (p.benchmark / base.benchmark - 1) * 100 : null;
    out.push([p.date.slice(0, 4) + (prev ? '' : ' (from ' + base.date.slice(5) + ')') + (i === curve.length - 1 && p.date.slice(5) !== '12-31' ? ` (to ${p.date.slice(5)})` : ''), r1(ret), r1(bench)]);
    prev = p;
  }
  return out;
}

/** The worst fall from a peak, when it happened and how long the account stayed below that peak. */
function worstDrawdown(curve: EqCurvePoint[]) {
  let peak = curve[0];
  let worst: { pct: number; peak: string; trough: string; recovered: string | null } | null = null;
  let underwater: { from: string; days: number } = { from: curve[0]?.date ?? '', days: 0 };
  let longest = 0;
  for (const p of curve) {
    if (!peak || p.equity >= peak.equity) {
      if (peak && p.equity >= peak.equity && worst && worst.recovered === null && worst.peak === peak.date) worst.recovered = p.date;
      longest = Math.max(longest, days(underwater.from, p.date));
      peak = p;
      underwater = { from: p.date, days: 0 };
      continue;
    }
    const dd = (p.equity / peak.equity - 1) * 100;
    if (!worst || dd < worst.pct) worst = { pct: dd, peak: peak.date, trough: p.date, recovered: null };
  }
  if (curve.length) longest = Math.max(longest, days(underwater.from, curve.at(-1)!.date));
  return worst ? { maxPct: r1(worst.pct), peak: worst.peak, trough: worst.trough, recovered: worst.recovered ?? 'not yet', longestUnderwaterDays: longest } : null;
}

const SKIP_KIND: Array<[RegExp, string]> = [
  [/Not enough cash/, 'not enough cash'],
  [/Already holding/, 'max stocks held'],
  [/lapsed/, 'order lapsed (no trade next day)'],
  [/circuit/, 'circuit lock'],
  [/zero volume/, 'no trades that day'],
  [/buys 0 shares/, 'money per buy below one share'],
  [/no add/, 'opened below the new stop'],
];

/** Statistical weight of the edge: t = mean ÷ (sd ÷ √n) of each trade's % return. */
function tradeT(r: EqBacktestResult) {
  const rets = r.trades.map((t) => t.returnPct);
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0;
  return { mean, tStat: sd > 0 ? mean / (sd / Math.sqrt(rets.length)) : null };
}

/** The 3 best trades' share of the net P&L (null when there's no net profit). */
function top3Share(r: EqBacktestResult) {
  const top3 = [...r.trades].sort((a, b) => b.netPnl - a.netPnl).slice(0, 3).reduce((a, t) => a + t.netPnl, 0);
  return { top3, pct: r.netPnl > 0 ? r1((top3 / r.netPnl) * 100) : null };
}

/** The compact analysis of one backtest. */
export function summarize(r: EqBacktestResult) {
  const s = r.stats;
  const first = r.curve[0];
  const last = r.curve.at(-1);
  const trades = r.trades;
  const { mean, tStat } = tradeT(r);
  // Where the money came from.
  const bySymbol = [...r.perSymbol].filter((p) => p.trades > 0).sort((a, b) => b.netPnl - a.netPnl);
  const net = r.netPnl;
  const share = (x: number) => (net > 0 ? r1((x / net) * 100) : null);
  const { top3 } = top3Share(r);
  const exits: Record<string, { n: number; pnl: number }> = {};
  for (const t of trades) {
    const e = (exits[t.exitReason] ??= { n: 0, pnl: 0 });
    e.n++;
    e.pnl += t.netPnl;
  }
  const skipped: Record<string, number> = {};
  for (const k of r.skipped) {
    const kind = SKIP_KIND.find(([re]) => re.test(k.reason))?.[1] ?? 'signal at the last check';
    skipped[kind] = (skipped[kind] ?? 0) + 1;
  }
  // The two halves of the period: is the edge steady or one good stretch?
  let halves = null;
  if (first && last && r.capital !== null && r.curve.length > 4) {
    const mid = r.curve[Math.floor(r.curve.length / 2)]!;
    const half = (a: EqCurvePoint, b: EqCurvePoint) => ({ from: a.date, to: b.date, cagr: r1(cagr(a.equity, b.equity, a.date, b.date)), nifty: a.benchmark && b.benchmark ? r1(cagr(a.benchmark, b.benchmark, a.date, b.date)) : null });
    halves = [half(first, mid), half(mid, last)];
  }
  const dataNotes = [...new Set(r.perSymbol.flatMap((p) => [...p.notes, ...p.errors].map((n) => n.replace(/\d{4}-\d{2}-\d{2}/g, 'DATE').slice(0, 90))))];
  return {
    historyId: r.historyId ?? null,
    strategy: r.strategyName,
    period: `${r.from} → ${r.to}`,
    instruments: r.symbols,
    capital: r.capital,
    result: { finalEquity: r2(r.finalEquity), netPnl: r2(r.netPnl), returnPct: r1(r.returnPct), cagrPct: r1(r.cagrPct), maxDrawdownPct: r1(r.maxDrawdownPct) },
    nifty50: r.benchmark ? { returnPct: r1(r.benchmark.returnPct), cagrPct: r1(r.benchmark.cagrPct), maxDrawdownPct: r1(r.benchmark.maxDrawdownPct) } : null,
    trades: {
      count: s.trades,
      winRatePct: r1(s.winRate),
      profitFactor: r2(s.profitFactor),
      avgWinPct: r1(s.avgWinPct),
      avgLossPct: r1(s.avgLossPct),
      avgTradePct: r2(mean),
      tStat: r2(tStat),
      avgHoldingDays: r1(s.avgHoldingDays),
      exposurePct: r1(s.exposurePct),
      pyramidAdds: s.adds,
      openAtEnd: r.openAtEnd,
    },
    byYear: { columns: ['year', 'strategy %', 'NIFTY 50 %'], rows: years(r.curve) },
    halves,
    drawdown: worstDrawdown(r.curve),
    concentration: {
      instrumentsTraded: bySymbol.length,
      instrumentsProfitable: bySymbol.filter((p) => p.netPnl > 0).length,
      top: bySymbol.slice(0, 5).map((p) => ({ symbol: p.symbol, pnl: r2(p.netPnl), pctOfNet: share(p.netPnl) })),
      bottom: bySymbol.slice(-3).reverse().filter((p) => p.netPnl < 0).map((p) => ({ symbol: p.symbol, pnl: r2(p.netPnl) })),
      top3TradesPctOfNet: share(top3),
      netWithoutTop3Trades: r2(net - top3),
    },
    exits: Object.fromEntries(Object.entries(exits).map(([k, v]) => [k, { trades: v.n, pnl: r2(v.pnl) }])),
    signalsNotTaken: skipped,
    dataNotes: dataNotes.slice(0, 6),
  };
}

/** The headline figures only (for comparisons). */
export function headline(r: EqBacktestResult) {
  return {
    returnPct: r1(r.returnPct),
    cagrPct: r1(r.cagrPct),
    maxDrawdownPct: r1(r.maxDrawdownPct),
    trades: r.stats.trades,
    winRatePct: r1(r.stats.winRate),
    profitFactor: r2(r.stats.profitFactor),
    tStat: r2(tradeT(r).tStat),
    top3TradesPctOfNet: top3Share(r).pct,
    netPnl: r2(r.netPnl),
    nifty50CagrPct: r1(r.benchmark?.cagrPct),
  };
}

// ---- robustness variants --------------------------------------------------------------------------------

const PERIOD_PARAMS = new Set(['period', 'fast', 'slow', 'signal', 'smoothing']);
const scale = (n: number, f: number) => Math.max(2, Math.round(n * f));

function scaleOperand(o: EqOperand, f: number): EqOperand {
  if (o.kind !== 'INDICATOR') return o;
  const params = Object.fromEntries(Object.entries(o.params).map(([k, v]) => [k, PERIOD_PARAMS.has(k) ? scale(v, f) : v]));
  // MACD keeps fast < slow.
  if (params.fast !== undefined && params.slow !== undefined && params.fast >= params.slow) params.slow = params.fast + 1;
  return { ...o, params, ...(o.ma ? { ma: { ...o.ma, period: scale(o.ma.period, f) } } : {}) };
}

function scaleNode<T extends EqNode>(n: T, f: number): T {
  if (n.type === 'CONDITION') return { ...n, left: scaleOperand(n.left, f), right: scaleOperand(n.right, f) };
  return { ...n, children: n.children.map((c) => scaleNode(c, f)) };
}

/** Every indicator period (and the pyramiding MA) × f, rounded — a neighbour of the strategy, not a new idea. */
export function withPeriods(d: EqStrategyDefinition, f: number): EqStrategyDefinition {
  return {
    ...d,
    name: `${d.name} (periods ${f > 1 ? '+' : '−'}${Math.round(Math.abs(f - 1) * 100)}%)`,
    entry: { ...d.entry, when: scaleNode(d.entry.when, f) },
    exit: { ...d.exit, when: d.exit.when ? scaleNode(d.exit.when, f) : null, maxBars: d.exit.maxBars === null ? null : Math.max(1, Math.round(d.exit.maxBars * f)) },
    pyramid: { ...d.pyramid, maPeriod: scale(d.pyramid.maPeriod, f) },
  };
}

/** Target / stop / trailing % × f — are the exits a cliff edge? */
export function withExits(d: EqStrategyDefinition, f: number): EqStrategyDefinition | null {
  const x = d.exit;
  if (x.targetPct === null && x.stopLossPct === null && x.trailingStopPct === null) return null;
  const m = (v: number | null, max: number) => (v === null ? null : Math.min(max, Math.round(v * f * 100) / 100));
  return { ...d, name: `${d.name} (exit levels ${f > 1 ? '+' : '−'}${Math.round(Math.abs(f - 1) * 100)}%)`, exit: { ...x, targetPct: m(x.targetPct, 1000), stopLossPct: m(x.stopLossPct, 99), trailingStopPct: m(x.trailingStopPct, 99) } };
}
