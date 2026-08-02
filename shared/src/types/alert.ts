/**
 * Alert types — the ONE combined alert the platform emits, plus its snapshot.
 */
import type { Timeframe } from './market.js';
import type { ScenarioId, StrategyKey } from './strategy.js';
import type { ConditionTrace } from './builder.js';

/** RSI snapshot captured at the moment the strategy triggered. */
export interface AlertSnapshot {
  futureRsi: number;
  callRsi: number;
  putRsi: number;
  futurePrevRsi?: number;
  callPrevRsi?: number;
  putPrevRsi?: number;
}

/**
 * A persisted strategy alert. Represents the strategy firing as a whole —
 * never a single-instrument (future/call/put) alert.
 */
export interface Alert {
  id: string;
  configId: string;
  underlying: string;
  expiry: string;
  strike: number;
  timeframe: Timeframe;
  /** Built-in strategy key ('rsi-sync') or a custom strategy id. */
  strategy: StrategyKey | string;
  /** Present for the built-in rsi-sync strategy (1 or 2); undefined for custom strategies. */
  scenario?: ScenarioId;
  /** Candle bucket (epoch ms) that produced the alert. */
  bucket: number;
  snapshot: AlertSnapshot;
  /** ISO timestamp the alert triggered. */
  triggeredAt: string;
  /** Display title, e.g. "NIFTY Strategy Triggered". */
  title: string;

  // ---- Custom-strategy fields (additive; undefined for built-in) ----
  /** Custom strategy id, when the alert came from a builder strategy. */
  strategyId?: string;
  /** Human-readable strategy name. */
  strategyName?: string;
  /** Matched top-level rule/branch label (the generic analogue of a scenario). */
  variant?: string;
  /** Per-condition evaluation trace explaining why the strategy fired. */
  conditions?: ConditionTrace[];
  /** Set when the monitor belongs to an underlying group. */
  groupId?: string;
  groupName?: string;
}

/** Filters accepted by the alert history endpoint. */
export interface AlertHistoryFilters {
  from?: string;
  to?: string;
  underlying?: string;
  expiry?: string;
  timeframe?: Timeframe;
  scenario?: ScenarioId;
  /** Filter to a specific custom strategy id. */
  strategyId?: string;
  /** Filter to a specific underlying group. */
  groupId?: string;
  limit?: number;
  offset?: number;
}
