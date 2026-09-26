/**
 * Alert policy — kept separate from strategy logic. The strategy decides
 * whether a unit's expression is TRUE; the policy decides whether that becomes
 * a signal and whether the signal is delivered.
 *
 * State machine per unit:
 *   IDLE ──fire──▶ TRIGGERED ──(cooldown set)──▶ COOLDOWN ──(expired)──▶ IDLE
 *   TRIGGERED/COOLDOWN ──acknowledge──▶ ACKNOWLEDGED ──(result FALSE)──▶ IDLE
 *   any ──strategy disabled──▶ DISABLED ──enabled──▶ IDLE
 *
 * "Fires" = ON_TRANSITION: previous result FALSE and current TRUE (UNKNOWN is
 * never treated as false); WHILE_TRUE: current TRUE.
 */
import type { AlertPolicy, SignalOutcome, TriState, UnitState } from '@/shared/mcx';
import { MCX2_MAX_ALERT_LAG_MS } from '@/shared/mcx';

export interface PolicyInput {
  policy: AlertPolicy;
  state: UnitState;
  result: TriState;
  /** Result on the previous trigger candle (stored, or seeded by re-evaluating it). */
  prevResult: TriState | null;
  /** Open time (epoch s) of the trigger candle. */
  triggerCandle: number;
  /** Evaluation time T (ms): candle close (completed mode) or now (live). */
  at: number;
  now: number;
  /** ISO time the strategy was enabled; candles closing before it never alert. */
  enabledAt: string | null;
  mode: 'COMPLETED_CANDLE' | 'LIVE_CANDLE';
}

export interface PolicyDecision {
  /** Present when the evaluation produced a signal (delivered or suppressed). */
  outcome?: SignalOutcome;
  next: UnitState;
}

export function fires(policy: AlertPolicy, result: TriState, prev: TriState | null): boolean {
  if (result !== 'TRUE') return false;
  return policy.trigger === 'WHILE_TRUE' || prev === 'FALSE';
}

/** Signal identity: one signal per strategy version · unit · trigger candle (· minute when repeats are allowed). */
export function signalIdentity(p: {
  strategyId: string;
  version: number;
  unitKey: string;
  triggerTimeframe: string;
  triggerCandle: number;
  mode: 'COMPLETED_CANDLE' | 'LIVE_CANDLE';
  oncePerCandle: boolean;
  now: number;
}): string {
  const base = `${p.strategyId}:v${p.version}:${p.unitKey}:${p.triggerTimeframe}:${p.triggerCandle}:ENTRY`;
  return p.mode === 'LIVE_CANDLE' && !p.oncePerCandle ? `${base}:m${Math.floor(p.now / 60_000)}` : base;
}

export function decide(i: PolicyInput): PolicyDecision {
  const s = i.state;
  const cooldownActive = s.cooldownUntil !== null && Date.parse(s.cooldownUntil) > i.now;
  let state = s.state;
  if (state === 'DISABLED') state = 'IDLE';
  // Settle time-based / result-based transitions first.
  if ((state === 'TRIGGERED' || state === 'COOLDOWN') && !cooldownActive) state = 'IDLE';
  if (state === 'TRIGGERED' && cooldownActive) state = 'COOLDOWN';
  if (state === 'ACKNOWLEDGED' && i.result === 'FALSE') state = 'IDLE';

  const base: UnitState = { ...s, state, lastResult: i.result };
  if (!fires(i.policy, i.result, i.prevResult)) return { next: base };

  const onceGuard = (i.mode === 'COMPLETED_CANDLE' || i.policy.oncePerCandle) && s.lastSignalCandle === i.triggerCandle;
  if (onceGuard) return { next: base };

  const signalled = { ...base, lastSignalCandle: i.triggerCandle };
  if (i.enabledAt && i.at < Date.parse(i.enabledAt)) return { outcome: 'SUPPRESSED_BEFORE_ENABLE', next: signalled };
  if (i.now - i.at > MCX2_MAX_ALERT_LAG_MS) return { outcome: 'SUPPRESSED_STALE', next: signalled };
  if (state === 'ACKNOWLEDGED') return { outcome: 'SUPPRESSED_ACKNOWLEDGED', next: signalled };
  if (cooldownActive) return { outcome: 'SUPPRESSED_COOLDOWN', next: signalled };

  const alerted: UnitState = {
    ...signalled,
    state: 'TRIGGERED',
    lastAlertAt: new Date(i.now).toISOString(),
    cooldownUntil: i.policy.cooldownMinutes ? new Date(i.now + i.policy.cooldownMinutes * 60_000).toISOString() : null,
  };
  const hasChannel = i.policy.channels.telegram || i.policy.channels.email;
  return { outcome: hasChannel ? 'ALERTED' : 'NO_CHANNEL', next: alerted };
}

export function initialState(strategyId: string, unitKey: string): UnitState {
  return {
    strategyId,
    unitKey,
    state: 'IDLE',
    lastEvaluatedCandle: null,
    lastResult: null,
    lastSignalCandle: null,
    lastAlertAt: null,
    cooldownUntil: null,
    lastEvaluation: null,
  };
}
