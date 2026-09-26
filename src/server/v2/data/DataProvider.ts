/**
 * Market-data boundary for V2. Everything else depends on this interface;
 * Kite implements it in production and tests inject fixed data.
 */
import type { NativeInterval, V2Instrument } from '@/shared/v2';
import type { RawCandle } from '../engine/candles';

export type { NativeInterval };

export interface CandleQuery {
  instrument: V2Instrument;
  interval: NativeInterval;
  /** Inclusive IST dates, yyyy-mm-dd. */
  from: string;
  to: string;
}

export interface Quote {
  ltp: number;
  volume?: number;
  oi?: number;
  change?: number;
}

export interface InstrumentDump {
  instruments: V2Instrument[];
  /** Display names of stocks (Kite `name` of the NSE cash row), keyed by symbol. */
  stockNames: Record<string, string>;
}

export interface V2DataProvider {
  readonly name: string;
  isConnected(): Promise<boolean>;
  /** Every supported instrument: NSE/BSE indices, NSE stocks (cash), NFO/BFO and MCX futures + options. */
  getInstruments(): Promise<InstrumentDump>;
  getHistoricalCandles(q: CandleQuery): Promise<RawCandle[]>;
  getLtp(instruments: V2Instrument[]): Promise<Map<number, number>>;
  getQuotes(instruments: V2Instrument[]): Promise<Map<number, Quote>>;
}
