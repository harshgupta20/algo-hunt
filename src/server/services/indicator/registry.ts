/**
 * Indicator factory + catalog. The catalog is served to the builder UI so the
 * available indicators/params/fields are data-driven (no UI change to add one).
 */
import type { IndicatorRef, IndicatorSpec } from '@ash/shared';
import { INDICATOR_CLASSES } from './library';
import type { Indicator } from './types';

export function createIndicator(ref: IndicatorRef): Indicator {
  const Cls = INDICATOR_CLASSES[ref.kind];
  if (!Cls) throw new Error(`Unknown indicator kind: ${ref.kind}`);
  return new Cls(ref);
}

/** Stable signature so identical indicator refs share one instance per instrument. */
export function indicatorSignature(ref: IndicatorRef): string {
  const params = ref.params
    ? Object.keys(ref.params)
        .sort()
        .map((k) => `${k}=${ref.params![k]}`)
        .join(',')
    : '';
  return `${ref.kind}|${params}|${ref.field ?? ''}`;
}

/** Short human label for an indicator ref, e.g. "RSI(14)" or "MACD hist". */
export function indicatorLabel(ref: IndicatorRef): string {
  const p = ref.params ? Object.values(ref.params).join(',') : '';
  const base = p ? `${ref.kind}(${p})` : ref.kind;
  return ref.field ? `${base} ${ref.field}` : base;
}

export const INDICATOR_SPECS: IndicatorSpec[] = [
  {
    kind: 'RSI',
    label: 'RSI',
    numeric: true,
    description: 'Relative Strength Index (0–100): momentum of recent closes (Wilder smoothing, same as Kite charts). ≥ 60 = bullish strength, ≤ 40 = bearish weakness.',
    example: 'Call RSI(14) cross above 60',
    params: [{ name: 'period', label: 'Period', default: 14, min: 2, max: 100, help: 'Candles in the RSI average. 14 is standard; smaller reacts faster but is noisier.' }],
  },
  {
    kind: 'EMA',
    label: 'EMA',
    numeric: true,
    description: 'Exponential moving average of closes. Weights recent candles more, so it turns faster than an SMA.',
    example: 'Future Close cross above Future EMA(20)',
    params: [{ name: 'period', label: 'Period', default: 20, min: 2, max: 400, help: 'Number of candles averaged. Common: 9, 20, 50, 200.' }],
  },
  {
    kind: 'SMA',
    label: 'SMA',
    numeric: true,
    description: 'Simple average of the last N closes. Smoother and slower than an EMA.',
    example: 'Future EMA(20) cross above Future SMA(50)',
    params: [{ name: 'period', label: 'Period', default: 20, min: 2, max: 400, help: 'Number of candles averaged.' }],
  },
  {
    kind: 'VWAP',
    label: 'VWAP',
    numeric: true,
    description: 'Volume-weighted average price since the session open; resets every trading day. Price above VWAP = buyers in control for the day.',
    example: 'Future Close above Future VWAP',
    params: [],
  },
  {
    kind: 'MACD',
    label: 'MACD',
    numeric: true,
    description: 'Trend-momentum from two EMAs. Line = fast EMA − slow EMA; Signal = EMA of the line; Histogram = Line − Signal (above 0 = bullish momentum).',
    example: 'Future MACD Histogram cross above 0',
    params: [
      { name: 'fast', label: 'Fast', default: 12, help: 'Fast EMA period.' },
      { name: 'slow', label: 'Slow', default: 26, help: 'Slow EMA period.' },
      { name: 'signal', label: 'Signal', default: 9, help: 'EMA period of the signal line.' },
    ],
    fields: [
      { value: 'line', label: 'MACD Line' },
      { value: 'signal', label: 'Signal' },
      { value: 'hist', label: 'Histogram' },
    ],
  },
  {
    kind: 'BBANDS',
    label: 'Bollinger Bands',
    numeric: true,
    description: 'Middle = SMA(period); Upper/Lower = middle ± Std Dev × standard deviation. A close beyond a band marks a stretched move.',
    example: 'Future Close cross above Future Bollinger Upper',
    params: [
      { name: 'period', label: 'Period', default: 20, help: 'Candles in the middle SMA and the deviation.' },
      { name: 'mult', label: 'Std Dev', default: 2, help: 'Band width in standard deviations (2 is standard).' },
    ],
    fields: [
      { value: 'upper', label: 'Upper' },
      { value: 'mid', label: 'Middle' },
      { value: 'lower', label: 'Lower' },
    ],
  },
  {
    kind: 'SUPERTREND',
    label: 'Supertrend',
    numeric: true,
    description: 'ATR-based trailing trend line. Direction is +1 in an uptrend and −1 in a downtrend; Value is the line’s price.',
    example: 'Future Supertrend Direction = 1',
    params: [
      { name: 'period', label: 'ATR Period', default: 10, help: 'Candles in the Average True Range.' },
      { name: 'mult', label: 'Multiplier', default: 3, help: 'Distance of the line from price in ATRs. Higher = fewer flips.' },
    ],
    fields: [
      { value: 'value', label: 'Value' },
      { value: 'direction', label: 'Direction (+1/-1)' },
    ],
  },
  {
    kind: 'PRICE',
    label: 'Price',
    numeric: true,
    description: 'The candle’s own price: Open, High, Low or Close.',
    example: 'Future Close > 25000',
    params: [],
    fields: [
      { value: 'close', label: 'Close' },
      { value: 'open', label: 'Open' },
      { value: 'high', label: 'High' },
      { value: 'low', label: 'Low' },
    ],
  },
  {
    kind: 'VOLUME',
    label: 'Volume',
    numeric: true,
    description: 'Contracts traded during the candle (from Kite).',
    example: 'Call Volume increased by 50% over 1 bar',
    params: [],
  },
  {
    kind: 'OI',
    label: 'Open Interest',
    numeric: true,
    description: 'Outstanding contracts at the candle close (from Kite). Rising OI with rising price suggests fresh longs.',
    example: 'Future OI increased by 5% over 3 bars',
    params: [],
  },
];
