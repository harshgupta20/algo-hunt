/**
 * Platform-wide constants: underlying registry, timeframe metadata, defaults.
 * Everything here is data-driven so new underlyings/timeframes are additions,
 * not code changes.
 */
import type { Exchange, Segment, Timeframe } from './types/market';

export type McxProductGroup = 'bullion' | 'energy' | 'base-metals';

export interface UnderlyingDef {
  symbol: string;
  name: string;
  kind: 'index' | 'stock' | 'commodity';
  /** Market the underlying trades in (session hours, expiry cycle, instrument sync). */
  segment: Segment;
  /** Exchange of the derivatives (options/futures) chain. */
  derivativeExchange: Exchange;
  /**
   * Distance between adjacent option strikes. Omitted for MCX products: their
   * interval is read from the listed strikes in the Kite instrument master.
   */
  strikeInterval?: number;
  /** MCX: product family, used to group the product picker. */
  group?: McxProductGroup;
  /** MCX: options exist AND trade actively (Gold, Silver, Crude, Copper, Zinc, Natural Gas). */
  optionsLiquid?: boolean;
}

/** NSE/BSE index underlyings. Stock futures can be appended freely. */
export const UNDERLYINGS: UnderlyingDef[] = [
  { symbol: 'NIFTY', name: 'Nifty 50', kind: 'index', segment: 'NSE', derivativeExchange: 'NFO', strikeInterval: 50 },
  { symbol: 'BANKNIFTY', name: 'Nifty Bank', kind: 'index', segment: 'NSE', derivativeExchange: 'NFO', strikeInterval: 100 },
  { symbol: 'FINNIFTY', name: 'Nifty Financial', kind: 'index', segment: 'NSE', derivativeExchange: 'NFO', strikeInterval: 50 },
  { symbol: 'SENSEX', name: 'BSE Sensex', kind: 'index', segment: 'NSE', derivativeExchange: 'BFO', strikeInterval: 100 },
  { symbol: 'BANKEX', name: 'BSE Bankex', kind: 'index', segment: 'NSE', derivativeExchange: 'BFO', strikeInterval: 100 },
];

/**
 * MCX commodity products. `symbol` is the Kite instrument-master `name`
 * (e.g. GOLD25DECFUT → GOLD). Futures cover every listed monthly contract;
 * options are used wherever MCX lists them.
 */
export const MCX_PRODUCTS: UnderlyingDef[] = [
  { symbol: 'GOLD', name: 'Gold', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'bullion', optionsLiquid: true },
  { symbol: 'GOLDM', name: 'Gold Mini', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'bullion' },
  { symbol: 'GOLDPETAL', name: 'Gold Petal', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'bullion' },
  { symbol: 'SILVER', name: 'Silver', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'bullion', optionsLiquid: true },
  { symbol: 'SILVERM', name: 'Silver Mini', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'bullion' },
  { symbol: 'CRUDEOIL', name: 'Crude Oil', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'energy', optionsLiquid: true },
  { symbol: 'CRUDEOILM', name: 'Crude Oil Mini', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'energy' },
  { symbol: 'NATURALGAS', name: 'Natural Gas', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'energy', optionsLiquid: true },
  { symbol: 'NATGASMINI', name: 'Natural Gas Mini', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'energy' },
  { symbol: 'COPPER', name: 'Copper', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'base-metals', optionsLiquid: true },
  { symbol: 'ALUMINIUM', name: 'Aluminium', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'base-metals' },
  { symbol: 'ZINC', name: 'Zinc', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'base-metals', optionsLiquid: true },
  { symbol: 'NICKEL', name: 'Nickel', kind: 'commodity', segment: 'MCX', derivativeExchange: 'MCX', group: 'base-metals' },
];

export const MCX_GROUP_LABEL: Record<McxProductGroup, string> = {
  bullion: 'Bullion',
  energy: 'Energy',
  'base-metals': 'Base metals',
};

/** Every underlying the platform knows, across segments. */
export const ALL_UNDERLYINGS: UnderlyingDef[] = [...UNDERLYINGS, ...MCX_PRODUCTS];

export const UNDERLYING_BY_SYMBOL: Record<string, UnderlyingDef> = Object.fromEntries(
  ALL_UNDERLYINGS.map((u) => [u.symbol, u]),
);

/** Segment of an underlying symbol. Unknown symbols are treated as NSE (the original market). */
export function segmentOf(symbol: string): Segment {
  return UNDERLYING_BY_SYMBOL[symbol]?.segment ?? 'NSE';
}

export function isMcx(symbol: string): boolean {
  return segmentOf(symbol) === 'MCX';
}

export function underlyingsOf(segment: Segment): UnderlyingDef[] {
  return segment === 'MCX' ? MCX_PRODUCTS : UNDERLYINGS;
}

export interface TimeframeDef {
  key: Timeframe;
  label: string;
  ms: number;
  /** False for Daily / Weekly: those candles span a whole session or week. */
  intraday: boolean;
}

export const TIMEFRAMES: TimeframeDef[] = [
  { key: '1m', label: '1 Minute', ms: 1 * 60_000, intraday: true },
  { key: '3m', label: '3 Minutes', ms: 3 * 60_000, intraday: true },
  { key: '5m', label: '5 Minutes', ms: 5 * 60_000, intraday: true },
  { key: '10m', label: '10 Minutes', ms: 10 * 60_000, intraday: true },
  { key: '15m', label: '15 Minutes', ms: 15 * 60_000, intraday: true },
  { key: '30m', label: '30 Minutes', ms: 30 * 60_000, intraday: true },
  { key: '1h', label: '1 Hour', ms: 60 * 60_000, intraday: true },
  { key: '1d', label: 'Daily', ms: 24 * 60 * 60_000, intraday: false },
  { key: '1w', label: 'Weekly', ms: 7 * 24 * 60 * 60_000, intraday: false },
];

export const TIMEFRAME_MS: Record<Timeframe, number> = Object.fromEntries(
  TIMEFRAMES.map((t) => [t.key, t.ms]),
) as Record<Timeframe, number>;

export const TIMEFRAME_LABEL: Record<Timeframe, string> = Object.fromEntries(
  TIMEFRAMES.map((t) => [t.key, t.label]),
) as Record<Timeframe, string>;

/** Compact timeframe name for rule text: "Daily", "Weekly", otherwise the key ("15m"). */
export function timeframeShort(tf: Timeframe): string {
  return tf === '1d' ? 'Daily' : tf === '1w' ? 'Weekly' : tf;
}

export const DEFAULT_TIMEFRAME: Timeframe = '15m';

export const DEFAULT_RSI_PERIOD = 14;

/** Display name of the built-in `rsi-sync` strategy (server definition + UI labels). */
export const BUILTIN_STRATEGY_NAME = 'RSI Multi Confirmation';
