/**
 * Live-monitoring contracts between the API and the dashboard. The serverless
 * backend evaluates monitors on a schedule; the client polls these snapshots.
 */
import type { Leg, Segment, Timeframe } from './market';

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
  /** Contracts the monitor locked, per leg. Call/Put are absent for futures-only products. */
  contracts?: Partial<Record<Leg, { tradingSymbol: string; expiry: string }>>;
  /** Epoch ms of the most recent closed candle evaluated. */
  lastClosedBucket?: number | null;
  /** Epoch ms of the evaluator run that produced this snapshot. */
  evaluatedAt?: number | null;
  /** Last evaluation error for this monitor, if any. */
  lastError?: string | null;
}

/** One market's session right now. */
export interface SessionStatus {
  open: boolean;
  /** ISO time the session opens today (IST). */
  opensAt: string;
  /** ISO time the session closes today (IST). MCX: 23:30 or 23:55, following US daylight saving. */
  closesAt: string;
}

/** Health of the scheduled live evaluator, surfaced in the top bar. */
export interface LiveStatus {
  kiteConnected: boolean;
  /** NSE/BSE session open (kept for older clients; see `sessions`). */
  marketOpen: boolean;
  /** Per-market sessions: NSE/BSE 09:15–15:30, MCX 09:00–23:30/23:55 IST on weekdays. */
  sessions: Record<Segment, SessionStatus>;
  activeMonitors: number;
  /** Active monitors per market. */
  activeBySegment: Record<Segment, number>;
  /** ISO time of the last completed evaluator run. */
  lastRunAt?: string;
  lastRunSummary?: { monitors: number; alerts: number; errors: number };
  /** Server-side delivery channels enabled by the environment (e.g. "telegram"). */
  channels: string[];
}
