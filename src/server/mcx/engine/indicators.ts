/**
 * Indicator + pattern computation over MCX V2 series. The math is the shared,
 * already-tested indicator library (Wilder RSI/ADX/DMI, SMA, EMA, Bollinger,
 * MACD, Supertrend) and pattern detectors; this adapter maps V2 operands onto
 * it — including the selectable source (e.g. SMA of volume) — and returns one
 * value per candle, aligned with the series.
 */
import type { Operand, PatternId, SourceField } from '@/shared/mcx';
import { MCX2_INDICATOR, MCX2_PATTERN } from '@/shared/mcx';
import { MAX_PATTERN_BARS, PATTERN_BY_ID } from '../../services/indicator/patterns';
import { createIndicator } from '../../services/indicator/registry';
import type { McxCandle } from './candles';

type IndicatorOperand = Extract<Operand, { kind: 'INDICATOR' }>;

/** V2 catalog id → shared library kind + parameter names. */
const LIBRARY: Record<string, { kind: string; params: (p: Record<string, number>) => Record<string, number> }> = {
  RSI: { kind: 'RSI', params: (p) => ({ period: p.period ?? 14 }) },
  SMA: { kind: 'SMA', params: (p) => ({ period: p.period ?? 20 }) },
  EMA: { kind: 'EMA', params: (p) => ({ period: p.period ?? 20 }) },
  BB: { kind: 'BBANDS', params: (p) => ({ period: p.period ?? 20, mult: p.stdDev ?? 2 }) },
  ADX: { kind: 'ADX', params: (p) => ({ period: p.period ?? 14, smoothing: p.smoothing ?? 14 }) },
  DMI: { kind: 'DMI', params: (p) => ({ period: p.period ?? 14 }) },
  MACD: { kind: 'MACD', params: (p) => ({ fast: p.fast ?? 12, slow: p.slow ?? 26, signal: p.signal ?? 9 }) },
  SUPERTREND: { kind: 'SUPERTREND', params: (p) => ({ period: p.period ?? 10, mult: p.multiplier ?? 3 }) },
};

export function fieldValue(c: McxCandle, field: SourceField): number | undefined {
  return field === 'oi' ? c.oi : c[field];
}

/** Default output of a multi-line indicator (first in the catalog). */
export function outputOf(op: IndicatorOperand): string | undefined {
  return op.output ?? MCX2_INDICATOR[op.indicator]?.outputs?.[0]?.value;
}

/** Cache key for an indicator operand (multiplier excluded — applied after). */
export function indicatorKey(op: IndicatorOperand): string {
  const p = Object.keys(op.params)
    .sort()
    .map((k) => `${k}=${op.params[k]}`)
    .join(',');
  return `${op.indicator}(${p})|${op.source ?? 'close'}|${outputOf(op) ?? ''}`;
}

/** One value per candle (undefined during warm-up). The multiplier is NOT applied here. */
export function indicatorValues(candles: McxCandle[], op: IndicatorOperand): Array<number | undefined> {
  const lib = LIBRARY[op.indicator];
  if (!lib) throw new Error(`Unknown indicator ${op.indicator}`);
  const spec = MCX2_INDICATOR[op.indicator]!;
  const ind = createIndicator({ kind: lib.kind as never, params: lib.params(op.params), field: outputOf(op) });
  const source = spec.sources ? (op.source ?? 'close') : null;
  return candles.map((c) => {
    // Single-source indicators read `close`, so the chosen source is substituted there.
    ind.update(source && source !== 'close' ? { ...c, close: fieldValue(c, source) ?? 0 } : c);
    const v = ind.value();
    return v === undefined || !Number.isFinite(v) ? undefined : v;
  });
}

/** Per candle: true when the pattern completes on it (undefined = not enough candles yet). */
export function patternValues(candles: McxCandle[], pattern: PatternId): Array<boolean | undefined> {
  const def = PATTERN_BY_ID[MCX2_PATTERN[pattern].legacyId];
  if (!def) throw new Error(`Unknown pattern ${pattern}`);
  return candles.map((_, i) => {
    if (i + 1 < def.bars) return undefined;
    return def.detect(candles.slice(Math.max(0, i + 1 - MAX_PATTERN_BARS), i + 1));
  });
}
