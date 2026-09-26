/**
 * MCX V2 catalog — the single, data-driven description of what the builder
 * offers (timeframes, candle types, operators, indicators, patterns, products).
 * The UI renders from it and the server validates against it.
 */
import type { CandleType, Leg, McxOperator, McxTimeframe, PatternId, SourceField, StrikeMode } from './types';

// ---- Products ---------------------------------------------------------------------

export type McxProductGroup = 'bullion' | 'energy' | 'base-metals';

export interface McxProduct {
  /** Kite instrument-master `name`. */
  symbol: string;
  name: string;
  group: McxProductGroup;
  /** Options listed AND actively traded. */
  optionsLiquid: boolean;
}

export const MCX2_PRODUCTS: McxProduct[] = [
  { symbol: 'GOLD', name: 'Gold', group: 'bullion', optionsLiquid: true },
  { symbol: 'GOLDM', name: 'Gold Mini', group: 'bullion', optionsLiquid: false },
  { symbol: 'GOLDPETAL', name: 'Gold Petal', group: 'bullion', optionsLiquid: false },
  { symbol: 'SILVER', name: 'Silver', group: 'bullion', optionsLiquid: true },
  { symbol: 'SILVERM', name: 'Silver Mini', group: 'bullion', optionsLiquid: false },
  { symbol: 'CRUDEOIL', name: 'Crude Oil', group: 'energy', optionsLiquid: true },
  { symbol: 'CRUDEOILM', name: 'Crude Oil Mini', group: 'energy', optionsLiquid: false },
  { symbol: 'NATURALGAS', name: 'Natural Gas', group: 'energy', optionsLiquid: true },
  { symbol: 'NATGASMINI', name: 'Natural Gas Mini', group: 'energy', optionsLiquid: false },
  { symbol: 'COPPER', name: 'Copper', group: 'base-metals', optionsLiquid: true },
  { symbol: 'ALUMINIUM', name: 'Aluminium', group: 'base-metals', optionsLiquid: false },
  { symbol: 'ZINC', name: 'Zinc', group: 'base-metals', optionsLiquid: true },
  { symbol: 'NICKEL', name: 'Nickel', group: 'base-metals', optionsLiquid: false },
];

export const MCX2_PRODUCT_BY_SYMBOL: Record<string, McxProduct> = Object.fromEntries(MCX2_PRODUCTS.map((p) => [p.symbol, p]));

export const MCX2_GROUP_LABEL: Record<McxProductGroup, string> = { bullion: 'Bullion', energy: 'Energy', 'base-metals': 'Base metals' };

// ---- Timeframes ---------------------------------------------------------------------

/** Kite historical intervals (the only ones the provider serves). */
export type NativeInterval = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '1d';

