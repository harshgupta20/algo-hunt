/**
 * Deterministic synthetic historical candles. Prices are driven by a shared,
 * time-based market signal so the three legs are correlated the way real ones
 * are — Future and Call move WITH the signal, Put moves against it — which makes
 * the strategy fire realistically. Fully deterministic: identical filters (and
 * the chart window) always reproduce the same candles.
 */
import type { OHLCV } from '@ash/shared';
import { TIMEFRAME_MS } from '@ash/shared';
import type { HistoricalCandleQuery, HistoricalDataProvider } from './HistoricalDataProvider.js';
import type { InstrumentStore } from './instrumentStore.js';

// NSE session 09:15–15:30 IST expressed in UTC minutes (IST = UTC+5:30).
const SESSION_OPEN_UTC_MIN = 3 * 60 + 45; // 03:45 UTC
const SESSION_CLOSE_UTC_MIN = 10 * 60; // 10:00 UTC
const DAY_MS = 86_400_000;

/** Deterministic hash in [0,1) — reproducible pseudo-noise. */
function hashNoise(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 0.0009871 * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth multi-period market oscillator in roughly [-1, 1]. */
function marketSignal(bucketMs: number): number {
  const minutes = bucketMs / 60_000;
  return (
    0.7 * Math.sin((minutes / (60 * 4)) * 2 * Math.PI) +
    0.3 * Math.sin((minutes / (60 * 1.3)) * 2 * Math.PI + 1)
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class MockHistoricalProvider implements HistoricalDataProvider {
  readonly name = 'mock';

  constructor(private readonly store: InstrumentStore) {}

  async getCandles(q: HistoricalCandleQuery): Promise<OHLCV[]> {
    const inst = this.store.instrument(q.token);
    const type = inst?.instrumentType ?? 'FUT';
    const sign = type === 'PE' ? -1 : 1; // Put moves against the market signal
    const base = type === 'FUT' ? 1000 : 120;
    const amp = type === 'FUT' ? 0.035 : 0.12; // options are more volatile (RSI is scale-invariant)
    const tfMs = TIMEFRAME_MS[q.timeframe];

    // Give the Future a slight phase lead so it sometimes crosses its level a
    // candle before the Call — producing a realistic mix of Scenario 1 (all
    // cross together) and Scenario 2 (future already above when call/put cross).
    const lead = type === 'FUT' ? tfMs * 0.6 : 0;

    const out: OHLCV[] = [];
    let prevClose: number | undefined;
    for (const bucket of this.buckets(q.from, q.to, tfMs)) {
      const m = marketSignal(bucket + lead);
      const n = hashNoise(q.token, bucket);
      const close = round2(Math.max(base * (1 + amp * sign * m) * (1 + (n - 0.5) * 0.006), 0.5));
      const open = prevClose ?? close;
      const wick = Math.abs(close - open) * 0.5 + close * 0.0012 * hashNoise(bucket, q.token);
      const high = round2(Math.max(open, close) + wick);
      const low = round2(Math.max(Math.min(open, close) - wick, 0.1));
      const volume = Math.round(1000 + hashNoise(q.token + 7, bucket) * 9000);
      out.push({ time: Math.floor(bucket / 1000), open, high, low, close, volume });
      prevClose = close;
    }
    return out;
  }

  /** Candle bucket start times across trading days in [from, to]. */
  private buckets(from: string, to: string, tfMs: number): number[] {
    const startDay = Date.parse(`${from}T00:00:00Z`);
    const endDay = Date.parse(`${to}T00:00:00Z`);
    const buckets: number[] = [];
    for (let day = startDay; day <= endDay; day += DAY_MS) {
      const dow = new Date(day).getUTCDay();
      if (dow === 0 || dow === 6) continue; // skip weekends
      const openMs = day + SESSION_OPEN_UTC_MIN * 60_000;
      const closeMs = day + SESSION_CLOSE_UTC_MIN * 60_000;
      for (let t = openMs; t < closeMs; t += tfMs) buckets.push(t);
    }
    return buckets;
  }
}
