/**
 * V2 catalog — the data-driven description of what the builder offers
 * (timeframes, candle types, operators, indicators, patterns, legs) and the
 * known products. The UI renders from it and the server validates against it.
 */
import type { CandleType, LegKind, Market, Operator, PatternId, ProductKind, SourceField, Timeframe } from './types';

// ---- Products -----------------------------------------------------------------------------

export interface KnownProduct {
  id: string;
  symbol: string;
  name: string;
  kind: ProductKind;
  market: Market;
  /** Kite tradingsymbol of the index (SPOT leg) for indices. */
  indexSymbol?: string;
  group: string;
}

/** Indices and commodities with fixed names; NSE stocks come from the synced instrument list. */
export function marketOfExchange(exchange: string): Market {
  return exchange === 'MCX' ? 'MCX' : 'NSE';
}

export const KNOWN_PRODUCTS: KnownProduct[] = [
  { id: 'NSE:NIFTY', symbol: 'NIFTY', name: 'Nifty 50', kind: 'INDEX', market: 'NSE', indexSymbol: 'NIFTY 50', group: 'NSE indices' },
  { id: 'NSE:BANKNIFTY', symbol: 'BANKNIFTY', name: 'Nifty Bank', kind: 'INDEX', market: 'NSE', indexSymbol: 'NIFTY BANK', group: 'NSE indices' },
  { id: 'NSE:FINNIFTY', symbol: 'FINNIFTY', name: 'Nifty Financial Services', kind: 'INDEX', market: 'NSE', indexSymbol: 'NIFTY FIN SERVICE', group: 'NSE indices' },
  { id: 'NSE:MIDCPNIFTY', symbol: 'MIDCPNIFTY', name: 'Nifty Midcap Select', kind: 'INDEX', market: 'NSE', indexSymbol: 'NIFTY MID SELECT', group: 'NSE indices' },
  { id: 'NSE:NIFTYNXT50', symbol: 'NIFTYNXT50', name: 'Nifty Next 50', kind: 'INDEX', market: 'NSE', indexSymbol: 'NIFTY NEXT 50', group: 'NSE indices' },
  { id: 'BSE:SENSEX', symbol: 'SENSEX', name: 'Sensex', kind: 'INDEX', market: 'NSE', indexSymbol: 'SENSEX', group: 'BSE indices' },
  { id: 'BSE:BANKEX', symbol: 'BANKEX', name: 'Bankex', kind: 'INDEX', market: 'NSE', indexSymbol: 'BANKEX', group: 'BSE indices' },
  ...(
    [
      ['GOLD', 'Gold', 'Bullion'],
      ['GOLDM', 'Gold Mini', 'Bullion'],
      ['GOLDPETAL', 'Gold Petal', 'Bullion'],
      ['SILVER', 'Silver', 'Bullion'],
      ['SILVERM', 'Silver Mini', 'Bullion'],
      ['CRUDEOIL', 'Crude Oil', 'Energy'],
      ['CRUDEOILM', 'Crude Oil Mini', 'Energy'],
      ['NATURALGAS', 'Natural Gas', 'Energy'],
      ['NATGASMINI', 'Natural Gas Mini', 'Energy'],
      ['COPPER', 'Copper', 'Base metals'],
      ['ALUMINIUM', 'Aluminium', 'Base metals'],
      ['ZINC', 'Zinc', 'Base metals'],
      ['NICKEL', 'Nickel', 'Base metals'],
    ] as const
  ).map(([symbol, name, group]) => ({ id: `MCX:${symbol}`, symbol, name, kind: 'COMMODITY' as const, market: 'MCX' as const, group: `MCX ${group.toLowerCase()}` })),
];

export const KNOWN_PRODUCT: Record<string, KnownProduct> = Object.fromEntries(KNOWN_PRODUCTS.map((p) => [p.id, p]));

export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = { INDEX: 'Index', STOCK: 'Stock', COMMODITY: 'Commodity' };

// ---- Legs ---------------------------------------------------------------------------------

export const LEG_IDS = ['A', 'B', 'C', 'D'] as const;
export const MAX_LEGS = 4;
export const MAX_STRIKE_OFFSET = 20;

