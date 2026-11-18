/**
 * Conditions pick their instruments and timeframes; the legs and the clock follow (shared/v2/legs.ts) —
 * no legs step and no trigger timeframe to set (2026-11-16).
 */
import { describe, expect, it } from 'vitest';
import type { ExprNode, LegDef, StrategyDefinition, Timeframe } from '../../src/shared/v2';
import { clockLags, clockTimeframe, planLegs, pruneLegs, resolveRules, strategyDefinitionSchema, strategySummary, tidyLegs, withDerivedClock } from '../../src/shared/v2';
import { adaptCondition } from '../../src/client/v2/strategies/comparison';
import { and, cond, field, ind, legSeries, num, strategy } from '../helpers/v2Fakes';

const rsiOn = (leg: 'A' | 'B' | 'C' | 'D', tf: Timeframe = '15m') => cond(ind(legSeries(leg, tf), 'RSI', { period: 14 }), 'GT', num(60));
const clockOf = (...tfs: Timeframe[]) => clockTimeframe(and(...tfs.map((tf) => rsiOn('A', tf))));

describe('the clock follows the conditions', () => {
  it('is the shortest timeframe the conditions read — one the engine fetches, prices and waits for', () => {
    expect(clockOf('15m')).toBe('15m');
    expect(clockOf('15m', '1h')).toBe('15m');
    expect(clockOf('10m', '15m')).toBe('10m');
    expect(clockOf('3m', '5m')).toBe('3m');
    expect(clockOf('2h', '4h')).toBe('2h');
    expect(clockOf('1h', '1d')).toBe('1h');
    expect(clockOf('1d', '1w')).toBe('1d');
    expect(clockOf('1w')).toBe('1w');
    expect(clockTimeframe(and())).toBeNull();
  });

  it('names timeframes whose closes fall between two checks, with the longest wait', () => {
    expect(clockLags(and(rsiOn('A', '15m'), rsiOn('A', '1h'), rsiOn('A', '1d')))).toEqual([]);
    expect(clockLags(and(rsiOn('A', '10m'), rsiOn('A', '15m')))).toEqual([{ timeframe: '15m', upToMinutes: 5 }]);
    // 3-min clock: 15-min closes are all 3-min closes; 5-min ones aren't (9:20 → 9:21, 9:25 → 9:27).
    expect(clockLags(and(rsiOn('A', '3m'), rsiOn('A', '5m'), rsiOn('A', '15m')))).toEqual([{ timeframe: '5m', upToMinutes: 2 }]);
  });

  it('patterns count too', () => {
    const p: ExprNode = { type: 'PATTERN', id: 'p', series: legSeries('A', '5m'), pattern: 'HAMMER' };
    expect(clockTimeframe(and(rsiOn('A', '1h'), p))).toBe('5m');
  });

  it('is set on whatever the API receives — older clients may still send their own', () => {
    const sent = strategy([{ id: 'A', kind: 'FUT' }], and(rsiOn('A', '1h')), '5m');
    expect(strategyDefinitionSchema.parse(sent).evaluation.triggerTimeframe).toBe('1h');
    const { triggerTimeframe: _, ...noClock } = sent.evaluation;
    expect(strategyDefinitionSchema.parse({ ...sent, evaluation: noClock }).evaluation.triggerTimeframe).toBe('1h');
    expect(withDerivedClock(sent).evaluation.triggerTimeframe).toBe('1h');
    expect(strategySummary(withDerivedClock(sent))).toMatch(/Checked: at every 1 hour candle close/);
  });
});

