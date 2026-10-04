/**
 * Backtest: "if I had traded this strategy on these products with this money, what would I have made?"
 * The strategy's alerts over past candles (as Compare finds them), each traded like a paper trade, with
 * exits walked on the traded contract's 1-minute candles; money limited by a starting capital.
 */
import { z } from 'zod';
import type { PaperPlan, PaperStats, PaperSummary, PaperTrade } from './paper';
import { paperPlanSchema } from './paper';
import { exprNode } from './schema';
import type { ExprNode, ExpirySelector, Timeframe } from './types';

/**
 * Close a trade when a condition comes true — e.g. "RSI crossed below 40 OR close crossed below the 3-candle low".
 * One per trade rule (`group` as in PaperRule; null = the strategy without groups). Checked at every close of the
 * smallest timeframe the condition uses; the trade exits at that candle's close (target, stop-loss, square-off and
 * the rest still apply, whichever comes first).
 */
export interface BacktestExitRule {
  group: string | null;
  when: ExprNode;
}

export interface BacktestRequest {
  strategyId: string;
  products: string[];
  /** IST dates, inclusive. */
  from: string;
  to: string;
  /** Cash per trade, what each group trades, exits and costs (`enabled` is ignored). */
  plan: PaperPlan;
  /** Starting money; a trade that doesn't fit in what's free is skipped. null = no limit. */
  capital: number | null;
  expiry?: ExpirySelector;
  strikeShift?: number;
  trigger?: 'ON_TRANSITION' | 'WHILE_TRUE';
  cooldownMinutes?: number | null;
  /** Exit conditions per trade rule (none = target / stop-loss / square-off … only). */
  exits?: BacktestExitRule[];
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
  /** Contracts the legs used (fixed at the start of the period). */
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
  capital: number | null;
  /** Capital + net P&L. */
  finalCapital: number | null;
  returnOnCapitalPct: number | null;
  /** The lowest the account went (capital + worst cumulative P&L). */
  lowestCapital: number | null;
  summary: PaperSummary;
  products: BacktestProduct[];
  /** Simulated trades, newest first. */
  trades: PaperTrade[];
  skipped: BacktestSkip[];
  requests: number;
  notes: string[];
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const backtestRequestSchema = z.object({
  strategyId: z.string().min(1),
  products: z.array(z.string().min(1)).min(1).max(20),
  from: isoDate,
  to: isoDate,
  plan: paperPlanSchema,
  capital: z.number().min(1_000).max(1e10).nullable(),
  expiry: z.union([z.object({ mode: z.enum(['CURRENT', 'NEXT', 'FAR']) }), z.object({ mode: z.literal('SPECIFIC'), date: isoDate })]).optional(),
  strikeShift: z.number().int().min(-10).max(10).optional(),
  trigger: z.enum(['ON_TRANSITION', 'WHILE_TRUE']).optional(),
  cooldownMinutes: z.number().min(0).max(1440).nullable().optional(),
  exits: z.array(z.object({ group: z.string().nullable(), when: exprNode })).max(8).optional(),
}) as z.ZodType<BacktestRequest>;

export const BACKTEST_DEFAULT_CAPITAL = 100_000;

/** Longest Compare / Backtest span (calendar days) per trigger timeframe (Kite candle limits + request time). */
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