export const LEG_KINDS: Array<{ kind: LegKind; label: string; name: string; description: string }> = [
  { kind: 'SPOT', label: 'SPOT', name: 'Spot / cash', description: 'The index value or the stock’s cash price. MCX commodities have no spot.' },
  { kind: 'FUT', label: 'FUT', name: 'Future', description: 'The future — with option legs, the future the options expire into.' },
  { kind: 'CE', label: 'CE', name: 'Call option', description: 'A call at a strike relative to ATM.' },
  { kind: 'PE', label: 'PE', name: 'Put option', description: 'A put at a strike relative to ATM.' },
];

export const EXPIRY_MODES: Array<{ mode: 'CURRENT' | 'NEXT' | 'FAR' | 'SPECIFIC'; label: string }> = [
  { mode: 'CURRENT', label: 'Current' },
  { mode: 'NEXT', label: 'Next' },
  { mode: 'FAR', label: 'Far' },
  { mode: 'SPECIFIC', label: 'Specific date' },
];

/** Which strike positions a connection scans (each is its own unit). */
export const STRIKE_SHIFT_PRESETS: Array<{ key: string; label: string; shifts: number[] }> = [
  { key: 'atm', label: 'Around ATM only', shifts: [0] },
  ...[1, 2, 3].map((n) => ({ key: `pm${n}`, label: `ATM and ± ${n} strike${n === 1 ? '' : 's'}`, shifts: Array.from({ length: 2 * n + 1 }, (_, i) => i - n) })),
];

// ---- Timeframes ---------------------------------------------------------------------

/** Kite historical intervals (the only ones the provider serves). */
export type NativeInterval = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '1d';

export interface TimeframeSpec {
  key: Timeframe;
  label: string;
  /** Candle length in minutes; 0 for day / week (session-defined). */
  minutes: number;
  /** Interval fetched from Kite. */
  native: NativeInterval;
  /** How many native candles make one candle (for sizing warm-up fetches). */
  factor: number;
  /** Built by aggregating native candles (2h, 4h from 1h; weekly from daily). */
  derived: boolean;
}

export const TIMEFRAMES: TimeframeSpec[] = [
  { key: '1m', label: '1 min', minutes: 1, native: '1m', factor: 1, derived: false },
  { key: '3m', label: '3 min', minutes: 3, native: '3m', factor: 1, derived: false },
  { key: '5m', label: '5 min', minutes: 5, native: '5m', factor: 1, derived: false },
  { key: '10m', label: '10 min', minutes: 10, native: '10m', factor: 1, derived: false },
  { key: '15m', label: '15 min', minutes: 15, native: '15m', factor: 1, derived: false },
  { key: '30m', label: '30 min', minutes: 30, native: '30m', factor: 1, derived: false },
  { key: '1h', label: '1 hour', minutes: 60, native: '1h', factor: 1, derived: false },
  { key: '2h', label: '2 hours', minutes: 120, native: '1h', factor: 2, derived: true },
  { key: '4h', label: '4 hours', minutes: 240, native: '1h', factor: 4, derived: true },
  { key: '1d', label: 'Daily', minutes: 0, native: '1d', factor: 1, derived: false },
  { key: '1w', label: 'Weekly', minutes: 0, native: '1d', factor: 5, derived: true },
];

export const TIMEFRAME: Record<Timeframe, TimeframeSpec> = Object.fromEntries(TIMEFRAMES.map((t) => [t.key, t])) as Record<
  Timeframe,
  TimeframeSpec
>;

/** Sort key: longer timeframes compare greater. */
export function timeframeRank(tf: Timeframe): number {
  if (tf === '1d') return 24 * 60;
  if (tf === '1w') return 7 * 24 * 60;
  return TIMEFRAME[tf].minutes;
}

// ---- Candles --------------------------------------------------------------------------

export const CANDLE_TYPES: Array<{ type: CandleType; label: string; short: string }> = [
  { type: 'NORMAL', label: 'Normal', short: 'Normal' },
  { type: 'HEIKIN_ASHI', label: 'Heikin Ashi', short: 'HA' },
  { type: 'VOLUME', label: 'Volume candles', short: 'Vol' },
];

// ---- Operators ------------------------------------------------------------------------

export const OPERATORS: Array<{ value: Operator; label: string; symbol: string; cross: boolean }> = [
  { value: 'GT', label: 'Greater than', symbol: '>', cross: false },
  { value: 'LT', label: 'Less than', symbol: '<', cross: false },
  { value: 'GTE', label: 'Greater than or equal', symbol: '≥', cross: false },
  { value: 'LTE', label: 'Less than or equal', symbol: '≤', cross: false },
  { value: 'EQ', label: 'Equals', symbol: '=', cross: false },
  { value: 'CROSSED_ABOVE', label: 'Crossed above', symbol: 'crossed above', cross: true },
  { value: 'CROSSED_BELOW', label: 'Crossed below', symbol: 'crossed below', cross: true },
];

