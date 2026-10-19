/**
 * Equity catalog: indicators (parameters, outputs, units), operators, timeframes and stock-list presets.
 * The maths matches TradingView (Wilder RSI / ATR / ADX, EMA seeded with an SMA) — see server/equity/engine.
 */
import type { EqIndicatorId, EqMaType, EqOperator, EqPreset, EqTimeframe, EqUnit, PriceField } from './types';

export interface EqParamSpec {
  name: string;
  label: string;
  default: number;
  min: number;
  max: number;
  integer: boolean;
}

export interface EqIndicatorSpec {
  id: EqIndicatorId;
  label: string;
  /** Short form used in plain-language text, e.g. "SMA". */
  short: string;
  params: EqParamSpec[];
  /** Selectable input series; omitted = fixed (computed from the whole candle). */
  sources?: PriceField[];
  defaultSource?: PriceField;
  outputs?: Array<{ value: string; label: string; unit?: EqUnit }>;
  /** Unit of the value ('source' = same as the input: price for close, volume for volume). */
  unit: EqUnit | 'source';
  /** Can take a moving average of its own values (RSI-based MA). */
  smoothable: boolean;
  description: string;
}

const PERIOD = (def: number, max = 500): EqParamSpec => ({ name: 'period', label: 'Period', default: def, min: 1, max, integer: true });
const PRICE_SOURCES: PriceField[] = ['close', 'open', 'high', 'low', 'volume'];

export const EQ_INDICATORS: EqIndicatorSpec[] = [
  { id: 'SMA', label: 'SMA — simple moving average', short: 'SMA', params: [PERIOD(20)], sources: PRICE_SOURCES, defaultSource: 'close', unit: 'source', smoothable: false, description: 'Average of the last N values (TradingView ta.sma).' },
  { id: 'EMA', label: 'EMA — exponential moving average', short: 'EMA', params: [PERIOD(20)], sources: PRICE_SOURCES, defaultSource: 'close', unit: 'source', smoothable: false, description: 'Weights recent values more; seeded with an SMA of the first N (TradingView ta.ema).' },
  { id: 'WMA', label: 'WMA — weighted moving average', short: 'WMA', params: [PERIOD(20)], sources: PRICE_SOURCES, defaultSource: 'close', unit: 'source', smoothable: false, description: 'Linearly weighted: the newest value counts N times, the oldest once (TradingView ta.wma).' },
  { id: 'RSI', label: 'RSI — relative strength index', short: 'RSI', params: [PERIOD(14, 200)], sources: ['close', 'open', 'high', 'low'], defaultSource: 'close', unit: 'oscillator', smoothable: true, description: 'Wilder’s RSI, 0–100. Add a moving average of it for TradingView’s “RSI-based MA”.' },
  {
    id: 'MACD',
    label: 'MACD',
    short: 'MACD',
    params: [
      { name: 'fast', label: 'Fast', default: 12, min: 2, max: 200, integer: true },
      { name: 'slow', label: 'Slow', default: 26, min: 2, max: 400, integer: true },
      { name: 'signal', label: 'Signal', default: 9, min: 2, max: 100, integer: true },
    ],
    sources: ['close'],
    defaultSource: 'close',
    outputs: [
      { value: 'line', label: 'MACD line' },
      { value: 'signal', label: 'Signal line' },
      { value: 'hist', label: 'Histogram' },
    ],
    unit: 'macd',
    smoothable: false,
    description: 'EMA(fast) − EMA(slow); the signal line is an EMA of it.',
  },
  {
    id: 'BB',
    label: 'Bollinger Bands',
    short: 'BB',
    params: [PERIOD(20), { name: 'stdDev', label: 'Std dev', default: 2, min: 0.5, max: 5, integer: false }],
    sources: ['close'],
    defaultSource: 'close',
    outputs: [
      { value: 'upper', label: 'Upper band' },
      { value: 'mid', label: 'Middle band' },
      { value: 'lower', label: 'Lower band' },
      { value: 'percentB', label: '%B', unit: 'ratio' },
      { value: 'bandwidth', label: 'Bandwidth %', unit: 'percent' },
    ],
    unit: 'price',
    smoothable: false,
    description: 'SMA ± std-dev × population standard deviation.',
  },
  { id: 'ATR', label: 'ATR — average true range', short: 'ATR', params: [PERIOD(14, 200)], unit: 'range', smoothable: true, description: 'Wilder’s average of the true range — how much the stock moves per candle, in ₹.' },
  {
    id: 'SUPERTREND',
    label: 'Supertrend',
    short: 'Supertrend',
    params: [PERIOD(10, 100), { name: 'multiplier', label: 'Multiplier', default: 3, min: 0.5, max: 10, integer: false }],
    outputs: [
      { value: 'value', label: 'Line', unit: 'price' },
      { value: 'direction', label: 'Direction (+1 up / −1 down)', unit: 'direction' },
    ],
    unit: 'price',
    smoothable: false,
    description: 'ATR-based trailing line; direction flips when the close crosses it.',
  },
  { id: 'ADX', label: 'ADX — trend strength', short: 'ADX', params: [PERIOD(14, 100), { name: 'smoothing', label: 'Smoothing', default: 14, min: 2, max: 100, integer: true }], unit: 'oscillator', smoothable: true, description: 'Wilder’s ADX, 0–100: above ~25 = a strong trend (either way).' },
  {
    id: 'DMI',
    label: 'DMI — +DI / −DI',
    short: 'DMI',
    params: [PERIOD(14, 100)],
    outputs: [
      { value: 'plus', label: '+DI' },
      { value: 'minus', label: '−DI' },
    ],
    unit: 'oscillator',
    smoothable: false,
    description: 'Directional movement: +DI above −DI = buyers in control.',
  },
  { id: 'HIGHEST', label: 'Highest of previous N candles', short: 'Highest', params: [PERIOD(20, 1000)], sources: ['high', 'close', 'low', 'open', 'volume'], defaultSource: 'high', unit: 'source', smoothable: false, description: 'Highest value of the previous N candles, not counting the current one — “close crosses above Highest high (252)” = a 52-week breakout.' },
  { id: 'LOWEST', label: 'Lowest of previous N candles', short: 'Lowest', params: [PERIOD(20, 1000)], sources: ['low', 'close', 'high', 'open', 'volume'], defaultSource: 'low', unit: 'source', smoothable: false, description: 'Lowest value of the previous N candles, not counting the current one.' },
  { id: 'ROC', label: 'ROC — % change over N candles', short: 'ROC', params: [PERIOD(10, 1000)], sources: ['close', 'volume'], defaultSource: 'close', unit: 'percent', smoothable: true, description: '100 × (value − value N candles ago) ÷ value N candles ago.' },
];

