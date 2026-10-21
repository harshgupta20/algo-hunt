/**
 * Backtest from candles already fetched: prepare each stock (weekly candles, checks, conditions), simulate
 * the portfolio, then the figures, the NIFTY 50 comparison and each stock's data notes. Pure — no I/O.
 */
import type { EqBacktestRequest, EqBacktestResult, EqCurvePoint, EqOrderRules, EqStrategyDefinition, EqSymbolResult } from '@/shared/equity';
import { EQ_ORDER_RULES, EQ_TIMEFRAME, leavesOf } from '@/shared/equity';
import type { Bars } from './bars';
import { Evaluator, UNKNOWN, buildTimeline, stockSeries } from './evaluate';
import { simulate, type SimStock } from './simulate';
import { cagr, drawdowns, periodReturns, thin, tradeStats } from './stats';

export interface StockCandles {
  symbol: string;
  name: string;
  daily: Bars | null;
  error?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const MAX_CURVE_POINTS = 1500;

/** Conditions evaluated over the stock's whole history, ready for the simulation. */
export function prepareStock(def: EqStrategyDefinition, symbol: string, name: string, daily: Bars, endDate: string): { stock: SimStock; evaluator: Evaluator } {
  const series = stockSeries(daily, endDate);
  const timeline = buildTimeline(series, def.timeframe);
  const ev = new Evaluator(series, timeline);
  const exitGroup = def.exit.when && leavesOf(def.exit.when).length ? def.exit.when : null;
  const stock: SimStock = {
    symbol,
    name,
    daily,
    timeline,
    coarse: coarseMask(daily),
    entry: ev.node(def.entry.when),
    exit: exitGroup ? ev.node(exitGroup) : null,
    ma: def.pyramid.enabled ? ev.read({ kind: 'INDICATOR', indicator: def.pyramid.maType, params: { period: def.pyramid.maPeriod } }) : null,
    why: (kind, k) => ev.describe(kind === 'ENTRY' ? def.entry.when : exitGroup!, k),
  };
  return { stock, evaluator: ev };
}

/**
 * Kite back-adjusts history for splits and bonuses but rounds the result, so long before a big split prices can
 * move in coarse steps (Bajaj Finance in 2012: ₹0.50 steps on a ₹7 price). In blocks of 40 candles from the first,
 * a block is COARSE when every price is a multiple of a step of ₹0.10 or more that is at least 0.2 % of the
 * (median) close — far coarser than the exchange's real tick — and it has at least 5 different prices.
 * Per candle: the step's % of the price (0 = fine).
 */
export function coarseMask(d: Bars): Float64Array {
  const STEPS = [5, 1, 0.5, 0.25, 0.1];
  const BLOCK = 40;
  const on = (x: number, step: number) => Math.abs(x / step - Math.round(x / step)) < 1e-6;
  const mask = new Float64Array(d.length);
  for (let i = 0; i < d.length; i += BLOCK) {
    const z = Math.min(i + BLOCK, d.length);
    const values: number[] = [];
    for (let j = i; j < z; j++) values.push(d.open[j]!, d.high[j]!, d.low[j]!, d.close[j]!);
    if (new Set(values).size < 5) continue; // a flat, barely traded stretch says nothing about rounding
    const step = STEPS.find((st) => values.every((x) => on(x, st)));
    if (!step) continue;
    const closes = values.filter((_, k) => k % 4 === 3).sort((a, b) => a - b);
    const pct = (step / closes[Math.floor(closes.length / 2)]!) * 100;
    if (pct >= 0.2) mask.fill(pct, i, z);
  }
  return mask;
}

/** The coarse stretches of [from, to], in words (with the step: every price in them is a multiple of it). */
export function coarsePriceNotes(d: Bars, from: string, to: string, mask = coarseMask(d)): string[] {
  const out: Array<{ from: string; to: string; pct: number; i: number }> = [];
  for (let i = 0; i < d.length; i++) {
    if (!mask[i] || d.date[i]! < from || d.date[i]! > to) continue;
    const last = out.at(-1);
    if (last && last.i === i - 1) {
      last.to = d.date[i]!;
      last.pct = Math.max(last.pct, mask[i]!);
      last.i = i;
    } else out.push({ from: d.date[i]!, to: d.date[i]!, pct: mask[i]!, i });
  }
  return out.map((r) => `Kite's prices from ${r.from} to ${r.to} move in coarse steps (up to ${r.pct.toFixed(1)}% of the price) — history adjusted for a later split or bonus and rounded by Kite, so signals and P&L there are approximate`);
}

/** Data limits worth telling the trader: late listing, too little history to decide early in the period. */
function dataNotes(def: EqStrategyDefinition, stock: SimStock, from: string, to: string): string[] {
  const notes: string[] = [];
  const d = stock.daily;
  const firstIn = d.date.findIndex((x) => x >= from);
  if (firstIn < 0 || d.date[firstIn]! > to) return ['No candles in the period'];
  if (firstIn === 0 && d.date[0]! > from) notes.push(`Candles start on ${d.date[0]} (listed or first traded then)`);
  notes.push(...coarsePriceNotes(d, from, to, stock.coarse));
  const t = stock.timeline;
  let firstCheck = -1;
  for (let k = 0; k < t.daily.length; k++) {
    if (d.date[t.daily[k]!]! >= from) {
      firstCheck = k;
      break;
    }
  }
  if (firstCheck >= 0) {
    let decided = firstCheck;
    while (decided < t.daily.length && stock.entry[decided] === UNKNOWN) decided++;
    if (decided >= t.daily.length) notes.push(`Too little history: the entry conditions couldn’t be decided at any ${EQ_TIMEFRAME[def.timeframe].label.toLowerCase()} check in the period`);
    else if (decided > firstCheck) notes.push(`Too little history to decide the entry until ${d.date[t.daily[decided]!]}`);
  }
  return notes;
}

/** NIFTY 50 bought with `start` on the first date, valued at each date's close. */
function benchmarkCurve(bench: Bars | null, dates: string[], start: number): number[] | null {
  if (!bench || !bench.length || !dates.length) return null;
  let j = -1;
  let base: number | null = null;
  const out: number[] = [];
  for (const date of dates) {
    while (j + 1 < bench.length && bench.date[j + 1]! <= date) j++;
    if (j < 0) return null;
    const close = bench.close[j]!;
    base ??= close;
    out.push(round2((start * close) / base));
  }
  return out;
}

/** `rules` is EQ_ORDER_RULES for every real backtest; tests pass simpler ones (fills at the close, no costs). */
export function runBacktest(def: EqStrategyDefinition, req: EqBacktestRequest, candles: StockCandles[], bench: Bars | null, endDate: string, rules: EqOrderRules = EQ_ORDER_RULES): Omit<EqBacktestResult, 'requests'> {
  const errors = new Map<string, string[]>();
  const notes = new Map<string, string[]>();
  const stocks: SimStock[] = [];
  for (const c of candles) {
    if (c.error || !c.daily || !c.daily.length) {
      errors.set(c.symbol, [c.error ?? 'No candles from Kite']);
      continue;
    }
    const { stock } = prepareStock(def, c.symbol, c.name, c.daily, endDate);
    notes.set(c.symbol, dataNotes(def, stock, req.from, req.to));
    stocks.push(stock);
  }

  // The market's calendar (every stock's days and NIFTY 50's) decides when a next-open order lapses.
  const sim = simulate(def, stocks, { from: req.from, to: req.to, capital: req.capital, maxPositions: req.maxPositions, rules, ...(bench ? { marketDates: bench.date } : {}) });
  const start = req.capital ?? 0;
  const values = sim.curve.map((p) => p.equity);
  const dd = drawdowns(values, start);
  const benchValues = req.capital !== null ? benchmarkCurve(bench, sim.curve.map((p) => p.date), req.capital) : null;
  const curve: EqCurvePoint[] = sim.curve.map((p, i) => ({ date: p.date, equity: p.equity, drawdownPct: req.capital !== null ? dd.pct[i]! : 0, ...(benchValues ? { benchmark: benchValues[i]! } : {}) }));
  const final = values.at(-1) ?? start;
  const netPnl = round2(req.capital !== null ? final - req.capital : final);
  const first = sim.curve[0]?.date ?? req.from;
  const last = sim.curve.at(-1)?.date ?? req.to;

  let benchmark: EqBacktestResult['benchmark'] = null;
  if (bench && bench.length && sim.curve.length) {
    const b = benchValues ?? benchmarkCurve(bench, sim.curve.map((p) => p.date), 100_000);
    if (b) {
      const s = req.capital ?? 100_000;
      benchmark = { name: 'NIFTY 50', returnPct: round2((b.at(-1)! / s - 1) * 100), cagrPct: cagr(s, b.at(-1)!, first, last), maxDrawdownPct: drawdowns(b, s).maxPct };
    }
  }

  // Orders large against the day's traded volume: the backtest fills them at the open / stop price (+0.1 %), but a
  // real order that size would move the price more — said per stock, results unchanged.
  for (const st of stocks) {
    const at = new Map(st.daily.date.map((d, i) => [d, i]));
    let big = 0;
    let worst = 0;
    for (const t of sim.trades) {
      if (t.symbol !== st.symbol) continue;
      for (const f of t.fills) {
        const i = at.get(f.date);
        const share = i === undefined ? 0 : f.quantity / st.daily.volume[i]!;
        if (share > 0.1 && t.exitReason !== 'END') {
          big++;
          worst = Math.max(worst, share);
        }
      }
    }
    if (big) notes.get(st.symbol)?.push(`${big} order${big === 1 ? ' was' : 's were'} over 10% of that day's traded volume (up to ${worst > 9.99 ? '>999' : Math.round(worst * 100)}%) — a real order that size would likely have moved the price, so its fill here is optimistic`);
  }

  const perSymbol: EqSymbolResult[] = candles.map((c) => {
    const list = sim.trades.filter((t) => t.symbol === c.symbol);
    const net = list.map((t) => t.netPnl);
    return {
      symbol: c.symbol,
      name: c.name,
      trades: list.length,
      wins: list.filter((t) => t.netPnl > 0).length,
      netPnl: round2(net.reduce((a, b) => a + b, 0)),
      invested: round2(list.reduce((a, t) => a + t.invested, 0)),
      bestTrade: round2(net.length ? Math.max(...net) : 0),
      worstTrade: round2(net.length ? Math.min(...net) : 0),
      notes: notes.get(c.symbol) ?? [],
      errors: errors.get(c.symbol) ?? [],
    };
  });

  const assumptions = [
    `Checked at each ${def.timeframe === '1w' ? 'completed week’s last trading day, on weekly candles' : 'daily close, on daily candles'}; ${rules.fill === 'CLOSE' ? 'orders fill at the close that signalled' : 'orders fill at the next trading day’s open'}.`,
    rules.stopTrigger === 'TOUCH'
      ? 'Stops sell when a day’s low reaches them (at the open if it opened below); targets when a day’s high reaches them. Both in one day → the stop counts.'
      : 'Stops sell when a check’s close is below them; targets when a day’s high reaches them.',
    'Sells before buys each day; when money is short, same-day buys are taken in alphabetical order.',
    'Fill prices are whole paise (buys rounded up, sales down). A next-open order lapses if the stock doesn’t trade on the next market day; a candle locked at a circuit (one price all day) can’t be bought at the upper circuit or sold at the lower one; an add that would open at or below the stop it sets isn’t bought.',
    rules.charges ? 'Zerodha charges on every order: delivery (STT, exchange, SEBI, stamp, GST, ₹15.34 DP charge on sells); a lot bought and sold the same day pays intraday charges instead.' : rules.slippagePct ? 'No charges.' : 'No charges or slippage — every price is the candle’s own, like TradingView’s strategy tester.',
    ...(rules.slippagePct ? [`${rules.slippagePct}% slippage on every market order (not on targets).`] : []),
    ...(def.pyramid.enabled ? [`Pyramiding: one more lot when ${def.pyramid.maType}(${def.pyramid.maPeriod}) reaches the last buy price with the close at or above it; the stop for all lots moves to that MA value once the lot is bought.`] : []),
    'Positions still open at the end are valued at the last close (reason END).',
    ...(bench ? ['NIFTY 50 comparison: the price index bought with the same money at the first day’s close — index dividends (≈1–1.5 % a year) aren’t included.'] : []),
    'Stock lists are today’s members — stocks that left an index or were delisted aren’t included (survivorship bias).',
  ];

  return {
    strategyName: def.name,
    definition: def,
    from: req.from,
    to: req.to,
    symbols: candles.length,
    capital: req.capital,
    finalEquity: req.capital !== null ? round2(final) : null,
    netPnl,
    returnPct: req.capital !== null ? round2((netPnl / req.capital) * 100) : null,
    cagrPct: req.capital !== null ? cagr(req.capital, final, first, last) : null,
    maxDrawdownPct: req.capital !== null ? dd.maxPct : null,
    maxDrawdown: dd.maxAmount,
    stats: tradeStats(sim.trades, sim.exposedDays, sim.days),
    benchmark,
    curve: thin(curve, MAX_CURVE_POINTS),
    monthly: req.capital !== null ? periodReturns(sim.curve, req.capital, 7).map((m) => ({ month: m.key, returnPct: m.returnPct })) : [],
    yearly: req.capital !== null ? periodReturns(sim.curve, req.capital, 4).map((m) => ({ year: m.key, returnPct: m.returnPct })) : [],
    perSymbol: perSymbol.sort((a, b) => b.netPnl - a.netPnl),
    trades: [...sim.trades].sort((a, b) => b.entryDate.localeCompare(a.entryDate) || a.symbol.localeCompare(b.symbol)),
    openAtEnd: sim.openAtEnd,
    skipped: sim.skipped,
    notes: assumptions,
  };
}