describe('legs follow the instruments the conditions read', () => {
  const fut = strategy([{ id: 'A', kind: 'FUT' }], and(rsiOn('A')));
  const withLeg = (d: StrategyDefinition, leg: LegDef) => ({ ...d, legs: [...d.legs, leg] });

  it('an instrument nothing uses any more is dropped; the clock follows', () => {
    const d = tidyLegs({ ...withLeg(fut, { id: 'B', kind: 'CE', strikeOffset: 0 }), expression: and(rsiOn('B', '5m')) });
    expect(d.legs).toEqual([{ id: 'B', kind: 'CE', strikeOffset: 0 }]);
    expect(d.evaluation.triggerTimeframe).toBe('5m');
  });

  it('editing the conditions never changes what the plan trades: the traded FUT stays FUT', () => {
    const plan = resolveRules(fut, []);
    expect(plan[0]!.leg).toBe('A');
    const d = tidyLegs({ ...withLeg(fut, { id: 'B', kind: 'CE', strikeOffset: 0 }), expression: and(rsiOn('B')) }, planLegs(plan));
    expect(d.legs).toEqual([
      { id: 'A', kind: 'FUT' },
      { id: 'B', kind: 'CE', strikeOffset: 0 },
    ]);
    expect(resolveRules(d, plan)[0]!.leg).toBe('A');
    expect(strategySummary(d, planLegs(plan))).toMatch(/Watches: CE ATM\nAlso used by the trade plan: FUT\n/);
  });

  it('keeps an instrument only the trade plan uses (FUT conditions → buy PE ATM), and drops it once the plan doesn’t', () => {
    const withPut = withLeg(fut, { id: 'B', kind: 'PE', strikeOffset: 0 });
    const keep = planLegs([{ group: null, leg: 'B', side: 'BUY' }]);
    expect([...keep]).toEqual(['B']);
    const edited = tidyLegs({ ...withPut, expression: and(rsiOn('A', '5m')) }, keep);
    expect(edited.legs.map((l) => l.id)).toEqual(['A', 'B']);
    expect(edited.evaluation.triggerTimeframe).toBe('5m');
    expect(pruneLegs(edited, planLegs([{ group: null, leg: 'A', side: 'BUY' }])).legs.map((l) => l.id)).toEqual(['A']);
  });

  it('a trailing rule’s instrument is kept too', () => {
    const keep = planLegs([{ group: null, leg: 'A', side: 'BUY', stopWhen: and(rsiOn('C')) }]);
    expect([...keep].sort()).toEqual(['A', 'C']);
  });

  it('the preview tells the plan’s instruments from ones nothing reads (a strategy saved before)', () => {
    const old = withLeg(withLeg(fut, { id: 'B', kind: 'CE', strikeOffset: 0 }), { id: 'C', kind: 'PE', strikeOffset: 0 });
    const text = strategySummary(old, new Set(['C'] as const));
    expect(text).toMatch(/Also used by the trade plan: PE ATM/);
    expect(text).toMatch(/Not read by anything: CE ATM \(dropped on the next change\)/);
  });

  it('moving a condition onto an instrument the strategy already reads merges the two', () => {
    const two = strategy(
      [
        { id: 'A', kind: 'FUT' },
        { id: 'B', kind: 'CE', strikeOffset: 0 },
      ],
      and(rsiOn('A'), rsiOn('B')),
    );
    expect(tidyLegs({ ...two, expression: and(rsiOn('A'), rsiOn('A')) }).legs).toEqual([{ id: 'A', kind: 'FUT' }]);
  });

  it('never leaves a strategy without a leg while its conditions are rebuilt', () => {
    expect(tidyLegs({ ...fut, expression: and() }).legs).toEqual([{ id: 'A', kind: 'FUT' }]);
  });
});

describe('a condition’s two sides move together', () => {
  it('“Close crossed above SMA” on FUT → switching the left side to CE moves the SMA along', () => {
    const close = field(legSeries('A', '5m'));
    const sma = ind(legSeries('A', '5m'), 'SMA', { period: 20 });
    const c = cond(close, 'CROSSED_ABOVE', sma) as Extract<ExprNode, { type: 'CONDITION' }>;
    const r = adaptCondition(c, 'left', { kind: 'FIELD', series: legSeries('B', '5m'), field: 'close' });
    expect(r.cond.right).toEqual({ ...sma, series: legSeries('B', '5m') });
  });

  it('sides on different series stay where they are', () => {
    const c = cond(field(legSeries('A')), 'GT', ind(legSeries('B'), 'SMA', { period: 20 })) as Extract<ExprNode, { type: 'CONDITION' }>;
    const r = adaptCondition(c, 'left', { kind: 'FIELD', series: legSeries('C'), field: 'close' });
    expect(r.cond.right).toEqual(c.right);
  });
});
