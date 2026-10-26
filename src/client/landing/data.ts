/**
 * Sample data for the landing page's demos. Everything here is synthetic and
 * deterministic (seeded), so the server render and the browser agree, and the
 * figures shown are computed by real rules on these prices, never typed in.
 */

export interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Small, fast seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rounds away the last-digit differences between JavaScript engines' Math.sin / Math.cos
 * (Node on the server, the browser on the client), so both render the same numbers.
 */
export const steady = (v: number, places = 9) => Math.round(v * 10 ** places) / 10 ** places;

/** Roughly normal noise from a uniform source. */
const gauss = (r: () => number) => (r() + r() + r() + r() - 2) * 1.22;

export function sma(values: number[], n: number): Array<number | null> {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n]!;
    return i >= n - 1 ? sum / n : null;
  });
}

/** Bars from per-bar drifts: each bar opens near the last close. */
function walk(seed: number, start: number, drift: (i: number) => number, vol: number, count: number): Bar[] {
  const r = rng(seed);
  const bars: Bar[] = [];
  let last = start;
  for (let i = 0; i < count; i++) {
    const o = last * (1 + gauss(r) * vol * 0.25);
    const c = o * (1 + drift(i) + gauss(r) * vol);
    const h = Math.max(o, c) * (1 + r() * vol * 0.7);
    const l = Math.min(o, c) * (1 - r() * vol * 0.7);
    bars.push({ o, h, l, c });
    last = c;
  }
  return bars;
}

/** The hero's background chart: a 5-minute session. */
export function heroBars(count = 96): Bar[] {
  return walk(7, 25_380, (i) => steady(0.00035 * Math.sin(i / 9) + 0.00012), 0.0011, count);
}

// ---------------------------------------------------------------------------
// Backtest demo: SMA 8 × SMA 21 crossover on weekly candles, all-in, ₹1,00,000.

export interface SampleTrade {
  entryIdx: number;
  exitIdx: number;
  entry: number;
  exit: number;
  pnl: number;
}

export interface BacktestSample {
  bars: Bar[];
  fast: Array<number | null>;
  slow: Array<number | null>;
  trades: SampleTrade[];
  equity: number[];
  hold: number[];
  capital: number;
  years: number;
  barsPerYear: number;
  firstYear: number;
}

export function backtestSample(seed = 119, fastN = 8, slowN = 21): BacktestSample {
  const barsPerYear = 52;
  const years = 6;
  const regimes = [0.007, -0.005, 0.005, 0.0005, -0.006, 0.008, 0.002, -0.004, 0.006, -0.002, 0.005, 0.001];
  const bars = walk(seed, 1_000, (i) => regimes[Math.floor(i / 19) % regimes.length]!, 0.021, barsPerYear * years);
  const closes = bars.map((b) => b.c);
  const fast = sma(closes, fastN);
  const slow = sma(closes, slowN);
  const capital = 100_000;

  const trades: SampleTrade[] = [];
  const equity: number[] = [];
  let cash = capital;
  let units = 0;
  let open: { idx: number; price: number; cost: number } | null = null;
  for (let i = 0; i < bars.length; i++) {
    const close = closes[i]!;
    const f = fast[i];
    const s = slow[i];
    const pf = fast[i - 1];
    const ps = slow[i - 1];
    if (f != null && s != null && pf != null && ps != null) {
      if (!open && f > s && pf <= ps) {
        units = cash / close;
        open = { idx: i, price: close, cost: cash };
        cash = 0;
      } else if (open && f < s && pf >= ps) {
        cash = units * close;
        trades.push({ entryIdx: open.idx, exitIdx: i, entry: open.price, exit: close, pnl: cash - open.cost });
        units = 0;
        open = null;
      }
    }
    equity.push(open ? units * close : cash);
  }
  if (open) {
    const last = bars.length - 1;
    const close = closes[last]!;
    trades.push({ entryIdx: open.idx, exitIdx: last, entry: open.price, exit: close, pnl: units * close - open.cost });
  }
  const hold = closes.map((c) => (capital * c) / closes[0]!);
  return { bars, fast, slow, trades, equity, hold, capital, years, barsPerYear, firstYear: 2020 };
}

