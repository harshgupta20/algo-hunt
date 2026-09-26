/**
 * Indicator references and their catalogue entries (the indicator maths in
 * src/server/services/indicator reads these).
 */

export type IndicatorKind = 'RSI' | 'EMA' | 'SMA' | 'VWAP' | 'MACD' | 'BBANDS' | 'SUPERTREND' | 'VOLUME' | 'PRICE' | 'OI' | 'ADX' | 'DMI' | 'PATTERN';

/** A reference to an indicator with its parameters and (for multi-output) field. */
export interface IndicatorRef {
  kind: IndicatorKind;
  params?: Record<string, number>;
  /**
   * MACD: line|signal|hist · BBANDS: upper|mid|lower · PRICE: open|high|low|close ·
   * SUPERTREND: value|direction · DMI: plus|minus · PATTERN: the candlestick pattern (e.g. hammer)
   */
  field?: string;
}

export interface IndicatorParamSpec {
  name: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
  /** Tooltip: what the parameter controls. */
  help?: string;
}

export interface IndicatorSpec {
  kind: IndicatorKind;
  label: string;
  /** Tooltip: what the indicator measures and how traders read it. */
  description?: string;
  example?: string;
  params: IndicatorParamSpec[];
  /** Per-output tooltips (e.g. what a Hammer looks like), keyed by field value. */
  fields?: Array<{ value: string; label: string; description?: string; group?: string }>;
  /** Whether the indicator returns a value comparable to a numeric level. */
  numeric: boolean;
  /** True for yes/no outputs (candlestick patterns): tested with “Is Detected”, not levels. */
  boolean?: boolean;
}
