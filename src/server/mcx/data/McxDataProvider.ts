/**
 * Market-data boundary for MCX V2. The scanner, universe resolver and replay
 * depend only on this interface; Kite implements it in production and tests
 * inject fixed candles. Swapping vendors = another implementation.
 */
import type { McxInstrument, NativeInterval } from '@/shared/mcx';
import type { RawCandle } from '../engine/candles';

export interface CandleQuery {
  instrument: McxInstrument;
  interval: NativeInterval;
  /** Inclusive IST dates, yyyy-mm-dd. */
  from: string;
  to: string;
}

export interface McxQuote {
  ltp: number;
  volume?: number;
  oi?: number;
  change?: number;
}

export interface McxDataProvider {
  readonly name: string;
  /** Whether the vendor session is usable right now. */
  isConnected(): Promise<boolean>;
  /** The MCX instrument master (futures + options of the supported products). */
  getInstruments(): Promise<McxInstrument[]>;
  /** Candles ascending by open time; the last one may still be forming during market hours. */
  getHistoricalCandles(q: CandleQuery): Promise<RawCandle[]>;
  /** Last traded prices keyed by instrument token (batched by the implementation). */
  getLtp(instruments: McxInstrument[]): Promise<Map<number, number>>;
  /** Quote snapshot (LTP, volume, OI) keyed by token. */
  getQuotes(instruments: McxInstrument[]): Promise<Map<number, McxQuote>>;
}
