/**
 * Real historical candles via Kite Connect's getHistoricalData (paid API +
 * a live session). Used by both the analyzer and the live evaluator.
 *
 * Kite caps each historical request by interval (e.g. ~200 days for 15minute),
 * so a long date range is split into windows fetched sequentially (to respect
 * the ~3 req/sec rate limit) and concatenated. Dates are sent as IST wall-clock
 * strings, which is how Kite interprets them.
 */
import type { OHLCV, Timeframe } from '@ash/shared';
import { childLogger } from '../../utils/logger';
import type { HistoricalCandleQuery, HistoricalDataProvider } from './HistoricalDataProvider';
import type { KiteAuthService } from './kiteAuth';
import { delay, isKiteRateLimit, type KiteClient } from './kiteClient';

const log = childLogger('kite-historical');
const INTERVAL: Record<Timeframe, string> = {
  '1m': 'minute',
  '3m': '3minute',
  '5m': '5minute',
  '10m': '10minute',
  '15m': '15minute',
  '30m': '30minute',
  '1h': '60minute',
};

/** Max days Kite allows per historical request, per interval (conservative). */
const MAX_DAYS: Record<Timeframe, number> = {
  '1m': 55,
  '3m': 90,
  '5m': 90,
  '10m': 90,
  '15m': 180,
  '30m': 180,
  '1h': 360,
};

const DAY_MS = 86_400_000;

interface KiteCandle {
  date: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}
// Kite historical API allows ~3 req/sec; space requests and retry on 429.
const MIN_INTERVAL_MS = 350;
const MAX_RETRIES = 4;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class KiteHistoricalProvider implements HistoricalDataProvider {
  readonly name = 'kite';
  private gate: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  constructor(private readonly auth: KiteAuthService) {}

  /** Serialize + space historical requests, retrying with backoff on 429. */
  private async request(kc: KiteClient, token: number, interval: string, from: string, to: string): Promise<KiteCandle[]> {
    const call = this.gate.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = MIN_INTERVAL_MS - (Date.now() - this.lastCallAt);
        if (wait > 0) await delay(wait);
        this.lastCallAt = Date.now();
        try {
          // continuous=false, oi=true (open interest powers the OI indicator).
          return await kc.getHistoricalData(token, interval, from, to, false, true);
        } catch (err) {
          if (isKiteRateLimit(err) && attempt < MAX_RETRIES) {
            await delay(1000 * (attempt + 1));
            continue;
          }
          throw err;
        }
      }
    });
    this.gate = call.catch(() => undefined); // keep the queue alive after failures
    return call as Promise<KiteCandle[]>;
  }

  async getCandles(q: HistoricalCandleQuery): Promise<OHLCV[]> {
    return this.auth.call((kc) => this.fetch(kc, q));
  }

  private async fetch(kc: KiteClient, q: HistoricalCandleQuery): Promise<OHLCV[]> {
    const interval = INTERVAL[q.timeframe];
    const windowMs = MAX_DAYS[q.timeframe] * DAY_MS;

    const start = Date.parse(`${q.from}T00:00:00Z`);
    const end = Date.parse(`${q.to}T23:59:59Z`);

    const out: OHLCV[] = [];
    const seen = new Set<number>();
    for (let ws = start; ws <= end; ws += windowMs) {
      const we = Math.min(ws + windowMs - DAY_MS, end);
      const rows = await this.request(kc, q.token, interval, `${isoDate(ws)} 00:00:00`, `${isoDate(we)} 23:59:59`);
      for (const c of rows) {
        const time = Math.floor(new Date(c.date).getTime() / 1000);
        if (seen.has(time)) continue;
        seen.add(time);
        out.push({ time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, oi: c.oi });
      }
    }
    out.sort((a, b) => a.time - b.time);
    log.debug({ token: q.token, timeframe: q.timeframe, candles: out.length }, 'fetched kite historical');
    return out;
  }
}
