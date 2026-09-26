/**
 * Per-cycle candle store. Each (instrument, native interval) is fetched at most
 * once per cycle over a fixed look-back window — so every strategy and unit
 * reading that instrument shares it — and every requested series (derived
 * timeframe × candle type) is built once from it. Requests are counted
 * against the cycle's budget; nothing is persisted (no stale-cache risk).
 */
import type { Market, SeriesSpec, Timeframe, V2Instrument } from '@/shared/v2';
import { TIMEFRAME, marketOfExchange } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import type { MarketCalendar } from '../calendar/MarketCalendar';
import { buildSeries, type Candle, type RawCandle } from '../engine/candles';
import type { SeriesLookup, SeriesResult } from '../engine/evaluator';
import { seriesKey } from '../engine/series';
import type { NativeInterval, V2DataProvider } from './DataProvider';

/**
 * Calendar days fetched per native interval: ≥ ~300 candles of most timeframes
 * built from it in either session (NSE 6¼ h, MCX up to 14½ h) with holiday margin.
 */
export const LOOKBACK_DAYS: Record<NativeInterval, number> = {
  '1m': 4,
  '3m': 6,
  '5m': 9,
  '10m': 14,
  '15m': 20,
  '30m': 35,
  '1h': 125,
  '1d': 1000,
};

const DAY = 86_400_000;

export class BudgetExceededError extends Error {
  constructor() {
    super('Request budget for this cycle is used up');
    this.name = 'BudgetExceededError';
  }
}

export class CandleService {
  requests = 0;
  private readonly raw = new Map<string, Promise<RawCandle[]>>();
  private readonly done = new Map<string, RawCandle[] | Error>();
  private readonly built = new Map<string, Candle[]>();

  constructor(
    private readonly provider: V2DataProvider,
    private readonly calendars: Record<Market, MarketCalendar>,
    readonly now: number,
    readonly budget: number = Infinity,
    /** Optional fixed window (replay): fetch [from, to] instead of the look-back. */
    private readonly window?: { from: string; to: string },
  ) {}

  static nativeKey(instrument: V2Instrument, interval: NativeInterval): string {
    return `${instrument.token}|${interval}`;
  }

  /** Whether (instrument, interval) still needs a request this cycle. */
  needsFetch(instrument: V2Instrument, interval: NativeInterval): boolean {
    return !this.raw.has(CandleService.nativeKey(instrument, interval));
  }

  remaining(): number {
    return this.budget - this.requests;
  }

  range(interval: NativeInterval): { from: string; to: string } {
    if (this.window) return { from: istDate(Date.parse(`${this.window.from}T00:00:00Z`) - LOOKBACK_DAYS[interval] * DAY), to: this.window.to };
    return { from: istDate(this.now - LOOKBACK_DAYS[interval] * DAY), to: istDate(this.now) };
  }

  /** Fetch (once) the native candles an instrument's series needs. Throws BudgetExceededError past the budget. */
  fetch(instrument: V2Instrument, interval: NativeInterval): Promise<RawCandle[]> {
    const key = CandleService.nativeKey(instrument, interval);
    let p = this.raw.get(key);
    if (!p) {
      if (this.requests >= this.budget) return Promise.reject(new BudgetExceededError());
      this.requests++;
      const { from, to } = this.range(interval);
      p = this.provider.getHistoricalCandles({ instrument, interval, from, to }).then(
        (c) => {
          // Never let candles after the clock leak in (replay / clock skew).
          const rows = c.filter((x) => x.time * 1000 <= this.now);
          this.done.set(key, rows);
          return rows;
        },
        (err: unknown) => {
          this.done.set(key, err instanceof Error ? err : new Error(String(err)));
          throw err;
        },
      );
      this.raw.set(key, p);
    }
    return p;
  }

  async fetchSeries(instrument: V2Instrument, tf: Timeframe): Promise<void> {
    await this.fetch(instrument, TIMEFRAME[tf].native);
  }

  /** Synchronous lookup over what has been fetched (for the evaluator). */
  lookup: SeriesLookup = (instrument: V2Instrument, spec: SeriesSpec): SeriesResult => {
    const key = seriesKey(instrument, spec);
    const hit = this.built.get(key);
    if (hit) return { candles: hit };
    const native = this.done.get(CandleService.nativeKey(instrument, TIMEFRAME[spec.timeframe].native));
    if (!native) return { error: 'series not fetched this cycle' };
    if (native instanceof Error) return { error: `data fetch failed: ${native.message}` };
    const candles = buildSeries(native, spec.timeframe, spec.candle, this.calendars[marketOfExchange(instrument.exchange)], this.now);
    this.built.set(key, candles);
    return { candles };
  };
}
