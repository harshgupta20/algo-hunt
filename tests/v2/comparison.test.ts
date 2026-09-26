import { describe, expect, it } from 'vitest';
import type { ConditionNode, Operand } from '../../src/shared/v2';
import { conditionText } from '../../src/shared/v2';
import { adaptCondition, compareWithClose, defaultLevel, isPriceLevel } from '../../src/client/v2/strategies/comparison';
import { legSeries } from '../helpers/v2Fakes';

const A = legSeries('A', '5m');
const legs = [{ id: 'A' as const, kind: 'FUT' as const }];
const bb = (output: string): Operand => ({ kind: 'INDICATOR', series: A, indicator: 'BB', params: { period: 20, stdDev: 2 }, output });
const rsi: Operand = { kind: 'INDICATOR', series: A, indicator: 'RSI', params: { period: 14 } };
const close: Operand = { kind: 'FIELD', series: A, field: 'close' };
const base: ConditionNode = { type: 'CONDITION', id: 'c', left: rsi, operator: 'CROSSED_ABOVE', right: { kind: 'CONSTANT', value: 60 } };

describe('Bollinger / price-level comparisons', () => {
  it('choosing a Bollinger band turns "band vs number" into "Close vs band" (no number)', () => {
    const r = adaptCondition(base, 'left', bb('upper'));
    expect(r.cond.left).toEqual(close);
    expect(r.cond.right).toEqual(bb('upper'));
    expect(r.cond.operator).toBe('CROSSED_ABOVE');
    expect(conditionText(r.cond, legs)).toBe('[A · FUT] [5 min] [Normal] Close crossed above Bollinger Bands(20,2) Upper');
    expect(r.note).toMatch(/price level/);
  });

  it('does the same for moving averages and the Supertrend line', () => {
    const sma: Operand = { kind: 'INDICATOR', series: A, indicator: 'SMA', params: { period: 20 } };
    expect(adaptCondition(base, 'left', sma).cond.right).toEqual(sma);
    expect(isPriceLevel({ kind: 'INDICATOR', series: A, indicator: 'SUPERTREND', params: { period: 10, multiplier: 3 }, output: 'value' })).toBe(true);
    expect(isPriceLevel({ kind: 'INDICATOR', series: A, indicator: 'SMA', params: { period: 20 }, source: 'volume' })).toBe(false);
  });

  it('switching the band output to %B or Bandwidth brings back a number with a sensible level', () => {
    const closeVsUpper: ConditionNode = { ...base, left: close, right: bb('upper') };
    const pb = adaptCondition(closeVsUpper, 'right', bb('percentB'));
    expect(pb.cond.left).toEqual(bb('percentB'));
    expect(pb.cond.right).toEqual({ kind: 'CONSTANT', value: 1 });
    expect(adaptCondition(closeVsUpper, 'right', bb('bandwidth')).cond.right).toEqual({ kind: 'CONSTANT', value: 2 });
    // Upper → Lower keeps the Close comparison.
    expect(adaptCondition(closeVsUpper, 'right', bb('lower')).cond).toEqual({ ...closeVsUpper, right: bb('lower') });
  });

  it('a reading on the left compared with a price switches to a number', () => {
    const r = adaptCondition({ ...base, left: close, right: bb('upper') }, 'left', rsi);
    expect(r.cond.right).toEqual({ kind: 'CONSTANT', value: 60 });
  });

  it('switching between readings uses each one’s typical level and keeps a typed level otherwise', () => {
    const adx: Operand = { kind: 'INDICATOR', series: A, indicator: 'ADX', params: { period: 14, smoothing: 14 } };
    expect(adaptCondition(base, 'left', adx).cond.right).toEqual({ kind: 'CONSTANT', value: 25 });
    const rsi21 = { ...rsi, params: { period: 21 } } as Operand;
    expect(adaptCondition({ ...base, right: { kind: 'CONSTANT', value: 55 } }, 'left', rsi21).cond.right).toEqual({ kind: 'CONSTANT', value: 55 });
    expect(defaultLevel(bb('upper'))).toBeUndefined();
  });

  it('fixes an existing "Bollinger Upper crossed above 60" in one click', () => {
    const old: ConditionNode = { ...base, left: bb('upper') };
    expect(compareWithClose(old)).toEqual({ ...old, left: close, right: bb('upper') });
  });
});