export interface TimeframeSpec {
  key: McxTimeframe;
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

export const MCX2_TIMEFRAMES: TimeframeSpec[] = [
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

export const MCX2_TIMEFRAME: Record<McxTimeframe, TimeframeSpec> = Object.fromEntries(MCX2_TIMEFRAMES.map((t) => [t.key, t])) as Record<
  McxTimeframe,
  TimeframeSpec
>;

/** Sort key: longer timeframes compare greater. */
export function timeframeRank(tf: McxTimeframe): number {
  if (tf === '1d') return 24 * 60;
  if (tf === '1w') return 7 * 24 * 60;
  return MCX2_TIMEFRAME[tf].minutes;
}

// ---- Candles --------------------------------------------------------------------------

export const MCX2_CANDLE_TYPES: Array<{ type: CandleType; label: string; short: string }> = [
  { type: 'NORMAL', label: 'Normal', short: 'Normal' },
  { type: 'HEIKIN_ASHI', label: 'Heikin Ashi', short: 'HA' },
  { type: 'VOLUME', label: 'Volume candles', short: 'Vol' },
];

// ---- Operators ------------------------------------------------------------------------

export const MCX2_OPERATORS: Array<{ value: McxOperator; label: string; symbol: string; cross: boolean }> = [
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

export interface McxParamSpec {
  name: string;
  label: string;
  default: number;
  min: number;
  max: number;
  integer: boolean;
}

export interface McxIndicatorSpec {
  id: string;
  label: string;
  params: McxParamSpec[];
  /** Selectable input fields; absent = fixed (uses high/low/close). */
  sources?: SourceField[];
  outputs?: Array<{ value: string; label: string; unit?: ValueUnit }>;
  /** Unit when no output-specific unit applies (price-sourced indicators take the source's unit). */
  unit: ValueUnit | 'source';
  /** Minimum candles before the first value (for "insufficient data" messages). */
  requiredHistory: (p: Record<string, number>) => number;
  description: string;
}

const PERIOD = (def: number, max = 400): McxParamSpec => ({ name: 'period', label: 'Period', default: def, min: 2, max, integer: true });
const SOURCES: SourceField[] = ['close', 'open', 'high', 'low', 'volume', 'oi'];

export const MCX2_INDICATORS: McxIndicatorSpec[] = [
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

export const MCX2_INDICATOR: Record<string, McxIndicatorSpec> = Object.fromEntries(MCX2_INDICATORS.map((i) => [i.id, i]));

/** Unit of a source field. */
export function sourceUnit(field: SourceField): ValueUnit {
  return field === 'volume' ? 'volume' : field === 'oi' ? 'oi' : 'price';
}

// ---- Patterns ---------------------------------------------------------------------------

export const MCX2_PATTERNS: Array<{ id: PatternId; label: string; group: 'Bullish' | 'Bearish' | 'Neutral' | 'Any'; legacyId: string }> = [
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

export const MCX2_PATTERN: Record<PatternId, (typeof MCX2_PATTERNS)[number]> = Object.fromEntries(MCX2_PATTERNS.map((p) => [p.id, p])) as Record<
  PatternId,
  (typeof MCX2_PATTERNS)[number]
>;

// ---- Universe choices ------------------------------------------------------------------------

export const MCX2_EXPIRY_MODES: Array<{ mode: 'CURRENT' | 'NEXT' | 'FAR' | 'ALL' | 'SPECIFIC'; label: string }> = [
  { mode: 'CURRENT', label: 'Current' },
  { mode: 'NEXT', label: 'Next' },
  { mode: 'FAR', label: 'Far' },
  { mode: 'ALL', label: 'All available' },
  { mode: 'SPECIFIC', label: 'Specific date' },
];

export const MCX2_STRIKE_MODES: Array<{ mode: StrikeMode; label: string }> = [
  { mode: 'ATM_OFFSETS', label: 'Around ATM' },
  { mode: 'SPECIFIC', label: 'Specific strikes' },
  { mode: 'RANGE', label: 'Strike range' },
  { mode: 'ALL', label: 'All strikes' },
];

/** Quick picks for ATM-relative strikes (offsets along the listed strike ladder). */
export const MCX2_ATM_PRESETS: Array<{ key: string; label: string; offsets: number[] }> = [
  { key: 'atm', label: 'ATM', offsets: [0] },
  ...[1, 2, 3, 4, 5].map((n) => ({ key: `pm${n}`, label: `ATM ± ${n}`, offsets: Array.from({ length: 2 * n + 1 }, (_, i) => i - n) })),
  ...[1, 2, 3].map((n) => ({ key: `up${n}`, label: `${n} above ATM`, offsets: Array.from({ length: n }, (_, i) => i + 1) })),
  ...[1, 2, 3].map((n) => ({ key: `dn${n}`, label: `${n} below ATM`, offsets: Array.from({ length: n }, (_, i) => -(i + 1)) })),
];

// ---- Legs ----------------------------------------------------------------------------------

export const MCX2_LEGS: Array<{ leg: Leg; label: string; name: string }> = [
  { leg: 'FUT', label: 'FUT', name: 'Future' },
  { leg: 'CE', label: 'CE', name: 'Call' },
  { leg: 'PE', label: 'PE', name: 'Put' },
];

/** Signals older than this after their candle closed are recorded but not alerted. */
export const MCX2_MAX_ALERT_LAG_MS = 30 * 60_000;
