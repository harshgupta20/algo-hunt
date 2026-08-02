/**
 * Indicator factory + catalog. The catalog is served to the builder UI so the
 * available indicators/params/fields are data-driven (no UI change to add one).
 */
import type { IndicatorRef, IndicatorSpec } from '@ash/shared';
import { INDICATOR_CLASSES } from './library.js';
import type { Indicator } from './types.js';

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
  { kind: 'RSI', label: 'RSI', numeric: true, params: [{ name: 'period', label: 'Period', default: 14, min: 2, max: 100 }] },
  { kind: 'EMA', label: 'EMA', numeric: true, params: [{ name: 'period', label: 'Period', default: 20, min: 2, max: 400 }] },
  { kind: 'SMA', label: 'SMA', numeric: true, params: [{ name: 'period', label: 'Period', default: 20, min: 2, max: 400 }] },
  { kind: 'VWAP', label: 'VWAP', numeric: true, params: [] },
  {
    kind: 'MACD',
    label: 'MACD',
    numeric: true,
    params: [
      { name: 'fast', label: 'Fast', default: 12 },
      { name: 'slow', label: 'Slow', default: 26 },
      { name: 'signal', label: 'Signal', default: 9 },
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
    params: [
      { name: 'period', label: 'Period', default: 20 },
      { name: 'mult', label: 'Std Dev', default: 2 },
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
    params: [
      { name: 'period', label: 'ATR Period', default: 10 },
      { name: 'mult', label: 'Multiplier', default: 3 },
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
    params: [],
    fields: [
      { value: 'close', label: 'Close' },
      { value: 'open', label: 'Open' },
      { value: 'high', label: 'High' },
      { value: 'low', label: 'Low' },
    ],
  },
  { kind: 'VOLUME', label: 'Volume', numeric: true, params: [] },
  { kind: 'OI', label: 'Open Interest', numeric: true, params: [] },
];
