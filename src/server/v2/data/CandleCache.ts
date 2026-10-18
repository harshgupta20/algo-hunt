/**
 * Backtest candle memory: a re-run (another target, stop-loss, capital…) reads the candles an earlier run fetched
 * instead of asking Kite again. Only final candles are kept — the range ended before today, or the instrument's
 * market has closed for the day — for an hour; past MAX_CANDLES the least recently used go first. Memory only.
 */
import type { Market } from '@/shared/v2';
import { marketOfExchange } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import type { MarketCalendar } from '../calendar/MarketCalendar';
import type { RawCandle } from '../engine/candles';
import type { CandleQuery, V2DataProvider } from './DataProvider';

const TTL_MS = 60 * 60_000;
/** ~200 MB of candles. */
const MAX_CANDLES = 2_500_000;
/** Kite's last candle of the day can land a few minutes after the close. */
const SETTLE_MS = 5 * 60_000;

/** Candle sets fetched from Kite / answered from memory. */
export interface CandleStats {
  fetched: number;
  cached: number;
}

export class CandleCache {
  private readonly entries = new Map<string, { rows: RawCandle[]; at: number }>();
  private size = 0;

  /** `base` with its historical candles served from (and kept in) this cache, counted in `stats`. */
  wrap(base: V2DataProvider, cals: Record<Market, MarketCalendar>, now: () => number, stats: CandleStats): V2DataProvider {
    const final = (q: CandleQuery): boolean => {
      const t = now();
      const today = istDate(t);
      if (q.to < today) return true;
      const cal = cals[marketOfExchange(q.instrument.exchange)];
      return !cal.isTradingDay(today) || t >= cal.sessionEnd(today) + SETTLE_MS;
    };
    return {
      name: base.name,
      isConnected: () => base.isConnected(),
      getInstruments: () => base.getInstruments(),
      getLtp: (list) => base.getLtp(list),
      getQuotes: (list) => base.getQuotes(list),
      getHistoricalCandles: async (q) => {
        const key = `${q.instrument.token}|${q.interval}|${q.from}|${q.to}`;
        const hit = this.get(key, now());
        if (hit) {
          stats.cached++;
          return hit;
        }
        stats.fetched++;
        const rows = await base.getHistoricalCandles(q);
        if (final(q)) this.put(key, rows, now());
        return rows;
      },
    };
  }

  private get(key: string, t: number): RawCandle[] | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    this.entries.delete(key);
    if (t - e.at > TTL_MS) {
      this.size -= e.rows.length;
      return undefined;
    }
    this.entries.set(key, e); // most recently used last
    return e.rows;
  }

  private put(key: string, rows: RawCandle[], t: number): void {
    const old = this.entries.get(key);
    if (old) {
      this.entries.delete(key);
      this.size -= old.rows.length;
    }
    if (rows.length > MAX_CANDLES) return;
    this.entries.set(key, { rows, at: t });
    this.size += rows.length;
    for (const [k, e] of this.entries) {
      if (this.size <= MAX_CANDLES) break;
      this.entries.delete(k);
      this.size -= e.rows.length;
    }
  }
}