// ---- Indicators -------------------------------------------------------------------------

/** What unit a value is in — comparing different units is rejected by validation. */
export type ValueUnit = 'price' | 'oscillator' | 'macd' | 'direction' | 'volume' | 'oi' | 'ratio' | 'percent';

export interface ParamSpec {
  name: string;
  label: string;
  default: number;
  min: number;
  max: number;
  integer: boolean;
}

export interface IndicatorSpec {
  id: string;
  label: string;
  params: ParamSpec[];
  /** Selectable input fields; absent = fixed (uses high/low/close). */
  sources?: SourceField[];
  outputs?: Array<{ value: string; label: string; unit?: ValueUnit }>;
  /** Unit when no output-specific unit applies (price-sourced indicators take the source's unit). */
  unit: ValueUnit | 'source';
  /** Minimum candles before the first value (for "insufficient data" messages). */
  requiredHistory: (p: Record<string, number>) => number;
  description: string;
}

const PERIOD = (def: number, max = 400): ParamSpec => ({ name: 'period', label: 'Period', default: def, min: 2, max, integer: true });
const SOURCES: SourceField[] = ['close', 'open', 'high', 'low', 'volume', 'oi'];

export const INDICATORS: IndicatorSpec[] = [
  {
    id: 'RSI',
    label: 'RSI',
    params: [PERIOD(14, 100)],
    sources: SOURCES,
    unit: 'oscillator',
    requiredHistory: (p) => (p.period ?? 14) + 1,
    description: 'Relative Strength Index (Wilder), 0–100.',
  },
  {
    id: 'SMA',
    label: 'SMA',
    params: [PERIOD(20)],
    sources: SOURCES,
    unit: 'source',
    requiredHistory: (p) => p.period ?? 20,
    description: 'Simple moving average of the source (e.g. SMA of volume).',
  },
  {
    id: 'EMA',
    label: 'EMA',
    params: [PERIOD(20)],
    sources: SOURCES,
    unit: 'source',
    requiredHistory: (p) => p.period ?? 20,
    description: 'Exponential moving average (SMA-seeded).',
  },
  {
    id: 'BB',
    label: 'Bollinger Bands',
    params: [PERIOD(20), { name: 'stdDev', label: 'Std dev', default: 2, min: 0.5, max: 5, integer: false }],
    sources: ['close', 'open', 'high', 'low'],
    outputs: [
      { value: 'upper', label: 'Upper' },
      { value: 'mid', label: 'Middle' },
      { value: 'lower', label: 'Lower' },
      { value: 'percentB', label: '%B', unit: 'ratio' },
      { value: 'bandwidth', label: 'Bandwidth %', unit: 'percent' },
    ],
    unit: 'source',
    requiredHistory: (p) => p.period ?? 20,
    description: 'Middle = SMA; bands = middle ± std dev × σ. %B = (close − lower)/(upper − lower); Bandwidth = (upper − lower)/middle × 100.',
  },
  {
    id: 'ADX',
    label: 'ADX',
    params: [PERIOD(14, 100), { name: 'smoothing', label: 'Smoothing', default: 14, min: 2, max: 100, integer: true }],
    unit: 'oscillator',
    requiredHistory: (p) => (p.period ?? 14) + (p.smoothing ?? 14),
    description: 'Average Directional Index (Wilder, TradingView-compatible): trend strength 0–100.',
  },
  {
    id: 'DMI',
    label: 'DMI',
    params: [PERIOD(14, 100)],
    outputs: [
      { value: 'plus', label: '+DI' },
      { value: 'minus', label: '−DI' },
    ],
    unit: 'oscillator',
    requiredHistory: (p) => (p.period ?? 14) + 1,
    description: 'Directional Movement: +DI (up pressure) and −DI (down pressure), 0–100.',
  },
  {
    id: 'MACD',
    label: 'MACD',
    params: [
      { name: 'fast', label: 'Fast', default: 12, min: 2, max: 200, integer: true },
      { name: 'slow', label: 'Slow', default: 26, min: 2, max: 400, integer: true },
      { name: 'signal', label: 'Signal', default: 9, min: 2, max: 100, integer: true },
    ],
    outputs: [
      { value: 'line', label: 'Line' },
      { value: 'signal', label: 'Signal' },
      { value: 'hist', label: 'Histogram' },
    ],
    unit: 'macd',
    requiredHistory: (p) => (p.slow ?? 26) + (p.signal ?? 9),
    description: 'MACD line = EMA(fast) − EMA(slow); signal = EMA of the line; histogram = line − signal.',
  },
  {
    id: 'SUPERTREND',
    label: 'Supertrend',
    params: [PERIOD(10, 100), { name: 'multiplier', label: 'Multiplier', default: 3, min: 0.5, max: 10, integer: false }],
    outputs: [
      { value: 'value', label: 'Line', unit: 'price' },
      { value: 'direction', label: 'Direction (+1/−1)', unit: 'direction' },
    ],
    unit: 'price',
    requiredHistory: (p) => (p.period ?? 10) + 1,
    description: 'ATR-based trailing line; direction +1 uptrend, −1 downtrend.',
  },
];

