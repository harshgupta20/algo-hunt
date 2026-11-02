/**
 * Backtest: "if I had traded this strategy on these products, what would I have made?" The strategy's alerts over
 * past candles (as Compare finds them), each traded exactly like a paper trade — the same plan: size, target /
 * stop-loss / trailing stop, stop and target conditions, watch window — with exits walked on the traded contract's
 * 1-minute candles. No account limit, like paper trading: every alert trades.
 */
import { z } from 'zod';
import type { PaperPlan, PaperStats, PaperSummary, PaperTrade } from './paper';
import { paperPlanSchema } from './paper';
import type { ExpirySelector, Timeframe } from './types';

export interface BacktestRequest {
  strategyId: string;
  products: string[];
  /** IST dates, inclusive. */
  from: string;
  to: string;
  /** The trade plan — the strategy's paper plan, maybe changed for this test (`enabled` is ignored). */
  plan: PaperPlan;
  expiry?: ExpirySelector;
  strikeShift?: number;
  trigger?: 'ON_TRANSITION' | 'WHILE_TRUE';
  cooldownMinutes?: number | null;
}

export interface BacktestSkip {
  productId: string;
  at: string;
  reason: string;
}

export interface BacktestProduct {
  productId: string;
  symbol: string;
  name: string;
  /** Alerts the strategy would have sent. */
  alerts: number;
  trades: number;
  skipped: number;
  stats: PaperStats;
  spark: number[];
  /** Contracts the legs used (Backtest: fixed at the start of the period; Options backtest: every one re-picked). */
  contracts: string[];
  notes: string[];
  errors: string[];
}

export interface BacktestResult {
  strategyId: string;
  strategyName: string;
  from: string;
  to: string;
  triggerTimeframe: Timeframe;
  summary: PaperSummary;
  products: BacktestProduct[];
  /** Simulated trades, newest first. */
  trades: PaperTrade[];
  skipped: BacktestSkip[];
  /** Candle sets fetched from Kite (the rest came from memory — an earlier run's). */
  requests: number;
  /** Where the candles came from: Kite (today's contracts, the Backtest) or Upstox (expired contracts, the Options backtest). Absent = Kite. */
  source?: 'KITE' | 'UPSTOX';
  notes: string[];
}

/**
 * A backtest running in the background (memory only): candles are fetched product by product through Kite's
 * request queue — any number of products, any period, the cost is only waiting — then every alert is traded.
 */
export interface BacktestJob {
  id: string;
  strategyId: string;
  strategyName: string;
  status: 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  /** Epoch ms. */
  startedAt: number;
  finishedAt: number | null;
  /** CANDLES: fetching candles and finding alerts, product by product. TRADES: trading the alerts minute by minute. */
  phase: 'CANDLES' | 'TRADES';
  /** Products finished / in the test. */
  done: number;
  total: number;
  /** Symbol of the product being fetched. */
  current: string | null;
  /** Candle sets fetched from Kite so far, and answered from memory (an earlier run's). */
  fetched: number;
  cached: number;
  /** Estimated seconds left (null until the first products finish). */
  etaSeconds: number | null;
  error: string | null;
  /** What was asked — the page restores its form from it. */
  request: BacktestRequest;
  /** When DONE. */
  result?: BacktestResult;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const backtestRequestSchema = z.object({
  strategyId: z.string().min(1),
  products: z.array(z.string().min(1)).min(1),
  from: isoDate,
  to: isoDate,
  plan: paperPlanSchema,
  expiry: z.union([z.object({ mode: z.enum(['CURRENT', 'NEXT', 'FAR']) }), z.object({ mode: z.literal('SPECIFIC'), date: isoDate })]).optional(),
  strikeShift: z.number().int().min(-10).max(10).optional(),
  trigger: z.enum(['ON_TRANSITION', 'WHILE_TRUE']).optional(),
  cooldownMinutes: z.number().min(0).max(1440).nullable().optional(),
}) as unknown as z.ZodType<BacktestRequest>;

/** The Options backtest's history (Upstox): set up, logged in, until when. */
export interface OptionsSourceStatus {
  source: 'UPSTOX';
  /** The server has its keys (UPSTOX_API_KEY, UPSTOX_API_SECRET, UPSTOX_REDIRECT_URI). */
  configured: boolean;
  connected: boolean;
  userId?: string;
  userName?: string;
  /** When the login stops working (03:30 IST). */
  expiresAt?: string;
  lastError?: string;
}

/** Longest Compare span (calendar days) per trigger timeframe (it answers in one request). Backtests have no limit. */
export const COMPARE_MAX_DAYS: Record<Timeframe, number> = {
  '1m': 2,
  '3m': 5,
  '5m': 7,
  '10m': 10,
  '15m': 20,
  '30m': 30,
  '1h': 60,
  '2h': 90,
  '4h': 120,
  '1d': 365,
  '1w': 730,
};
