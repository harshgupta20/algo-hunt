import type { Timeframe } from '@ash/shared';
import { TIMEFRAME_MS } from '@ash/shared';

/**
 * Floor an epoch-ms timestamp to the start of its candle bucket for a given
 * timeframe. Buckets are aligned to the clock (epoch). For 5m/15m/30m this
 * also aligns to IST wall-clock boundaries; 1h aligns to the epoch hour.
 */
export function bucketStart(timestampMs: number, timeframe: Timeframe): number {
  const size = TIMEFRAME_MS[timeframe];
  return Math.floor(timestampMs / size) * size;
}

/** The bucket start immediately preceding `bucket` for the timeframe. */
export function previousBucket(bucket: number, timeframe: Timeframe): number {
  return bucket - TIMEFRAME_MS[timeframe];
}
