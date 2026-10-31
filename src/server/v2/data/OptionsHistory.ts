/**
 * Market-data boundary of the Options backtest: past option / futures contracts as they were listed (lot
 * sizes of the day, every strike, expired contracts included) and their candles. Upstox implements it in the
 * app (upstox/UpstoxHistory.ts); tests inject fixed data.
 */
import type { V2Instrument, V2Product } from '@/shared/v2';
import type { RawCandle } from '../engine/candles';
import type { NativeInterval } from './DataProvider';

export interface ContractList {
  /** The index / stock itself (ATM is measured from its price). */
  spot: V2Instrument;
  /** Options / futures (as asked) with an expiry on or after `from`: through `to` and the next three after it. */
  contracts: V2Instrument[];
  /**
   * The first IST date whose expiry schedule is complete — the expiry on it and every later one are known (the
   * history starts with an expiry whose predecessor isn't, so the days up to that first expiry can't be told
   * apart from days whose nearer expiry was dropped). null = no contracts at all.
   */
  coveredFrom: string | null;
  /** Days whose expiry schedule may have a hole (an expiry may be missing), inclusive IST dates — not tested. */
  gaps: Array<{ from: string; to: string }>;
  notes: string[];
}

/** Candle requests made / answered from memory (a job's counters). */
export interface HistoryStats {
  fetched: number;
  cached: number;
}

export interface OptionsHistory {
  /** Shown in results ("Upstox"). */
  readonly name: string;
  /** `options` / `futures`: which contracts the strategy reads (neither = just the spot, no contract lists asked). */
  contracts(product: V2Product, range: { from: string; to: string }, opts: { options: boolean; futures: boolean }, stats?: HistoryStats): Promise<ContractList>;
  /** Candles of one contract (or the spot), oldest first, inclusive IST dates — clamped to its expiry and the last complete day. */
  candles(instrument: V2Instrument, interval: NativeInterval, from: string, to: string, stats?: HistoryStats): Promise<RawCandle[]>;
}
