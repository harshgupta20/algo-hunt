/**
 * A trade's story: the price path while it was held (and a little after), its best and worst price, how its stop
 * moved (the fixed stop-loss, then the trailing stop once it is tighter), when the target started trailing and why
 * it closed — the whole trade, not only the exit badge. The backtests record the path as they walk the 1-minute
 * candles; a paper trade's path is read from Kite's 1-minute candles when its story is opened.
 */
import type { PaperTrade } from './paper';
import { atTarget, stopNow, trailsPastTarget } from './paper';

/** [open time (epoch s), open, high, low, close] */
export type PathBar = [number, number, number, number, number];

export interface TradePath {
  /** Minutes of trading per bar (1-minute candles merged; the gaps between sessions are left out). */
  step: number;
  /** Bars from the entry minute on: the first `held` are the trade (the last one ends at the exit), the rest what the price did after it closed. */
  bars: PathBar[];
  held: number;
}

type Minute = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Bar sizes tried, smallest first — the first that fits the trade in PATH_BARS bars is used. */
const PATH_STEPS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 240, 480, 960, 1920];
const PATH_BARS = 48;
/** Bars of what came after the exit, at most. */
const AFTER_BARS = 12;

/** Index of the first candle opening at or after `ms` (candles ascending). */
function firstAtOrAfter(minutes: Minute[], ms: number): number {
  let lo = 0;
  let hi = minutes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (minutes[mid]!.time * 1000 < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function merge(minutes: Minute[], from: number, to: number, step: number): PathBar[] {
  const out: PathBar[] = [];
  for (let i = from; i < to; i += step) {
    const end = Math.min(to, i + step);
    let high = minutes[i]!.high;
    let low = minutes[i]!.low;
    for (let j = i + 1; j < end; j++) {
      high = Math.max(high, minutes[j]!.high);
      low = Math.min(low, minutes[j]!.low);
    }
    out.push([minutes[i]!.time, minutes[i]!.open, high, low, minutes[end - 1]!.close]);
  }
  return out;
}

/**
 * The path of a trade held from `entryMs` to `exitMs` (null = still open) on its contract's 1-minute candles
 * (ascending): the minutes from the entry's to the exit's merged into at most PATH_BARS bars, then up to AFTER_BARS
 * bars of the same size after the exit. Undefined when no minute falls inside the trade.
 */
export function tradePath(minutes: Minute[], entryMs: number, exitMs: number | null): TradePath | undefined {
  // From the minute the entry falls in (a live entry comes seconds into a minute; a backtest's is on its start).
  const from = firstAtOrAfter(minutes, Math.floor(entryMs / 60_000) * 60_000);
  const to = exitMs === null ? minutes.length : firstAtOrAfter(minutes, exitMs);
  const n = to - from;
  if (n <= 0) return undefined;
  const step = PATH_STEPS.find((s) => Math.ceil(n / s) <= PATH_BARS) ?? Math.ceil(n / PATH_BARS);
  const held = merge(minutes, from, to, step);
  const after = exitMs === null ? [] : merge(minutes, to, Math.min(minutes.length, to + AFTER_BARS * step), step);
  return { step, bars: [...held, ...after], held: held.length };
}

export type StopLevel = { price: number; reason: 'STOP' | 'TRAIL' };

export interface StoryBar {
  /** Open time (ms). */
  at: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** The stop in force during the bar — the fixed stop-loss or the trailing stop, whichever was tighter (null = none). */
  stop: StopLevel | null;
  /** After the trade closed (shown for context). */
  after: boolean;
}

/** The stop moved from bar `bar` on: the best price before it raised (lowered, for a sell) the trailing stop. */
export interface StopMove {
  bar: number;
  /** When the new level was in force (ms) — bar precision. */
  at: number;
  best: number;
  from: StopLevel | null;
  to: StopLevel;
}

export interface TradeStory {
  bars: StoryBar[];
  moves: StopMove[];
  /** The target reached and trailing started (trades that trail past their target): when (ms) and the stop then. */
  trailingFrom: { at: number; bar: number } | null;
  /** Best / worst price while held (the time to the bar; a closed trade's best is its own best price) and the profit / loss there, before charges. */
  best: { price: number; at: number; pnl: number } | null;
  worst: { price: number; at: number; pnl: number } | null;
  /** The stop when the trade closed (or now, while open). */
  finalStop: StopLevel | null;
  /** What the price did after the exit (null = nothing after it, or still open). */
  after: { high: number; low: number; close: number; minutes: number } | null;
}

const sameStop = (a: StopLevel | null, b: StopLevel | null) => a?.price === b?.price && a?.reason === b?.reason;

/** The story of a trade over its path. */
export function tradeStory(t: PaperTrade, path: TradePath): TradeStory {
  const buy = t.side === 'BUY';
  const better = (a: number, b: number) => (buy ? a > b : a < b);
  const pnlAt = (price: number) => (buy ? price - t.entryPrice : t.entryPrice - price) * t.quantity;
  const closed = t.status === 'CLOSED';
  const finalStop = stopNow(t);
  const trails = trailsPastTarget(t);
  const bars: StoryBar[] = [];
  const moves: StopMove[] = [];
  let peak = t.entryPrice;
  let trailingFrom: TradeStory['trailingFrom'] = null;
  let best: TradeStory['best'] = null;
  let worst: TradeStory['worst'] = null;
  path.bars.forEach(([sec, open, high, low, close], i) => {
    const at = sec * 1000;
    const after = i >= path.held;
    // The exit bar's stop is the trade's own (its best price is exact to the minute); the others follow the bars before.
    const stop = after ? (bars.at(-1)?.stop ?? null) : i === path.held - 1 && closed ? finalStop : stopNow({ ...t, peakPrice: peak });
    const prev = bars.at(-1);
    if (!after && prev && !sameStop(prev.stop, stop) && stop)
      moves.push({
        bar: i,
        at,
        best: i === path.held - 1 && closed ? (t.peakPrice ?? peak) : peak,
        from: prev.stop,
        to: stop,
      });
    bars.push({ at, open, high, low, close, stop, after });
    if (after) return;
    // A closed trade's best is its own (the exit minute's range came after the stop was hit — it doesn't count).
    const reach = buy ? high : low;
    const top = closed && t.peakPrice !== undefined && better(reach, t.peakPrice) ? t.peakPrice : reach;
    const bottom = buy ? low : high;
    if (!best || better(top, best.price)) best = { price: top, at, pnl: pnlAt(top) };
    if (!worst || better(worst.price, bottom)) worst = { price: bottom, at, pnl: pnlAt(bottom) };
    if (better(top, peak)) peak = top;
    if (trails && !trailingFrom && atTarget(t, peak))
      trailingFrom = {
        at: t.trailingAt ? Date.parse(t.trailingAt) : at,
        bar: i,
      };
  });
  const tail = path.bars.slice(path.held);
  return {
    bars,
    moves,
    trailingFrom,
    best,
    worst,
    finalStop,
    after: tail.length
      ? {
          high: Math.max(...tail.map((b) => b[2])),
          low: Math.min(...tail.map((b) => b[3])),
          close: tail.at(-1)![4],
          minutes: tail.length * path.step,
        }
      : null,
  };
}
