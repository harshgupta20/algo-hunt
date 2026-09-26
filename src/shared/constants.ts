/**
 * Shared constants.
 */
import type { Timeframe } from './types/market';

/** Candle length per Kite interval. */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 1 * 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '10m': 10 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};
