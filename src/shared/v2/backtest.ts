/**
 * Backtest: "if I had traded this strategy on these products, what would I have made?" The strategy's alerts over
 * past candles, each traded exactly like a paper trade — the same plan: size, target / stop-loss / trailing stop,
 * stop and target conditions, watch window — with exits walked on the traded contract's 1-minute candles. No
 * account limit, like paper trading: every alert trades.
 *
 * Where the candles come from is decided per product (`BacktestData`): NSE / BSE products whose strategy reads
 * contracts take the index / stock from Kite and every contract from Upstox (as listed — expired ones included —
 * re-picked at every candle like the live scanner); MCX, spot-only strategies, and NSE / BSE without an Upstox
 * login run on Kite alone (today's contracts, strikes fixed at the start).
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

/**
 * Where a product's candles came from. KITE: Kite only — today's contracts, strikes fixed at the start of the period
 * (Kite has no candles for expired contracts). SPLIT: the index / stock from Kite (the prices the live scanner decides
 * on), every option and future from Upstox — as listed, expired ones included, re-picked at every candle.
 */
export type BacktestData = 'KITE' | 'SPLIT';

/**
 * Kite and Upstox compared on the same candles (exact minute) — a contract both still list, and the index / stock —
 * so a run that mixes the two shows how far apart they are.
 */
export interface BacktestDataCheck {
  productId: string;
  /** "NIFTY 50 (index), 15-minute closes" · "NIFTY 25000 CE 2026-11-10, 1-minute closes". */
  what: string;
  /** IST dates compared, inclusive. */
  from: string;
  to: string;
  /** Candles present at the same minute in both. */
  matched: number;
  /** |Kite − Upstox| ÷ Kite, % — median and largest. */
  medianDiffPct: number | null;
  maxDiffPct: number | null;
  /** Share of matched closes within one tick of each other, %. */
  withinTickPct: number | null;
  /** true: agree (BACKTEST_CHECK_RULE) · false: flagged · null: couldn't be compared (see `note`). */
  ok: boolean | null;
  note?: string;
}

/** When a check passes: the median gap at most this %, and at least this share of closes within one tick. */
export const BACKTEST_CHECK_RULE = { maxMedianDiffPct: 0.25, minWithinTickPct: 80, minMatched: 10 } as const;

export interface BacktestProduct {
  productId: string;
  /** Where its candles came from (absent = KITE). */
  data?: BacktestData;
  symbol: string;
  name: string;
  /** Alerts the strategy would have sent. */
  alerts: number;
  trades: number;
  skipped: number;
  stats: PaperStats;
  spark: number[];
  /** Contracts the legs used (KITE: fixed at the start of the period; SPLIT: every one re-picked). */
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
  /** Candle sets fetched from Kite and Upstox (the rest came from memory — an earlier run's). */
  requests: number;
  /** KITE: every product on Kite alone · SPLIT: every product index-from-Kite, contracts-from-Upstox · MIXED: some of each. Absent = KITE. */
  source?: 'KITE' | 'SPLIT' | 'MIXED';
  /** Kite vs Upstox on the same candles (SPLIT products). */
  checks?: BacktestDataCheck[];
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

/** Upstox — every contract a backtest reads on NSE / BSE (expired ones included): set up, logged in, until when. */
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