export const EQ_INDICATOR: Record<EqIndicatorId, EqIndicatorSpec> = Object.fromEntries(EQ_INDICATORS.map((i) => [i.id, i])) as Record<EqIndicatorId, EqIndicatorSpec>;

export const EQ_MA_TYPES: Array<{ value: EqMaType; label: string }> = [
  { value: 'SMA', label: 'SMA' },
  { value: 'EMA', label: 'EMA' },
  { value: 'WMA', label: 'WMA' },
];

export const EQ_OPERATORS: Array<{ value: EqOperator; label: string; symbol: string; cross: boolean }> = [
  { value: 'CROSSES_ABOVE', label: 'Crosses above', symbol: 'crosses above', cross: true },
  { value: 'CROSSES_BELOW', label: 'Crosses below', symbol: 'crosses below', cross: true },
  { value: 'GT', label: 'Greater than', symbol: '>', cross: false },
  { value: 'GTE', label: 'Greater or equal', symbol: '≥', cross: false },
  { value: 'LT', label: 'Less than', symbol: '<', cross: false },
  { value: 'LTE', label: 'Less or equal', symbol: '≤', cross: false },
];

export const EQ_OPERATOR: Record<EqOperator, (typeof EQ_OPERATORS)[number]> = Object.fromEntries(EQ_OPERATORS.map((o) => [o.value, o])) as Record<EqOperator, (typeof EQ_OPERATORS)[number]>;

export const EQ_TIMEFRAMES: Array<{ value: EqTimeframe; label: string; short: string }> = [
  { value: '1d', label: 'Daily', short: 'D' },
  { value: '1w', label: 'Weekly', short: 'W' },
];

export const EQ_TIMEFRAME: Record<EqTimeframe, (typeof EQ_TIMEFRAMES)[number]> = { '1d': EQ_TIMEFRAMES[0]!, '1w': EQ_TIMEFRAMES[1]! };

export const PRICE_FIELDS: Array<{ value: PriceField; label: string }> = [
  { value: 'close', label: 'Close' },
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'volume', label: 'Volume' },
];

export const EQ_PRESETS: Array<{ value: EqPreset; label: string }> = [
  { value: 'NIFTY50', label: 'NIFTY 50' },
  { value: 'NIFTYNEXT50', label: 'NIFTY Next 50' },
  { value: 'NIFTY100', label: 'NIFTY 100' },
  { value: 'MIDCAP150', label: 'NIFTY Midcap 150' },
  { value: 'SMALLCAP250', label: 'NIFTY Smallcap 250' },
  { value: 'NIFTY500', label: 'NIFTY 500' },
  { value: 'FNO', label: 'F&O stocks' },
  { value: 'ALL', label: 'All NSE stocks' },
];

/** Bounds the builder and the API accept. */
export const EQ_LIMITS = {
  maxConditions: 30,
  maxDepth: 4,
  maxBarsAgo: 500,
  maxPct: 1000,
  maxSlippagePct: 5,
  maxHoldingBars: 5000,
  maxAdds: 100,
} as const;

/** Starting money in the backtest form. */
export const EQ_DEFAULT_CAPITAL = 500_000;
