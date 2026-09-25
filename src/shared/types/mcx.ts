/**
 * MCX tab contracts: what the instrument master holds for each commodity
 * product (live contracts, option availability, strike ladder).
 */
import type { McxProductGroup } from '../constants';

export interface McxContract {
  tradingSymbol: string;
  expiry: string;
  lotSize?: number;
}

export interface McxProductInfo {
  symbol: string;
  name: string;
  group: McxProductGroup;
  /** Options exist and trade actively (registry flag). */
  optionsLiquid: boolean;
  /** Contracts for this product are in the synced master. */
  available: boolean;
  /** The master lists options (CE/PE) for this product. */
  hasOptions: boolean;
  /** Upcoming futures contracts, nearest first. */
  futures: McxContract[];
  /** Upcoming option expiries, nearest first. */
  optionExpiries: string[];
  /** Gap between listed strikes of the nearest option expiry. */
  strikeInterval?: number;
  /** Number of listed strikes for the nearest option expiry. */
  strikeCount?: number;
}
