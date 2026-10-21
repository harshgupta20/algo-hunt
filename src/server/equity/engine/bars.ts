/**
 * Candles as columns (fast, compact) — daily from Kite, weekly built from daily.
 *
 *   Daily   one candle per trading day; `date` is its IST date.
 *   Weekly  Monday–Sunday weeks (IST): open of the first day, highest high, lowest low, close of the last day,
 *           summed volume; `date` is the week's LAST trading day (when the weekly candle closes).
 *           The last week counts as complete only when no weekday of it is left after the data's end date —
 *           so a weekly check never uses a half-built week. (A week cut short by a Friday holiday completes once
 *           that Friday's date is reached — no exchange holiday calendar is used.)
 */

export interface Bars {
  /** IST trading date per candle (yyyy-mm-dd); weekly: the week's last trading day. */
  date: string[];
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  length: number;
}

export interface WeeklyBars extends Bars {
  /** Daily index of each week's first and last day. */
  firstDaily: Int32Array;
  lastDaily: Int32Array;
  /** Whether each week is complete (only the last can be incomplete). */
  complete: boolean[];
}

export interface RawDailyCandle {
  /** Epoch seconds (Kite's daily candle time = IST midnight). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;

export const istDateOf = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** The Monday of the date's week. */
export const weekKey = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

function empty(n: number): Omit<Bars, 'date' | 'length'> {
  return { open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n), volume: new Float64Array(n) };
}

/**
 * Daily bars from Kite candles: sorted by date, one per IST date (the later candle wins on a duplicate). A bad
 * tick in the source — an open or close outside the high–low, or a high below the low — is repaired: high = the
 * largest of the four prices, low = the smallest, so stops and targets never read an impossible day.
 */
export function dailyBars(candles: RawDailyCandle[]): Bars {
  const byDate = new Map<string, RawDailyCandle>();
  for (const c of candles) {
    if (![c.open, c.high, c.low, c.close].every((x) => Number.isFinite(x) && x > 0)) continue;
    byDate.set(istDateOf(c.time * 1000), c);
  }
  const dates = [...byDate.keys()].sort();
  const b = { date: dates, ...empty(dates.length), length: dates.length };
  dates.forEach((d, i) => {
    const c = byDate.get(d)!;
    b.open[i] = c.open;
    b.high[i] = Math.max(c.open, c.high, c.low, c.close);
    b.low[i] = Math.min(c.open, c.high, c.low, c.close);
    b.close[i] = c.close;
    b.volume[i] = Number.isFinite(c.volume) ? c.volume : 0;
  });
  return b;
}

/** Daily bars from `from` to `to` (inclusive IST dates) — a view sharing nothing with the source. */
export function sliceBars(b: Bars, from: number, to: number): Bars {
  return { date: b.date.slice(from, to), open: b.open.slice(from, to), high: b.high.slice(from, to), low: b.low.slice(from, to), close: b.close.slice(from, to), volume: b.volume.slice(from, to), length: Math.max(0, to - from) };
}

/** Only the candles on these dates (the source unchanged when every candle is on one). */
export function onDates(b: Bars, dates: ReadonlySet<string>): Bars {
  const keep: number[] = [];
  for (let i = 0; i < b.length; i++) if (dates.has(b.date[i]!)) keep.push(i);
  if (keep.length === b.length) return b;
  const pick = (a: Float64Array) => Float64Array.from(keep, (i) => a[i]!);
  return { date: keep.map((i) => b.date[i]!), open: pick(b.open), high: pick(b.high), low: pick(b.low), close: pick(b.close), volume: pick(b.volume), length: keep.length };
}

/**
 * Weekly bars from daily ones. `endDate` is the last date the data could contain (the period's end, or the
 * last finished session): the final week is complete when no weekday of it comes after `endDate`.
 */
export function weeklyBars(d: Bars, endDate: string): WeeklyBars {
  const groups: Array<[number, number]> = [];
  for (let i = 0; i < d.length; i++) {
    const last = groups.at(-1);
    if (last && weekKey(d.date[last[1]]!) === weekKey(d.date[i]!)) last[1] = i;
    else groups.push([i, i]);
  }
  const n = groups.length;
  const w: WeeklyBars = { date: [], ...empty(n), length: n, firstDaily: new Int32Array(n), lastDaily: new Int32Array(n), complete: [] };
  groups.forEach(([a, z], k) => {
    let hi = -Infinity;
    let lo = Infinity;
    let vol = 0;
    for (let i = a; i <= z; i++) {
      hi = Math.max(hi, d.high[i]!);
      lo = Math.min(lo, d.low[i]!);
      vol += d.volume[i]!;
    }
    w.date.push(d.date[z]!);
    w.open[k] = d.open[a]!;
    w.high[k] = hi;
    w.low[k] = lo;
    w.close[k] = d.close[z]!;
    w.volume[k] = vol;
    w.firstDaily[k] = a;
    w.lastDaily[k] = z;
    w.complete.push(true);
  });
  if (n) {
    const lastDate = w.date[n - 1]!;
    // Friday of the last week: complete when the data can't reach a later weekday of that week.
    const friday = addDays(weekKey(lastDate), 4);
    w.complete[n - 1] = endDate >= friday;
  }
  return w;
}
