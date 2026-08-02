/**
 * Broker-agnostic historical-candle source, mirroring the live
 * MarketDataProvider abstraction. The backtest runner depends only on this, so
 * the mock generator swaps for real Kite history via configuration alone.
 */
import type { OHLCV, Timeframe } from '@ash/shared';

export interface HistoricalCandleQuery {
  token: number;
  timeframe: Timeframe;
  /** Inclusive date range, yyyy-mm-dd. */
  from: string;
  to: string;
}

export interface HistoricalDataProvider {
  readonly name: string;
  /** OHLCV candles for one instrument/timeframe over a date range, ascending by time. */
  getCandles(query: HistoricalCandleQuery): Promise<OHLCV[]>;
}
