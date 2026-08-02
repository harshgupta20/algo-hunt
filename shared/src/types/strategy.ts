/**
 * Strategy-engine domain types. The engine is pluggable: every strategy
 * implements the same evaluate() contract and returns a StrategyMatch or null.
 */
import type { Leg, Timeframe } from './market.js';

/** Registered strategy identifiers. */
export type StrategyKey = 'rsi-sync';

/** Scenario within a strategy that produced a match. */
export type ScenarioId = 1 | 2;

/** Direction of an RSI level interaction. */
export type Direction = 'above' | 'below';

/**
 * A pair of consecutive closed-candle RSI values for one instrument.
 * `prev` is undefined until at least two RSI values exist (warmup).
 */
export interface RsiReading {
  prev?: number;
  curr: number;
}

/** Tunable parameters for the RSI-sync strategy. */
export interface RsiSyncParams {
  rsiPeriod: number;
  futureLevel: number;
  callLevel: number;
  putLevel: number;
}

/** Default parameters for the RSI-sync strategy. */
export const DEFAULT_RSI_SYNC_PARAMS: RsiSyncParams = {
  rsiPeriod: 14,
  futureLevel: 60,
  callLevel: 60,
  putLevel: 40,
};

/** Per-leg RSI readings supplied to a strategy on evaluation. */
export type LegReadings = Record<Leg, RsiReading>;

/** Input context handed to a strategy's evaluate(). */
export interface StrategyContext {
  timeframe: Timeframe;
  /** Candle bucket (epoch ms) all three readings belong to. */
  bucket: number;
  readings: LegReadings;
  params: RsiSyncParams;
}

/** Result of a successful strategy evaluation. */
export interface StrategyMatch {
  strategy: StrategyKey;
  scenario: ScenarioId;
  bucket: number;
  /** Human-readable one-line reason, e.g. for logs. */
  reason: string;
  readings: LegReadings;
}

/** Static, user-facing description of a strategy (for the Strategies page). */
export interface StrategyDefinition {
  key: StrategyKey;
  name: string;
  description: string;
  scenarios: Array<{ id: ScenarioId; title: string; description: string }>;
  defaultParams: RsiSyncParams;
}

/** The pluggable strategy contract. */
export interface Strategy {
  readonly definition: StrategyDefinition;
  evaluate(ctx: StrategyContext): StrategyMatch | null;
}
