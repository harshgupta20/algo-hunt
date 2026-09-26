/**
 * The last step of evaluating a unit, shared by the cron scanner and the live
 * worker so both decide alerts identically:
 *   previous result (stored, or re-evaluated) → alert policy → signal (deduped by
 *   identity) → alert → delivery. The caller persists the returned unit state.
 */
import type { ScanError, TriState, UnitEvaluation, UnitState, V2Connection, V2Product, V2Settings, V2Strategy, V2Unit } from '@/shared/v2';
import { decide, signalIdentity } from '../alerts/alertPolicy';
import { deliver, formatAlert, type ChannelFactory } from '../alerts/notifications';
import { evaluateUnit, type UnitEvalInput } from '../engine/evaluator';
import type { V2Store } from '../persistence/V2Store';

/** Which trigger candle a connection evaluates, and the one before it. */
export interface Clock {
  triggerOpenMs: number;
  at: number;
  prevOpenMs: number | null;
  prevAt: number | null;
}

export interface CommitDeps {
  store: V2Store;
  channels: ChannelFactory;
  now: () => number;
}

export interface UnitTarget {
  connection: V2Connection;
  strategy: V2Strategy;
  product: V2Product;
  clock: Clock;
}

export interface CommitStats {
  signals: number;
  alerts: number;
  errors: ScanError[];
}

/** The unit's result on the previous trigger candle: stored when it evaluated exactly that candle, otherwise re-evaluated now. */
export function previousResult(clock: Clock, state: UnitState, input: UnitEvalInput, evaluation: UnitEvaluation): TriState | null {
  if (input.definition.evaluation.mode === 'LIVE_CANDLE') {
    const last = state.lastEvaluation;
    if (last && state.lastResult && evaluation.evaluatedAt - last.evaluatedAt <= 3 * 60_000) return state.lastResult;
    if (clock.prevOpenMs === null || clock.prevAt === null) return null;
    return evaluateUnit({ ...input, mode: 'COMPLETED_CANDLE', triggerOpenMs: clock.prevOpenMs, at: clock.prevAt }).result;
  }
  if (clock.prevOpenMs === null || clock.prevAt === null) return null;
  if (state.lastEvaluatedCandle === Math.floor(clock.prevOpenMs / 1000)) return state.lastResult;
  return evaluateUnit({ ...input, triggerOpenMs: clock.prevOpenMs, at: clock.prevAt }).result;
}

/** Decide, record and deliver one unit's evaluation. Returns the unit's next state (not yet persisted). */
export async function commitUnit(
  deps: CommitDeps,
  t: UnitTarget,
  unit: V2Unit,
  evaluation: UnitEvaluation,
  prevResult: TriState | null,
  state: UnitState,
  settings: V2Settings,
  stats: CommitStats,
): Promise<UnitState> {
  const { store } = deps;
  const { connection: c, strategy: s, product } = t;
  const d = s.definition;
  const now = deps.now();
  const policy = c.config.alert;
  const decision = decide({ policy, state, result: evaluation.result, prevResult, triggerCandle: evaluation.triggerCandle, at: t.clock.at, now, enabledAt: c.enabledAt, mode: d.evaluation.mode });

  if (decision.outcome) {
    const identity = signalIdentity({
      connectionId: c.id,
      version: s.version,
      unitKey: unit.key,
      triggerTimeframe: d.evaluation.triggerTimeframe,
      triggerCandle: evaluation.triggerCandle,
      mode: d.evaluation.mode,
      oncePerCandle: policy.oncePerCandle,
      now,
    });
    const signal = await store.signals.insert({
      identity,
      connectionId: c.id,
      strategyId: s.id,
      version: s.version,
      unitKey: unit.key,
      triggerTimeframe: d.evaluation.triggerTimeframe,
      candleTime: evaluation.triggerCandle,
      outcome: decision.outcome,
      evaluation,
    });
    if (signal) {
      stats.signals++;
      if (decision.outcome === 'ALERTED' || decision.outcome === 'NO_CHANNEL') {
        const draft = {
          signalId: signal.id,
          connectionId: c.id,
          strategyId: s.id,
          strategyName: s.name,
          version: s.version,
          productId: product.id,
          status: 'SENT' as const,
          unit,
          triggerTimeframe: d.evaluation.triggerTimeframe,
          candleTime: evaluation.triggerCandle,
          evaluation,
        };
        const alert = await store.alerts.insert(draft);
        stats.alerts++;
        if (decision.outcome === 'ALERTED') {
          const message = formatAlert(draft, { productSymbol: product.symbol, productName: product.name, legs: d.legs });
          const { deliveries, status } = await deliver(deps.channels, settings, policy.channels, message, deps.now);
          for (const del of deliveries) await store.alerts.addDelivery(alert.id, del);
          if (status !== 'SENT') await store.alerts.setStatus(alert.id, status);
          for (const del of deliveries) {
            if (del.status === 'failed') stats.errors.push({ source: `delivery:${del.channel}`, connectionId: c.id, unitKey: unit.key, message: del.error ?? 'failed' });
          }
        }
      }
    }
  }
  return { ...decision.next, lastEvaluatedCandle: evaluation.triggerCandle, lastEvaluation: evaluation };
}
