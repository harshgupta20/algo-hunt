/**
 * Broker-agnostic historical-candle source. The backtest runner and the live
 * evaluator depend only on this interface (Kite in production; tests inject
 * fixed candle fixtures).
 */
import type { OHLCV, Timeframe } from '@ash/shared';

export interface HistoricalCandleQuery {
  token: number;
  timeframe: Timeframe;
  /** Inclusive IST date range, yyyy-mm-dd. */
  from: string;
  to: string;
}

export interface HistoricalDataProvider {
  readonly name: string;
  /**
   * OHLCV candles for one instrument/timeframe over a date range, ascending by
   * time. During market hours the final candle may still be forming.
   */
  getCandles(query: HistoricalCandleQuery): Promise<OHLCV[]>;
}
