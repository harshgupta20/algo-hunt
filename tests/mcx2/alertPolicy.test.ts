import { describe, expect, it } from 'vitest';
import type { AlertPolicy, UnitState } from '../../src/shared/mcx';
import { decide, fires, initialState, signalIdentity, type PolicyInput } from '../../src/server/mcx/alerts/alertPolicy';

const policy: AlertPolicy = { channels: { telegram: true, email: true }, trigger: 'ON_TRANSITION', cooldownMinutes: 30, oncePerCandle: true };
const T = Date.parse('2026-10-07T05:30:00Z');

function input(p: Partial<PolicyInput> = {}): PolicyInput {
  return {
    policy,
    state: initialState('s', 'MCX:1'),
    result: 'TRUE',
    prevResult: 'FALSE',
    triggerCandle: T / 1000 - 900,
    at: T,
    now: T + 20_000,
    enabledAt: new Date(T - 3_600_000).toISOString(),
    mode: 'COMPLETED_CANDLE',
    ...p,
  };
}

describe('alert policy', () => {
  it('fires on a false → true transition only; UNKNOWN is never "false"', () => {
    expect(fires(policy, 'TRUE', 'FALSE')).toBe(true);
    expect(fires(policy, 'TRUE', 'TRUE')).toBe(false);
    expect(fires(policy, 'TRUE', 'UNKNOWN')).toBe(false);
    expect(fires(policy, 'TRUE', null)).toBe(false);
    expect(fires({ ...policy, trigger: 'WHILE_TRUE' }, 'TRUE', 'TRUE')).toBe(true);
    expect(fires(policy, 'UNKNOWN', 'FALSE')).toBe(false);
  });

  it('alerts, then enters cooldown and suppresses until it expires', () => {
    const d = decide(input());
    expect(d.outcome).toBe('ALERTED');
    expect(d.next).toMatchObject({ state: 'TRIGGERED', lastSignalCandle: T / 1000 - 900 });
    expect(Date.parse(d.next.cooldownUntil!) - (T + 20_000)).toBe(30 * 60_000);

    const later = T + 15 * 60_000;
    const again = decide(input({ state: d.next, triggerCandle: T / 1000, at: later, now: later + 20_000 }));
    expect(again.outcome).toBe('SUPPRESSED_COOLDOWN');
    expect(again.next.state).toBe('COOLDOWN');

    const quiet = decide(input({ state: d.next, result: 'FALSE', at: later, now: later + 20_000, triggerCandle: T / 1000 }));
    expect(quiet.outcome).toBeUndefined();
    expect(quiet.next.state).toBe('COOLDOWN');

    const expired = T + 45 * 60_000;
    expect(decide(input({ state: d.next, result: 'FALSE', at: expired, now: expired })).next.state).toBe('IDLE');
    expect(decide(input({ state: d.next, triggerCandle: expired / 1000, at: expired, now: expired + 1 })).outcome).toBe('ALERTED');
  });

  it('never signals twice for the same trigger candle', () => {
    const first = decide(input({ policy: { ...policy, trigger: 'WHILE_TRUE', cooldownMinutes: null } }));
    const second = decide(input({ policy: { ...policy, trigger: 'WHILE_TRUE', cooldownMinutes: null }, state: first.next }));
    expect(first.outcome).toBe('ALERTED');
    expect(second.outcome).toBeUndefined();
  });

  it('suppresses while acknowledged and re-arms when the strategy turns false', () => {
    const acked: UnitState = { ...initialState('s', 'MCX:1'), state: 'ACKNOWLEDGED', lastSignalCandle: 1 };
    const wt = { ...policy, trigger: 'WHILE_TRUE' as const, cooldownMinutes: null };
    expect(decide(input({ policy: wt, state: acked })).outcome).toBe('SUPPRESSED_ACKNOWLEDGED');
    const rearmed = decide(input({ policy: wt, state: acked, result: 'FALSE' }));
    expect(rearmed.next.state).toBe('IDLE');
    expect(decide(input({ policy: wt, state: rearmed.next, triggerCandle: 99 })).outcome).toBe('ALERTED');
  });

  it('records but never delivers signals from before enabling or too old', () => {
    expect(decide(input({ enabledAt: new Date(T + 60_000).toISOString() })).outcome).toBe('SUPPRESSED_BEFORE_ENABLE');
    expect(decide(input({ now: T + 31 * 60_000 })).outcome).toBe('SUPPRESSED_STALE');
  });

  it('marks signals without a channel as record-only', () => {
    expect(decide(input({ policy: { ...policy, channels: { telegram: false, email: false } } })).outcome).toBe('NO_CHANNEL');
  });

  it('builds deterministic identities (with a minute only for repeating live alerts)', () => {
    const base = { strategyId: 's', version: 3, unitKey: 'MCX:9', triggerTimeframe: '15m', triggerCandle: 1000, now: 120_000 };
    expect(signalIdentity({ ...base, mode: 'COMPLETED_CANDLE', oncePerCandle: false })).toBe('s:v3:MCX:9:15m:1000:ENTRY');
    expect(signalIdentity({ ...base, mode: 'LIVE_CANDLE', oncePerCandle: true })).toBe('s:v3:MCX:9:15m:1000:ENTRY');
    expect(signalIdentity({ ...base, mode: 'LIVE_CANDLE', oncePerCandle: false })).toBe('s:v3:MCX:9:15m:1000:ENTRY:m2');
  });
});
