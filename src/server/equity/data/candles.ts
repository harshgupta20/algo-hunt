/**
 * Daily candles for equity backtests and screens, through the app's shared Kite queue (~3 requests a second;
 * Kite serves up to ~1,900 days per request, so one stock is usually one request).
 *
 * Only FINISHED sessions are used: today's candle counts once the market has closed (15:30 IST + a settle
 * margin); during the session Kite's forming candle is dropped. The cache keeps each stock's candles in memory
 * for the rest of the session they were fetched in — re-runs that day ask Kite for nothing — and refetches after
 * the next session finishes, which also picks up Kite's later corrections (a split adjusted after the fact).
 * Memory only (never the database); the least recently used stocks go first past MAX_BARS.
 */
import { addDays, dailyBars, istDateOf, sliceBars, weekday, type Bars, type RawDailyCandle } from '../engine/bars';

/** Kite's candle source (the app's KiteHistoricalProvider). */
export interface DailySource {
  getCandles(q: { token: number; timeframe: '1d'; from: string; to: string }): Promise<RawDailyCandle[]>;
}

export interface CandleStats {
  fetched: number;
  cached: number;
}

const IST_MS = 5.5 * 3600_000;
/** 15:30 close + 10 min for Kite's final daily candle. */
const SESSION_DONE_MIN = 15 * 60 + 40;
/** ~80 bytes a candle: 4M ≈ 320 MB — a NIFTY 500 run with history from 2000 fits without refetching mid-run. */
const MAX_BARS = 4_000_000;

/** The last date whose daily candle is final: today after the close on a weekday, else the previous weekday. */
export function lastFinishedSession(now: number): string {
  const today = istDateOf(now);
  const minute = Math.floor(((now + IST_MS) % 86_400_000) / 60_000);
  const wd = weekday(today);
  if (wd >= 1 && wd <= 5 && minute >= SESSION_DONE_MIN) return today;
  let d = addDays(today, -1);
  while ([0, 6].includes(weekday(d))) d = addDays(d, -1);
  return d;
}

interface Entry {
  from: string;
  /** Candles are final up to this date (the data's end when fetched). */
  asOf: string;
  /** The last finished session when fetched — the entry is reused only until a newer one finishes. */
  session: string;
  bars: Bars;
}

export class CandleCache {
  private readonly entries = new Map<number, Entry>();
  private size = 0;

  constructor(
    private readonly source: DailySource,
    private readonly now: () => number = Date.now,
  ) {}

  /** Where data for a period ending `to` can end: `to`, or the last finished session if that's earlier. */
  endDate(to: string): string {
    const done = lastFinishedSession(this.now());
    return to < done ? to : done;
  }

  /** Daily candles of a stock from `from` to `to` (inclusive), finished sessions only. */
  async daily(token: number, from: string, to: string, stats: CandleStats): Promise<Bars> {
    const end = this.endDate(to);
    const hit = this.entries.get(token);
    const session = lastFinishedSession(this.now());
    if (hit && hit.session === session && hit.from <= from && hit.asOf >= end) {
      stats.cached++;
      this.touch(token, hit);
      return this.cut(hit.bars, from, end);
    }
    stats.fetched++;
    const fetchFrom = hit && hit.session === session && hit.from < from ? hit.from : from;
    const rows = await this.source.getCandles({ token, timeframe: '1d', from: fetchFrom, to: end });
    const bars = dailyBars(rows.filter((c) => istDateOf(c.time * 1000) <= end));
    this.store(token, { from: fetchFrom, asOf: end, session, bars });
    return this.cut(bars, from, end);
  }

  private cut(b: Bars, from: string, to: string): Bars {
    let a = 0;
    while (a < b.length && b.date[a]! < from) a++;
    let z = b.length;
    while (z > a && b.date[z - 1]! > to) z--;
    return a === 0 && z === b.length ? b : sliceBars(b, a, z);
  }

  private touch(token: number, e: Entry) {
    this.entries.delete(token);
    this.entries.set(token, e);
  }

  private store(token: number, e: Entry) {
    const old = this.entries.get(token);
    if (old) {
      this.entries.delete(token);
      this.size -= old.bars.length;
    }
    this.entries.set(token, e);
    this.size += e.bars.length;
    for (const [t, x] of this.entries) {
      if (this.size <= MAX_BARS || t === token) break;
      this.entries.delete(t);
      this.size -= x.bars.length;
    }
  }
}