export const INDICATOR: Record<string, IndicatorSpec> = Object.fromEntries(INDICATORS.map((i) => [i.id, i]));

/** Unit of a source field. */
export function sourceUnit(field: SourceField): ValueUnit {
  return field === 'volume' ? 'volume' : field === 'oi' ? 'oi' : 'price';
}

// ---- Patterns ---------------------------------------------------------------------------

export const PATTERNS: Array<{ id: PatternId; label: string; group: 'Bullish' | 'Bearish' | 'Neutral' | 'Any'; legacyId: string }> = [
  { id: 'ANY_BULLISH', label: 'Any bullish pattern', group: 'Any', legacyId: 'anyBullish' },
  { id: 'ANY_BEARISH', label: 'Any bearish pattern', group: 'Any', legacyId: 'anyBearish' },
  { id: 'DOJI', label: 'Doji', group: 'Neutral', legacyId: 'doji' },
  { id: 'HAMMER', label: 'Hammer', group: 'Bullish', legacyId: 'hammer' },
  { id: 'INVERTED_HAMMER', label: 'Inverted Hammer', group: 'Bullish', legacyId: 'invertedHammer' },
  { id: 'BULLISH_ENGULFING', label: 'Bullish Engulfing', group: 'Bullish', legacyId: 'bullishEngulfing' },
  { id: 'BULLISH_HARAMI', label: 'Bullish Harami', group: 'Bullish', legacyId: 'bullishHarami' },
  { id: 'PIERCING', label: 'Piercing Pattern', group: 'Bullish', legacyId: 'piercingLine' },
  { id: 'MORNING_STAR', label: 'Morning Star', group: 'Bullish', legacyId: 'morningStar' },
  { id: 'THREE_WHITE_SOLDIERS', label: 'Three White Soldiers', group: 'Bullish', legacyId: 'threeWhiteSoldiers' },
  { id: 'BULLISH_MARUBOZU', label: 'Bullish Marubozu', group: 'Bullish', legacyId: 'bullishMarubozu' },
  { id: 'SHOOTING_STAR', label: 'Shooting Star', group: 'Bearish', legacyId: 'shootingStar' },
  { id: 'HANGING_MAN', label: 'Hanging Man', group: 'Bearish', legacyId: 'hangingMan' },
  { id: 'BEARISH_ENGULFING', label: 'Bearish Engulfing', group: 'Bearish', legacyId: 'bearishEngulfing' },
  { id: 'BEARISH_HARAMI', label: 'Bearish Harami', group: 'Bearish', legacyId: 'bearishHarami' },
  { id: 'DARK_CLOUD_COVER', label: 'Dark Cloud Cover', group: 'Bearish', legacyId: 'darkCloudCover' },
  { id: 'EVENING_STAR', label: 'Evening Star', group: 'Bearish', legacyId: 'eveningStar' },
  { id: 'THREE_BLACK_CROWS', label: 'Three Black Crows', group: 'Bearish', legacyId: 'threeBlackCrows' },
  { id: 'BEARISH_MARUBOZU', label: 'Bearish Marubozu', group: 'Bearish', legacyId: 'bearishMarubozu' },
];

export const PATTERN: Record<PatternId, (typeof PATTERNS)[number]> = Object.fromEntries(PATTERNS.map((p) => [p.id, p])) as Record<
  PatternId,
  (typeof PATTERNS)[number]
>;


/** Signals older than this after their candle closed are recorded but not alerted. */
export const MAX_ALERT_LAG_MS = 30 * 60_000;