export interface BacktestStats {
  value: number;
  ret: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
}

/** Figures as of bar `upTo` — what the result would say if the test ended there. */
export function statsAt(b: BacktestSample, upTo: number): BacktestStats {
  const closed = b.trades.filter((t) => t.exitIdx <= upTo);
  const wins = closed.filter((t) => t.pnl > 0);
  const gain = wins.reduce((a, t) => a + t.pnl, 0);
  const loss = closed.filter((t) => t.pnl <= 0).reduce((a, t) => a - t.pnl, 0);
  let peak = b.capital;
  let maxDrawdown = 0;
  for (let i = 0; i <= upTo; i++) {
    peak = Math.max(peak, b.equity[i]!);
    maxDrawdown = Math.max(maxDrawdown, (peak - b.equity[i]!) / peak);
  }
  const value = b.equity[upTo]!;
  return {
    value,
    ret: value / b.capital - 1,
    trades: closed.length,
    winRate: closed.length ? wins.length / closed.length : null,
    profitFactor: loss > 0 ? gain / loss : closed.length ? Infinity : null,
    maxDrawdown,
  };
}

/** Month-by-month returns of the account (12 per year), with each month's last bar. */
export function monthlyReturns(b: BacktestSample): Array<{ ret: number; end: number }> {
  const out: Array<{ ret: number; end: number }> = [];
  const months = b.years * 12;
  for (let m = 0; m < months; m++) {
    const from = Math.round((m * b.barsPerYear) / 12);
    const to = Math.min(b.equity.length - 1, Math.round(((m + 1) * b.barsPerYear) / 12));
    const startValue = from === 0 ? b.capital : b.equity[from - 1]!;
    out.push({ ret: b.equity[to]! / startValue - 1, end: to });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pyramiding demo: buy on a 20-day closing high above SMA 20; add a lot each time
// the rising SMA reaches the last buy price (close at or above it); the stop for
// every lot is the SMA at that add. Orders fill at the next day's open.

export interface PyramidEvent {
  kind: 'BUY' | 'ADD' | 'EXIT';
  /** Bar whose close signalled it. */
  signalIdx: number;
  /** Bar it filled on. */
  idx: number;
  price: number;
  /** Stop for all lots after this event (none after the exit). */
  stop: number | null;
  lots: number;
}

export interface PyramidSample {
  bars: Bar[];
  ma: Array<number | null>;
  events: PyramidEvent[];
}

export function pyramidSample(seed = 11, maxAdds = 3): PyramidSample {
  const wave = (i: number) => steady(0.0062 + 0.012 * Math.sin(i / 4.2) - (i > 112 ? 0.024 : 0));
  const bars = walk(seed, 1_180, wave, 0.009, 128);
  const ma = sma(
    bars.map((b) => b.c),
    20,
  );
  const events: PyramidEvent[] = [];
  let lots = 0;
  let lastBuy = 0;
  let stop: number | null = null;
  let pending: { kind: 'BUY' | 'ADD'; signalIdx: number; stop: number | null } | null = null;

  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    if (pending) {
      lots += 1;
      lastBuy = b.o;
      if (pending.stop !== null) stop = pending.stop;
      events.push({ kind: pending.kind, signalIdx: pending.signalIdx, idx: i, price: b.o, stop, lots });
      pending = null;
    }
    if (lots && stop !== null && b.l <= stop) {
      const price = b.o < stop ? b.o : stop;
      events.push({ kind: 'EXIT', signalIdx: i, idx: i, price, stop: null, lots });
      break;
    }
    const m = ma[i];
    const pm = ma[i - 1];
    if (m == null || pm == null) continue;
    const high20 = Math.max(...bars.slice(Math.max(0, i - 20), i).map((x) => x.c));
    if (!lots && i >= 20 && b.c > high20 && b.c > m) pending = { kind: 'BUY', signalIdx: i, stop: null };
    else if (lots && lots <= maxAdds && m > pm && m >= lastBuy && b.c >= m) pending = { kind: 'ADD', signalIdx: i, stop: m };
  }
  return { bars, ma, events };
}
