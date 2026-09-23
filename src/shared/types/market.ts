/**
 * Core market-data domain types shared between server and client.
 */

/** Supported candle timeframes (intraday; 4h/daily reserved for future). */
export type Timeframe = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h';

/** Exchange segments we care about. */
export type Exchange = 'NSE' | 'NFO' | 'BSE' | 'BFO';

/** Instrument kinds within an underlying's derivative chain. */
export type InstrumentType = 'FUT' | 'CE' | 'PE';

/** Which leg of the strategy triplet an instrument represents. */
export type Leg = 'future' | 'call' | 'put';

/**
 * A normalized instrument as resolved from the broker's instrument master.
 * `token` is the broker instrument token used for WebSocket subscription.
 */
export interface Instrument {
  token: number;
  tradingSymbol: string;
  underlying: string;
  exchange: Exchange;
  instrumentType: InstrumentType;
  /** Strike price for options; 0 for futures. */
  strike: number;
  /** ISO date (yyyy-mm-dd) of expiry. */
  expiry: string;
  /** Contract lot size, when known. */
  lotSize?: number;
  /** Minimum price movement, when known. */
  tickSize?: number;
}

/**
 * The three instruments a single strategy config watches, resolved for a
 * given underlying / expiry / strike selection.
 */
export interface InstrumentTriplet {
  future: Instrument;
  call: Instrument;
  put: Instrument;
  /** The ATM (or selected) strike the call/put were resolved at. */
  strike: number;
}

/** A single market tick (last-traded price at a point in time). */
export interface Tick {
  token: number;
  /** Last traded price. */
  ltp: number;
  /** Epoch milliseconds. */
  timestamp: number;
}

/** An OHLC candle for one instrument on one timeframe. */
export interface Candle {
  token: number;
  timeframe: Timeframe;
  /** Epoch milliseconds of the candle's opening boundary (its bucket id). */
  bucket: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** True once the candle is finalized (a later bucket has begun). */
  closed: boolean;
}
