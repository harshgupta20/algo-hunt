import { describe, expect, it } from 'vitest';
import type { Operand } from '../../src/shared/v2';
import { validateStrategy } from '../../src/shared/v2';
import { indicatorValues } from '../../src/server/v2/engine/indicators';
import type { Candle } from '../../src/server/v2/engine/candles';
import { cond, field, legSeries, num, strategy } from '../helpers/v2Fakes';

const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 30];
const candles: Candle[] = closes.map((c, i) => ({ time: i * 60, open: c, high: c + 1, low: c - 1, close: c, volume: 100, closeMs: 0, complete: true }));
const bb = (output: string, extra: Partial<Extract<Operand, { kind: 'INDICATOR' }>> = {}) =>
  ({ kind: 'INDICATOR', series: legSeries('A'), indicator: 'BB', params: { period: 5, stdDev: 2 }, output, ...extra }) as Extract<Operand, { kind: 'INDICATOR' }>;

describe('V2 Bollinger Bands', () => {
  // Last 5 closes: 15, 16, 17, 18, 30 → mean 19.2, population σ = √(144.56/5 … ) computed below.
  const last = [15, 16, 17, 18, 30];
  const mean = last.reduce((a, b) => a + b, 0) / 5;
  const sd = Math.sqrt(last.reduce((a, b) => a + (b - mean) ** 2, 0) / 5);

  it('computes upper / middle / lower with the chosen std dev', () => {
    expect(indicatorValues(candles, bb('mid')).at(-1)).toBeCloseTo(mean);
    expect(indicatorValues(candles, bb('upper')).at(-1)).toBeCloseTo(mean + 2 * sd);
    expect(indicatorValues(candles, bb('lower')).at(-1)).toBeCloseTo(mean - 2 * sd);
    expect(indicatorValues(candles, bb('upper', { params: { period: 5, stdDev: 1 } })).at(-1)).toBeCloseTo(mean + sd);
    expect(indicatorValues(candles, bb('mid')).slice(0, 4).every((v) => v === undefined)).toBe(true); // warm-up
  });

  it('computes %B and bandwidth', () => {
    const upper = mean + 2 * sd;
    const lower = mean - 2 * sd;
    expect(indicatorValues(candles, bb('percentB')).at(-1)).toBeCloseTo((30 - lower) / (upper - lower));
    expect(indicatorValues(candles, bb('bandwidth')).at(-1)).toBeCloseTo(((upper - lower) / mean) * 100);
  });

  it('can use another source (e.g. highs)', () => {
    const highs = last.map((c) => c + 1);
    const m = highs.reduce((a, b) => a + b, 0) / 5;
    expect(indicatorValues(candles, bb('mid', { source: 'high' })).at(-1)).toBeCloseTo(m);
  });

  it('accepts Close vs Upper and %B vs a number, rejects Upper vs RSI', () => {
    const legs = [{ id: 'A' as const, kind: 'FUT' as const }];
    expect(validateStrategy(strategy(legs, cond(field(legSeries('A')), 'CROSSED_ABOVE', bb('upper')))).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateStrategy(strategy(legs, cond(bb('percentB'), 'GT', num(1)))).filter((i) => i.severity === 'error')).toEqual([]);
    const rsi: Operand = { kind: 'INDICATOR', series: legSeries('A'), indicator: 'RSI', params: { period: 14 } };
    expect(validateStrategy(strategy(legs, cond(bb('upper'), 'GT', rsi))).some((i) => i.severity === 'error')).toBe(true);
  });
});
