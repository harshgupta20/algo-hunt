/**
 * Paper trading — on by default for every connection: every alert opens a simulated trade on one of the
 * strategy's legs, closed by target / stop-loss / intraday square-off / the opposite group / expiry.
 * The strategy's plan holds the defaults (and which leg each group trades); each connection can override
 * the money and exit settings. Nothing is ever sent to a broker.
 */
import { z } from 'zod';
import type { ExprNode, LegDef, LegId, StrategyDefinition, V2Instrument } from './types';

export type PaperSide = 'BUY' | 'SELL';
/** END: a backtest ended with the trade still open (closed at the last price). */
export type PaperExitReason = 'TARGET' | 'STOP' | 'SQUARE_OFF' | 'OPPOSITE' | 'EXPIRY' | 'MANUAL' | 'END';

/** What to trade when a group (or the whole strategy) fires. `leg: null` = don't trade that group. */
export interface PaperRule {
  /** Id of a top-level OR group, or null for "the whole strategy". */
  group: string | null;
  leg: LegId | null;
  side: PaperSide;
}

export interface PaperPlan {
  enabled: boolean;
  /** ₹ per trade: as many lots as fit at the entry price (at least 1). */
  cashPerTrade: number;
  rules: PaperRule[];
  /** % move from entry that closes the trade in profit / loss; null = none. */
  targetPct: number | null;
  stopPct: number | null;
  /** Close open trades at the square-off time each day (and don't open after it). */
  squareOff: boolean;
  squareOffNse: string;
  squareOffMcx: string;
  /** The other group firing closes the open trade (and opens its own). */
  exitOnOpposite: boolean;
  /** Deduct approximate Zerodha charges (brokerage, STT/CTT, exchange, SEBI, GST, stamp). */
  charges: boolean;
  /** Worse fill than the market price, each side, in %. */
  slippagePct: number;
}

export const PAPER_DEFAULTS = {
  cashPerTrade: 10_000,
  targetPct: 20,
  stopPct: 10,
  squareOff: true,
  squareOffNse: '15:20',
  squareOffMcx: '23:20',
  exitOnOpposite: true,
  charges: true,
  slippagePct: 0.5,
} as const;

/** The exit settings a trade was opened with (later plan edits don't change open trades). */
export type PaperTerms = Pick<PaperPlan, 'targetPct' | 'stopPct' | 'squareOff' | 'squareOffNse' | 'squareOffMcx' | 'exitOnOpposite' | 'charges' | 'slippagePct'>;

/** Settings a connection can change from its strategy's plan (absent = the strategy's value; null target / stop = none). */
export const PAPER_OVERRIDE_KEYS = ['enabled', 'cashPerTrade', 'targetPct', 'stopPct', 'squareOff', 'squareOffNse', 'squareOffMcx', 'exitOnOpposite', 'charges', 'slippagePct'] as const;
export type PaperOverrideKey = (typeof PAPER_OVERRIDE_KEYS)[number];
export type PaperOverride = Partial<Pick<PaperPlan, PaperOverrideKey>>;

