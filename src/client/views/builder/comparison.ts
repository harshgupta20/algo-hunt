/**
 * Pure rules for the condition editor's right-hand side: what unit each
 * indicator output is in, a typical level to compare it with, and how the
 * comparison adapts when the left indicator changes (so a Bollinger band is
 * compared with the close, not a leftover RSI level like 60).
 */
import type { BuilderCatalog, Condition, IndicatorRef } from '@ash/shared';

export function newIndicatorRef(catalog: BuilderCatalog, kind?: string, params?: Record<string, number>): IndicatorRef {
  const spec = catalog.indicators.find((i) => i.kind === kind) ?? catalog.indicators[0]!;
  const defaults = Object.fromEntries(spec.params.map((p) => [p.name, p.default]));
  return { kind: spec.kind, params: { ...defaults, ...params }, field: spec.fields?.[0]?.value };
}

export type Scale = 'price' | 'oscillator' | 'macd' | 'direction' | 'volume' | 'oi' | 'boolean' | 'ratio' | 'percent';

/** What unit an indicator output is in — comparing different units rarely makes sense. */
export function scaleOf(ref: IndicatorRef): Scale {
  switch (ref.kind) {
    case 'RSI':
    case 'ADX':
    case 'DMI':
      return 'oscillator';
    case 'PATTERN':
      return 'boolean';
    case 'MACD':
      return 'macd';
    case 'SUPERTREND':
      return ref.field === 'direction' ? 'direction' : 'price';
    case 'BBANDS':
      return ref.field === 'percentB' ? 'ratio' : ref.field === 'bandwidth' ? 'percent' : 'price';
    case 'VOLUME':
      return 'volume';
    case 'OI':
      return 'oi';
    default:
      return 'price'; // EMA, SMA, VWAP, Bollinger, Price
  }
}

export const SCALE_LABEL: Record<Scale, string> = {
  price: 'a price',
  oscillator: 'an oscillator (0–100)',
  macd: 'a MACD value (around 0)',
  direction: 'a direction (+1 / −1)',
  volume: 'a volume',
  oi: 'an open-interest count',
  boolean: 'a yes/no pattern',
  ratio: 'a %B ratio (0 = lower band, 1 = upper band)',
  percent: 'a band width (%)',
};

/** A sensible fixed level when an indicator is compared with a number (undefined = keep the current value). */
export function defaultLevel(ref: IndicatorRef): number | undefined {
  switch (ref.kind) {
    case 'RSI':
      return 60;
    case 'ADX':
    case 'DMI':
      return 25;
    case 'MACD':
      return 0;
    case 'SUPERTREND':
      return ref.field === 'direction' ? 1 : undefined;
    case 'BBANDS':
      return ref.field === 'percentB' ? 1 : ref.field === 'bandwidth' ? 2 : undefined;
    default:
      return undefined;
  }
}

const NEXT_LEG: Record<string, Condition['instrument']> = { future: 'call', call: 'put', put: 'call' };

/** Sensible right-hand side when switching to “Compare to: Indicator”. */
export function defaultComparison(catalog: BuilderCatalog, cond: Condition): Pick<Condition, 'compareTo' | 'compareInstrument'> {
  const { kind, params } = cond.indicator;
  if (scaleOf(cond.indicator) === 'price') {
    // Bands, VWAP and the Supertrend line are read against the candle's own close.
    if (kind === 'BBANDS' || kind === 'VWAP' || kind === 'SUPERTREND') {
      return { compareTo: newIndicatorRef(catalog, 'PRICE'), compareInstrument: cond.instrument };
    }
    // Price / moving averages → the classic crossover against a slower EMA on the same leg.
    const slow = kind === 'EMA' && (params?.period ?? 0) >= 50 ? 200 : 50;
    return { compareTo: newIndicatorRef(catalog, 'EMA', { period: slow }), compareInstrument: cond.instrument };
  }
  // Oscillators etc. → the same indicator on another leg (e.g. Call RSI vs Put RSI).
  return { compareTo: { ...cond.indicator }, compareInstrument: NEXT_LEG[cond.instrument] ?? cond.instrument };
}

/**
 * Keep the right-hand side meaningful when the left indicator (or its output)
 * changes: price-type outputs (bands, averages, VWAP, Price) compare with an
 * indicator instead of a leftover level such as RSI's 60; non-price outputs
 * drop a price comparison and get a typical level (RSI 60, %B 1, …).
 */
export function adaptComparison(catalog: BuilderCatalog, cond: Condition, indicator: IndicatorRef): Partial<Condition> {
  const op = catalog.operators.find((o) => o.value === cond.operator);
  if (op?.arity !== 'value') return {};
  const next = { ...cond, indicator };
  const scale = scaleOf(indicator);
  // Same unit as before (e.g. Upper → Lower band, EMA → SMA): keep what the user set, even a typed price level.
  if (scale === scaleOf(cond.indicator)) return {};
  if (scale === 'price') {
    if (cond.compareTo && scaleOf(cond.compareTo) === 'price') return {};
    return { ...defaultComparison(catalog, next), compareTimeframe: undefined };
  }
  const level = defaultLevel(indicator);
  if (cond.compareTo && scaleOf(cond.compareTo) !== scale) {
    return { compareTo: undefined, compareInstrument: undefined, compareTimeframe: undefined, value: level ?? cond.value };
  }
  if (!cond.compareTo && level !== undefined && scaleOf(cond.indicator) !== scale) return { value: level };
  return {};
}

/**
 * A futures price compared with an oscillator-style number (e.g. Bollinger
 * Upper > 60). Every supported future trades well above 100, so such a level
 * is almost certainly a leftover. Option premiums can be small, so only the
 * Future leg is checked.
 */
export function priceLevelLooksWrong(cond: Condition, arity: string | undefined): boolean {
  return (
    arity === 'value' &&
    !cond.compareTo &&
    cond.instrument === 'future' &&
    scaleOf(cond.indicator) === 'price' &&
    cond.value !== undefined &&
    Math.abs(cond.value) <= 100
  );
}
