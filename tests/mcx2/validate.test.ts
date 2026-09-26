import { describe, expect, it } from 'vitest';
import type { McxStrategyDefinition } from '../../src/shared/mcx';
import { hasErrors, mcxStrategyDefinitionSchema, strategySummary, validateStrategy } from '../../src/shared/mcx';
import { CE as TARGET, FUT as UNDERLYING, and, cond, field, ind, num } from '../helpers/mcxFakes';

const base: McxStrategyDefinition = {
  schemaVersion: 2,
  market: 'MCX',
  name: 'Gold momentum',
  universe: {
    underlying: 'GOLD',
    target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, strikes: { mode: 'ATM_OFFSETS', offsets: [-2, -1, 0, 1, 2] } },
  },
  evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
  expression: and(cond(ind(TARGET('15m'), 'RSI', { period: 14 }), 'CROSSED_ABOVE', num(60)), cond(ind(TARGET('15m'), 'ADX', { period: 14, smoothing: 14 }), 'GT', num(25))),
  alert: { channels: { telegram: true, email: true }, trigger: 'ON_TRANSITION', cooldownMinutes: 30, oncePerCandle: true },
};
const ctx = { syncedProducts: ['GOLD'], channelsConfigured: { telegram: true, email: true } };
const errors = (d: McxStrategyDefinition, c = {}) => validateStrategy(d, { ...ctx, ...c }).filter((i) => i.severity === 'error');

describe('strategy validation', () => {
  it('accepts a well-formed strategy and parses with the schema', () => {
    expect(errors(base)).toEqual([]);
    expect(mcxStrategyDefinitionSchema.safeParse(base).success).toBe(true);
  });

  it('rejects comparing values of different units (price vs oscillator)', () => {
    const d = { ...base, expression: cond(field(TARGET('15m')), 'GT', ind(TARGET('15m'), 'RSI', { period: 14 })) };
    expect(errors(d).map((e) => e.message).join()).toMatch(/unit|compare/i);
  });

  it('rejects empty groups, a constant on the left and out-of-range params', () => {
    expect(hasErrors(validateStrategy({ ...base, expression: and() }, ctx))).toBe(true);
    expect(hasErrors(validateStrategy({ ...base, expression: cond(num(1), 'GT', num(0)) }, ctx))).toBe(true);
    expect(hasErrors(validateStrategy({ ...base, expression: cond(ind(TARGET('15m'), 'RSI', { period: 1 }), 'GT', num(50)) }, ctx))).toBe(true);
  });

  it('requires synced products, a non-empty universe within the cap, and configured channels to enable', () => {
    expect(errors(base, { syncedProducts: ['SILVER'] }).length).toBeGreaterThan(0);
    expect(errors(base, { resolvedTargets: 0 }).length).toBeGreaterThan(0);
    expect(errors(base, { resolvedTargets: 60, universeCap: 40 }).length).toBeGreaterThan(0);
    expect(errors(base, { forEnable: true, channelsConfigured: { telegram: true, email: false } }).map((e) => e.path).join()).toMatch(/alert/);
  });

  it('rejects CE / PE conditions on a futures strategy and options on a product without them', () => {
    const fut = { ...base, universe: { underlying: 'GOLD', target: { kind: 'FUTURE' as const, expiry: { mode: 'CURRENT' as const } } } };
    expect(errors(fut).map((e) => e.message).join()).toMatch(/CE \/ PE conditions need Options/);
    expect(errors(base, { optionProducts: ['SILVER'] }).map((e) => e.message).join()).toMatch(/no listed options/);
  });

  it('warns when the trigger timeframe is not used by any condition', () => {
    const d = { ...base, expression: cond(field(UNDERLYING('1h')), 'GT', num(1)) };
    expect(validateStrategy(d, ctx).some((i) => i.severity === 'warning' && i.path === 'evaluation.triggerTimeframe')).toBe(true);
  });

  it('summarises the strategy as IF / THEN text', () => {
    const s = strategySummary(base);
    expect(s).toMatch(/GOLD — Options — Current expiry — ATM ± 2 \(FUT · CE · PE per strike\)/);
    expect(s).toMatch(/\[GOLD CE\] \[15 min\] \[Normal\] RSI\(14\) crossed above 60/);
    expect(s).toMatch(/RSI\(14\) crossed above 60/);
    expect(s).toMatch(/cooldown 30 min · once per candle/);
  });
});
