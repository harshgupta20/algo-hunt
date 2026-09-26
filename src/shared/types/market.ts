/**
 * Market primitives shared by the Kite data layer and the indicator maths.
 */

/** Kite candle intervals (weekly is aggregated from daily). */
export type Timeframe = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '1d' | '1w';

/** Session groups: NSE/BSE (09:15–15:30 IST) and MCX (09:00–23:30/23:55 IST). */
export type Segment = 'NSE' | 'MCX';

/** One candle as Kite returns it (time = open, epoch seconds). */
export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Open interest (derivatives), when the broker provides it. */
  oi?: number;
}
