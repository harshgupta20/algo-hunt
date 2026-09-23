/**
 * Live-monitoring contracts between the API and the dashboard. The serverless
 * backend evaluates monitors on a schedule; the client polls these snapshots.
 */
import type { Leg, Timeframe } from './market';

/** Per-leg RSI reading shown on the dashboard gauges. */
export interface LegRsiReading {
  /** Provisional RSI including the forming candle (null during warm-up). */
  rsi: number | null;
  /** RSI as of the last closed candle — what strategy decisions use. */
  closedRsi?: number | null;
  /** Last traded price (close of the latest candle). */
  ltp?: number | null;
  level: number;
}

export type LegRsiSnapshot = Record<Leg, LegRsiReading>;

/** Snapshot of one active configuration (for the dashboard/API). */
export interface ConfigRuntimeSnapshot {
  configId: string;
  underlying: string;
  timeframe: Timeframe;
  strategy?: string;
  strike: number;
  expiry: string;
  legs: LegRsiSnapshot;
  /** Epoch ms of the most recent closed candle evaluated. */
  lastClosedBucket?: number | null;
  /** Epoch ms of the evaluator run that produced this snapshot. */
  evaluatedAt?: number | null;
  /** Last evaluation error for this monitor, if any. */
  lastError?: string | null;
}

/** Health of the scheduled live evaluator, surfaced in the top bar. */
export interface LiveStatus {
  kiteConnected: boolean;
  marketOpen: boolean;
  activeMonitors: number;
  /** ISO time of the last completed evaluator run. */
  lastRunAt?: string;
  lastRunSummary?: { monitors: number; alerts: number; errors: number };
  /** Server-side delivery channels enabled by the environment (e.g. "telegram"). */
  channels: string[];
}