/** The plan a connection trades with: its strategy's plan with the connection's own values on top. */
export function effectivePlan(plan: PaperPlan, override?: PaperOverride | null): PaperPlan {
  const out: PaperPlan = { ...plan };
  if (override) for (const k of PAPER_OVERRIDE_KEYS) if (override[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = override[k];
  return out;
}

/** Only the values that differ from the strategy's plan (an empty override = follow the strategy). */
export function diffOverride(plan: PaperPlan, wanted: PaperPlan): PaperOverride {
  const out: Record<string, unknown> = {};
  for (const k of PAPER_OVERRIDE_KEYS) if (wanted[k] !== plan[k]) out[k] = wanted[k];
  return out as PaperOverride;
}

export interface PaperTrade {
  id: string;
  strategyId: string;
  connectionId: string;
  productId: string;
  /** One position at a time per connection and strike shift (`shift:0`, `shift:-1` …): the ATM can move between alerts. */
  slot: string;
  /** The unit (contracts) the alert fired on. */
  unitKey: string;
  alertId: string | null;
  /** Group that fired (id + label), null = whole strategy. */
  group: string | null;
  groupLabel?: string;
  leg: LegId;
  side: PaperSide;
  instrument: V2Instrument;
  lots: number;
  lotSize: number;
  quantity: number;
  cashPerTrade: number;
  /** Money the trade ties up: premium × quantity for bought options and stocks, estimated margin for futures and sold options. */
  capitalUsed: number;
  /** capitalUsed is an estimated margin (futures, sold options). */
  marginEstimated: boolean;
  /** One lot needed more than the cash per trade (1 lot taken anyway). */
  overBudget: boolean;
  entryAt: string;
  /** Market price when the alert went out. */
  entryRef: number;
  /** Filled price (with slippage). */
  entryPrice: number;
  targetPrice: number | null;
  stopPrice: number | null;
  terms: PaperTerms;
  status: 'OPEN' | 'CLOSED';
  lastPrice: number | null;
  lastPriceAt: string | null;
  exitAt: string | null;
  exitPrice: number | null;
  exitReason: PaperExitReason | null;
  grossPnl: number | null;
  charges: number | null;
  netPnl: number | null;
  /** Open trades in API responses: P&L if closed at the last price now (after slippage and charges). */
  openPnl?: number;
}

export interface PaperStats {
  trades: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  grossPnl: number;
  charges: number;
  netPnl: number;
  /** Open trades at their last price (after estimated charges). */
  unrealizedPnl: number;
  avgPnl: number | null;
  best: number | null;
  worst: number | null;
  /** Most money in use at the same time (all open trades together) — what the account would have needed. */
  capitalPeak: number;
  /** Net P&L ÷ capitalPeak, %. */
  returnPct: number | null;
  /** Largest fall of cumulative net P&L from a previous high (₹, ≤ 0). */
  maxDrawdown: number;
  overBudget: number;
  /** Money won ÷ money lost on closed trades (null when nothing was lost). */
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** Net P&L of trades closed today (IST). */
  todayPnl: number;
  lastExitAt: string | null;
}

/** Stats with nothing traded (also fills fields an older server didn't send). */
export const EMPTY_PAPER_STATS: PaperStats = {
  trades: 0,
  open: 0,
  wins: 0,
  losses: 0,
  winRate: null,
  grossPnl: 0,
  charges: 0,
  netPnl: 0,
  unrealizedPnl: 0,
  avgPnl: null,
  best: null,
  worst: null,
  capitalPeak: 0,
  returnPct: null,
  maxDrawdown: 0,
  overBudget: 0,
  profitFactor: null,
  avgWin: null,
  avgLoss: null,
  todayPnl: 0,
  lastExitAt: null,
};

/** A summary with every field present (defaults for anything missing). */
export function normalizePaperSummary(s: Partial<PaperSummary>): PaperSummary {
  const st = (x?: Partial<PaperStats>): PaperStats => ({ ...EMPTY_PAPER_STATS, ...(x ?? {}) });
  return {
    from: s.from ?? null,
    overall: st(s.overall),
    strategies: (s.strategies ?? []).map((x) => ({ ...x, connections: x.connections ?? 0, spark: x.spark ?? [], stats: st(x.stats) })),
    connections: (s.connections ?? []).map((c) => ({
      ...c,
      strategyName: c.strategyName ?? '',
      switchedOn: c.switchedOn ?? true,
      paper: c.paper ?? { enabled: true, cashPerTrade: PAPER_DEFAULTS.cashPerTrade, targetPct: PAPER_DEFAULTS.targetPct, stopPct: PAPER_DEFAULTS.stopPct, squareOff: true, custom: false },
      spark: c.spark ?? [],
      stats: st(c.stats),
    })),
    equity: s.equity ?? [],
    daily: s.daily ?? [],
    reasons: s.reasons ?? [],
    hours: s.hours ?? [],
  };
}

/** A connection's paper settings as shown in results (its effective plan). */
export interface PaperSettingsBrief {
  enabled: boolean;
  cashPerTrade: number;
  targetPct: number | null;
  stopPct: number | null;
  squareOff: boolean;
  /** The connection has its own values (not only the strategy's). */
  custom: boolean;
}

export interface PaperSummary {
  /** Trades entered on or after this IST date (null = all). */
  from: string | null;
  overall: PaperStats;
  strategies: Array<{ strategyId: string; name: string; enabled: boolean; cashPerTrade: number; connections: number; stats: PaperStats; spark: number[] }>;
  /** Every connection with trades in the period or switched on (so none is missed). */
  connections: Array<{ connectionId: string; strategyId: string; strategyName: string; productId: string; symbol: string; switchedOn: boolean; paper: PaperSettingsBrief; stats: PaperStats; spark: number[] }>;
  /** Cumulative net P&L after each closed trade (oldest first). */
  equity: Array<{ at: string; pnl: number }>;
  /** Net P&L per IST day of the exit (oldest first). */
  daily: Array<{ date: string; pnl: number; trades: number; wins: number }>;
  /** How trades closed. */
  reasons: Array<{ reason: PaperExitReason; trades: number; pnl: number }>;
  /** Closed trades by the IST hour they were entered. */
  hours: Array<{ hour: number; trades: number; pnl: number; wins: number }>;
}

// ---- defaults ---------------------------------------------------------------------------------

function legsIn(n: ExprNode, out = new Set<LegId>()): Set<LegId> {
  switch (n.type) {
    case 'AND':
    case 'OR':
      n.children.forEach((c) => legsIn(c, out));
      break;
    case 'NOT':
      legsIn(n.child, out);
      break;
    case 'PATTERN':
      out.add(n.series.leg);
      break;
    case 'CONDITION':
      for (const o of [n.left, n.right]) if (o.kind !== 'CONSTANT') out.add(o.series.leg);
  }
  return out;
}

/** The leg a group most naturally trades: its option leg (CE / PE), else its future, else spot. */
export function naturalLeg(legs: LegDef[], node: ExprNode): LegId | null {
  const used = legs.filter((l) => legsIn(node).has(l.id));
  const pick = used.find((l) => l.kind === 'CE' || l.kind === 'PE') ?? used.find((l) => l.kind === 'FUT') ?? used[0] ?? legs[0];
  return pick?.id ?? null;
}

/** Top-level groups that can fire on their own (children of a root OR), or none. */
export function paperGroups(d: StrategyDefinition): Array<{ id: string; label: string; node: ExprNode }> {
  const root = d.expression;
  if (root.type !== 'OR' || root.children.length < 2) return [];
  return root.children.map((c, i) => ({ id: c.id, label: ('label' in c && c.label) || `Group ${i + 1}`, node: c }));
}

/** Rules for the strategy as it is now: one per top-level group (kept where already set), else one for the whole strategy. */
export function resolveRules(d: StrategyDefinition, rules: PaperRule[] = []): PaperRule[] {
  const groups = paperGroups(d);
  const legOk = (leg: LegId | null) => leg === null || d.legs.some((l) => l.id === leg);
  if (!groups.length) {
    const cur = rules.find((r) => r.group === null);
    return [cur && legOk(cur.leg) ? cur : { group: null, leg: naturalLeg(d.legs, d.expression), side: 'BUY' }];
  }
  return groups.map((g) => {
    const cur = rules.find((r) => r.group === g.id);
    return cur && legOk(cur.leg) ? cur : { group: g.id, leg: naturalLeg(d.legs, g.node), side: 'BUY' };
  });
}

/** A new plan with the preferred settings (on, ₹10,000 per trade, +20 % / −10 %, square-off 15:20 / 23:20). */
export function defaultPaperPlan(d: StrategyDefinition, enabled = true): PaperPlan {
  return { enabled, ...PAPER_DEFAULTS, rules: resolveRules(d) };
}

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time as HH:MM');

const overrideShape = {
  enabled: z.boolean().optional(),
  cashPerTrade: z.number().min(100).max(1e9).optional(),
  targetPct: z.number().gt(0).max(1000).nullable().optional(),
  stopPct: z.number().gt(0).max(100).nullable().optional(),
  squareOff: z.boolean().optional(),
  squareOffNse: clock.optional(),
  squareOffMcx: clock.optional(),
  exitOnOpposite: z.boolean().optional(),
  charges: z.boolean().optional(),
  slippagePct: z.number().min(0).max(10).optional(),
};
export const paperOverrideSchema = z.object(overrideShape).strict() as unknown as z.ZodType<PaperOverride>;

export const paperPlanSchema = z.object({
  enabled: z.boolean(),
  cashPerTrade: z.number().min(100).max(1e9),
  rules: z.array(z.object({ group: z.string().nullable(), leg: z.enum(['A', 'B', 'C', 'D']).nullable(), side: z.enum(['BUY', 'SELL']) })).max(8),
  targetPct: z.number().gt(0).max(1000).nullable(),
  stopPct: z.number().gt(0).max(100).nullable(),
  squareOff: z.boolean(),
  squareOffNse: clock,
  squareOffMcx: clock,
  exitOnOpposite: z.boolean(),
  charges: z.boolean(),
  slippagePct: z.number().min(0).max(10),
}) as z.ZodType<PaperPlan>;
