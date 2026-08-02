/**
 * Platform-wide constants: underlying registry, timeframe metadata, defaults.
 * Everything here is data-driven so new underlyings/timeframes are additions,
 * not code changes.
 */
import type { Exchange, Timeframe } from './types/market.js';

export interface UnderlyingDef {
  symbol: string;
  name: string;
  kind: 'index' | 'stock';
  /** Exchange of the derivatives (options/futures) chain. */
  derivativeExchange: Exchange;
  /** Distance between adjacent option strikes. */
  strikeInterval: number;
}

/** Initial supported underlyings. Stock futures can be appended freely. */
export const UNDERLYINGS: UnderlyingDef[] = [
  { symbol: 'NIFTY', name: 'Nifty 50', kind: 'index', derivativeExchange: 'NFO', strikeInterval: 50 },
  { symbol: 'BANKNIFTY', name: 'Nifty Bank', kind: 'index', derivativeExchange: 'NFO', strikeInterval: 100 },
  { symbol: 'FINNIFTY', name: 'Nifty Financial', kind: 'index', derivativeExchange: 'NFO', strikeInterval: 50 },
  { symbol: 'SENSEX', name: 'BSE Sensex', kind: 'index', derivativeExchange: 'BFO', strikeInterval: 100 },
  { symbol: 'BANKEX', name: 'BSE Bankex', kind: 'index', derivativeExchange: 'BFO', strikeInterval: 100 },
];

export const UNDERLYING_BY_SYMBOL: Record<string, UnderlyingDef> = Object.fromEntries(
  UNDERLYINGS.map((u) => [u.symbol, u]),
);

export interface TimeframeDef {
  key: Timeframe;
  label: string;
  ms: number;
}

export const TIMEFRAMES: TimeframeDef[] = [
  { key: '1m', label: '1 Minute', ms: 1 * 60_000 },
  { key: '3m', label: '3 Minutes', ms: 3 * 60_000 },
  { key: '5m', label: '5 Minutes', ms: 5 * 60_000 },
  { key: '10m', label: '10 Minutes', ms: 10 * 60_000 },
  { key: '15m', label: '15 Minutes', ms: 15 * 60_000 },
  { key: '30m', label: '30 Minutes', ms: 30 * 60_000 },
  { key: '1h', label: '1 Hour', ms: 60 * 60_000 },
];

export const TIMEFRAME_MS: Record<Timeframe, number> = Object.fromEntries(
  TIMEFRAMES.map((t) => [t.key, t.ms]),
) as Record<Timeframe, number>;

export const DEFAULT_TIMEFRAME: Timeframe = '15m';

export const DEFAULT_RSI_PERIOD = 14;
