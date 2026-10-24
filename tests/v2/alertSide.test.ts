import { describe, expect, it } from 'vitest';
import { alertSide } from '../../src/shared/v2';
import type { ExprTrace, StrategyDefinition } from '../../src/shared/v2';
import { exampleStrategies } from '../../src/client/v2/strategies/defaults';

const definition = () => exampleStrategies().find((e) => e.key === 'rsi-bb-bull-bear')!.definition;

/** The OR's group ids, in order: [bullish (CE), bearish (PE)]. */
const groupIds = (d: StrategyDefinition) => (d.expression as { children: Array<{ id: string }> }).children.map((c) => c.id);

/** A trace whose top-level groups are TRUE or FALSE as given (ids must come from the same definition). */
function traceWith(d: StrategyDefinition, groups: Record<string, 'TRUE' | 'FALSE'>): ExprTrace {
  const children = groupIds(d).map((id) => ({ id, type: 'AND' as const, result: groups[id] ?? ('FALSE' as const) }));
  return { id: d.expression.id, type: 'OR', result: 'TRUE', children };
}

describe('alertSide', () => {
  it('a bullish group (trades the call leg) is a CALL', () => {
    const d = definition();
    expect(alertSide(d, traceWith(d, { [groupIds(d)[0]!]: 'TRUE' }))).toBe('CALL');
  });

  it('a bearish group (trades the put leg) is a PUT', () => {
    const d = definition();
    expect(alertSide(d, traceWith(d, { [groupIds(d)[1]!]: 'TRUE' }))).toBe('PUT');
  });

  it('a strategy without option legs is a FUT', () => {
    const d = definition();
    const futOnly = { ...d, legs: [{ id: 'A' as const, kind: 'FUT' as const }] };
    expect(alertSide(futOnly, traceWith(futOnly, {}))).toBe('FUT');
  });
});
