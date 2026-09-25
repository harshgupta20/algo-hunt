import { describe, expect, it } from 'vitest';
import type { Condition, IndicatorRef } from '@ash/shared';
import { evaluateCondition, type Resolve } from '../src/server/services/strategy/conditionEngine';

const EMA20: IndicatorRef = { kind: 'EMA', params: { period: 20 } };
const EMA50: IndicatorRef = { kind: 'EMA', params: { period: 50 } };

/** Resolve from fixed series: values[kind+period] = [.., prev, curr] (index 0 = current). */
function resolver(series: Record<string, number[]>): Resolve {
  return (_inst, ref, back) => {
    const arr = series[`${ref.kind}${ref.params?.period ?? ''}`]!;
    return arr[arr.length - 1 - back];
  };
}

function cross(op: 'crossAbove' | 'crossBelow', compareTo?: IndicatorRef, value?: number): Condition {
  return { type: 'condition', id: 'c', instrument: 'future', indicator: EMA20, operator: op, value, compareTo };
}

describe('condition engine — indicator vs indicator crossings', () => {
  it('fires when the fast line moves from below to above the slow line', () => {
    const r = resolver({ EMA20: [99, 101], EMA50: [100, 100.5] });
    expect(evaluateCondition(cross('crossAbove', EMA50), r).passed).toBe(true);
  });

  it('does NOT fire when the fast line was already above (the slow line just moved)', () => {
    // prev: 100 vs 99 (already above); curr: 101 vs 100.5 (still above) → no cross.
    const r = resolver({ EMA20: [100, 101], EMA50: [99, 100.5] });
    expect(evaluateCondition(cross('crossAbove', EMA50), r).passed).toBe(false);
  });

  it('cross below mirrors the rule', () => {
    expect(evaluateCondition(cross('crossBelow', EMA50), resolver({ EMA20: [101, 99], EMA50: [100, 99.5] })).passed).toBe(true);
    expect(evaluateCondition(cross('crossBelow', EMA50), resolver({ EMA20: [99, 98], EMA50: [100, 99.5] })).passed).toBe(false);
  });

  it('a fixed level still behaves as before', () => {
    expect(evaluateCondition(cross('crossAbove', undefined, 60), resolver({ EMA20: [59.98, 60.02] })).passed).toBe(true);
    expect(evaluateCondition(cross('crossAbove', undefined, 60), resolver({ EMA20: [60.5, 61] })).passed).toBe(false);
  });
});
