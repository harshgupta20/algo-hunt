/**
 * Paper trading — on by default for every connection: every alert opens a simulated trade on one of the
 * strategy's legs, closed by target / stop-loss / trailing stop / a trailing rule / intraday square-off / the
 * opposite group / expiry. With "Trailing SL" on the target doesn't close the trade: it is where the trailing rules
 * start, and from there the stop-loss and target no longer apply (see `trailing`). The strategy's plan holds the defaults (and what each group
 * trades, with its conditions); each connection can override the money, exit and watch settings. The
 * backtests trade the same plan. Nothing is ever sent to a broker.
 */
import { z } from 'zod';
import { exprNode } from './schema';
import type { AlertSide, ExprNode, ExprTrace, LegDef, LegId, Market, StrategyDefinition, Timeframe, V2Instrument } from './types';
import type { TradePath } from './story';

export type PaperSide = 'BUY' | 'SELL';
/**
 * TRAIL: the trailing stop-loss. STOP_RULE: one of the group's trailing rules came true. TARGET_RULE: a target
 * condition (a setting since removed — older trades only). END: a backtest ended with the trade still open (closed
 * at the last price).
 */
export type PaperExitReason = 'TARGET' | 'STOP' | 'TRAIL' | 'STOP_RULE' | 'TARGET_RULE' | 'SQUARE_OFF' | 'OPPOSITE' | 'EXPIRY' | 'MANUAL' | 'END';

/** What to trade when a group (or the whole strategy) fires. `leg: null` = don't trade that group. */
export interface PaperRule {
  /** Id of a top-level OR group, or null for "the whole strategy". */
  group: string | null;
  leg: LegId | null;
  side: PaperSide;
  /**
   * Trailing rules: close the trade when this comes true — an AND / OR condition tree on any of the strategy's legs
   * (e.g. "close crossed below SMA 20", "close below the previous candle's low"). Checked from the target on (from
   * the entry when there is no target), at every close of the smallest timeframe it uses; the trade exits at that
   * close. Absent / null = none.
   */
  stopWhen?: ExprNode | null;
}

export interface PaperPlan {
  enabled: boolean;
  /** Futures and options: lots per trade, at each contract's own lot size. */
  lotsPerTrade: number;
  /** Stocks (Spot legs): ₹ per trade — as many shares as fit at the entry price (at least 1). */
  cashPerTrade: number;
  rules: PaperRule[];
  /**
   * % move from entry for the target / the stop-loss; null = none. Without trailing they close the trade; with
   * `trailing` the target is where trailing starts (required then), and from there neither applies.
   */
  targetPct: number | null;
  stopPct: number | null;
  /** Trailing SL on: the target starts the trailing rules (the rules' `stopWhen`, at least one) instead of closing the trade. */
  trailing: boolean;
  /**
   * Watch only between these times (IST, per market): trigger candles that don't lie inside send no alert and open
   * no trade — open trades are still managed (stops, target, square-off). Intraday timeframes only.
   */
  watch: boolean;
  watchNseFrom: string;
  watchNseTo: string;
  watchMcxFrom: string;
  watchMcxTo: string;
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
  lotsPerTrade: 1,
  cashPerTrade: 10_000,
  targetPct: 20,
  stopPct: 10,
  trailing: false,
  watch: false,
  watchNseFrom: '09:15',
  watchNseTo: '15:00',
  watchMcxFrom: '09:00',
  watchMcxTo: '23:00',
  squareOff: true,
  squareOffNse: '15:20',
  squareOffMcx: '23:20',
  exitOnOpposite: true,
  charges: true,
  slippagePct: 0.5,
} as const;

/**
 * The exit settings a trade was opened with (later plan edits don't change open trades). `trailPct`: a trailing stop %
 * — only on trades opened while plans had one (2026-11-03 / 04); it still trails them.
 */
export type PaperTerms = Pick<PaperPlan, 'targetPct' | 'stopPct' | 'squareOff' | 'squareOffNse' | 'squareOffMcx' | 'exitOnOpposite' | 'charges' | 'slippagePct'> & { trailPct?: number | null };

/** Settings a connection can change from its strategy's plan (absent = the strategy's value; null target / stop = none). */
export const PAPER_OVERRIDE_KEYS = [
  'enabled',
  'lotsPerTrade',
  'cashPerTrade',
  'targetPct',
  'stopPct',
  'trailing',
  'watch',
  'watchNseFrom',
  'watchNseTo',
  'watchMcxFrom',
  'watchMcxTo',
  'squareOff',
  'squareOffNse',
  'squareOffMcx',
  'exitOnOpposite',
  'charges',
  'slippagePct',
] as const;
export type PaperOverrideKey = (typeof PAPER_OVERRIDE_KEYS)[number];
export type PaperOverride = Partial<Pick<PaperPlan, PaperOverrideKey>>;

/** A saved plan with every field — one saved before a field existed gets its default. */
export function normalizePlan(plan: PaperPlan): PaperPlan {
  const out = { ...PAPER_DEFAULTS, ...plan };
  // Target conditions were removed (2026-11-04): the target is where trailing starts instead.
  if (out.rules.some((r) => 'targetWhen' in r)) out.rules = out.rules.map(({ targetWhen: _t, ...r }: PaperRule & { targetWhen?: unknown }) => r);
  // Before the Trailing SL switch (2026-11-04) trailing rules switched trailing on; the trailing % was removed.
  if (!('trailing' in plan)) out.trailing = planConditions(out.rules).length > 0;
  if ('trailPct' in out) delete (out as { trailPct?: unknown }).trailPct;
  return out;
}

/** The plan a connection trades with: its strategy's plan with the connection's own values on top. */
export function effectivePlan(plan: PaperPlan, override?: PaperOverride | null): PaperPlan {
  const out: PaperPlan = normalizePlan(plan);
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
  /** The plan's ₹ per trade (what a stock trade was sized on). */
  cashPerTrade: number;
  /** Money the trade ties up: premium × quantity for bought options and stocks, estimated margin for futures and sold options. */
  capitalUsed: number;
  /** capitalUsed is an estimated margin (futures, sold options). */
  marginEstimated: boolean;
  /** A stock trade: one share needed more than the cash per trade (1 taken anyway). Futures / options are sized in lots — never over. */
  overBudget: boolean;
  entryAt: string;
  /** Market price when the alert went out. */
  entryRef: number;
  /** Filled price (with slippage). */
  entryPrice: number;
  targetPrice: number | null;
  /** The fixed stop-loss (a trailing stop follows peakPrice — see the server's stopNow). */
  stopPrice: number | null;
  /** Best price since entry — the highest for a buy, the lowest for a sell; what a trailing stop follows. */
  peakPrice?: number;
  /** When the price reached the target and trailing started (trades that trail past their target). */
  trailingAt?: string;
  /** The group's trailing rules the trade was opened with, and the legs (contracts) they are checked on. */
  conditions?: PaperConditions;
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
  /** Backtest trades: the price path the trade was walked on — what its story shows (paper trades read it from Kite when asked). */
  path?: TradePath;
}

export interface PaperConditions {
  stopWhen?: ExprNode;
  /** The strategy's legs and the contracts of the unit the trade opened on. */
  legDefs: LegDef[];
  legs: Partial<Record<LegId, V2Instrument | null>>;
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

const BRIEF_DEFAULTS: PaperSettingsBrief = {
  enabled: true,
  lotsPerTrade: PAPER_DEFAULTS.lotsPerTrade,
  cashPerTrade: PAPER_DEFAULTS.cashPerTrade,
  targetPct: PAPER_DEFAULTS.targetPct,
  stopPct: PAPER_DEFAULTS.stopPct,
  trailing: PAPER_DEFAULTS.trailing,
  squareOff: true,
  custom: false,
};

/** A summary with every field present (defaults for anything missing). */
export function normalizePaperSummary(s: Partial<PaperSummary>): PaperSummary {
  const st = (x?: Partial<PaperStats>): PaperStats => ({ ...EMPTY_PAPER_STATS, ...(x ?? {}) });
  return {
    from: s.from ?? null,
    overall: st(s.overall),
    strategies: (s.strategies ?? []).map((x) => ({ ...x, lotsPerTrade: x.lotsPerTrade ?? PAPER_DEFAULTS.lotsPerTrade, connections: x.connections ?? 0, spark: x.spark ?? [], stats: st(x.stats) })),
    connections: (s.connections ?? []).map((c) => ({
      ...c,
      strategyName: c.strategyName ?? '',
      switchedOn: c.switchedOn ?? true,
      paper: { ...BRIEF_DEFAULTS, ...c.paper },
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
  lotsPerTrade: number;
  cashPerTrade: number;
  targetPct: number | null;
  stopPct: number | null;
  trailing: boolean;
  squareOff: boolean;
  /** The connection has its own values (not only the strategy's). */
  custom: boolean;
}

export interface PaperSummary {
  /** Trades entered on or after this IST date (null = all). */
  from: string | null;
  overall: PaperStats;
  strategies: Array<{ strategyId: string; name: string; enabled: boolean; lotsPerTrade: number; cashPerTrade: number; connections: number; stats: PaperStats; spark: number[] }>;
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

/** Call or put of an evaluation: the option leg the fired group trades (CE → CALL, PE → PUT), else FUT. */
export function alertSide(d: StrategyDefinition, trace: ExprTrace): AlertSide {
  const groups = paperGroups(d);
  const fired = groups.find((g) => trace.children?.some((c) => c.id === g.id && c.result === 'TRUE')) ?? groups[0];
  const leg = d.legs.find((l) => l.id === naturalLeg(d.legs, fired?.node ?? d.expression));
  return leg?.kind === 'CE' ? 'CALL' : leg?.kind === 'PE' ? 'PUT' : 'FUT';
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

/** A new plan with the preferred settings (on, 1 lot / ₹10,000 per trade, +20 % / −10 %, square-off 15:20 / 23:20). */
export function defaultPaperPlan(d: StrategyDefinition, enabled = true): PaperPlan {
  return { enabled, ...PAPER_DEFAULTS, rules: resolveRules(d) };
}

/** How a plan sizes trades on these rules' legs: lots (futures / options) and / or ₹ (stocks — Spot legs). */
export function planSizing(d: Pick<StrategyDefinition, 'legs'>, rules: PaperRule[]): { lots: boolean; cash: boolean } {
  const kinds = rules.filter((r) => r.leg).map((r) => d.legs.find((l) => l.id === r.leg)?.kind);
  return { lots: kinds.some((k) => k && k !== 'SPOT'), cash: kinds.some((k) => k === 'SPOT') };
}

// ---- stops ------------------------------------------------------------------------------------

/** Nearest multiple of the contract's tick (0.05 when unknown), in paise. */
const nearTick = (n: number, tick: number) => {
  const t = tick > 0 ? tick : 0.05;
  return Math.round(Math.round(n / t) * t * 100) / 100;
};

type TrailFields = Pick<PaperTrade, 'side' | 'entryPrice' | 'peakPrice' | 'targetPrice' | 'terms' | 'conditions'>;

/** The trade trails past its target (opened with Trailing SL on: trailing rules — or an older trade's trailing % — and a target) — reaching the target starts trailing instead of closing it. */
export function trailsPastTarget(t: Pick<PaperTrade, 'targetPrice' | 'terms' | 'conditions'>): boolean {
  return t.targetPrice !== null && ((t.terms.trailPct ?? null) !== null || hasCondition(t.conditions?.stopWhen));
}

/** The price is at or past the trade's target. */
export function atTarget(t: Pick<PaperTrade, 'side' | 'targetPrice'>, price: number): boolean {
  return t.targetPrice !== null && (t.side === 'BUY' ? price >= t.targetPrice : price <= t.targetPrice);
}

/** Trailing is on: no target to wait for, or the price reached it (the best price since entry is at or past it). */
export function trailing(t: TrailFields): boolean {
  return t.targetPrice === null || atTarget(t, t.peakPrice ?? t.entryPrice);
}

/** An older trade's trailing stop % level now (trades opened while plans had one) — null without one, or while the trade waits for its target. */
export function trailLevel(t: Pick<PaperTrade, 'side' | 'entryPrice' | 'peakPrice' | 'targetPrice' | 'terms' | 'conditions' | 'instrument'>): number | null {
  const pct = t.terms.trailPct ?? null;
  if (pct === null || !trailing(t)) return null;
  const peak = t.peakPrice ?? t.entryPrice;
  return nearTick(peak * (t.side === 'BUY' ? 1 - pct / 100 : 1 + pct / 100), t.instrument.tickSize);
}

/**
 * The stop a trade has now. Waiting for its target: the fixed stop-loss. Past the target (Trailing SL): none — the
 * stop-loss no longer applies and the trailing rules close it (an older trade's trailing % stop, when it has one).
 * Older trades without a target that trail by % from the entry: the tighter of the two (the fixed one on a tie).
 */
export function stopNow(t: Pick<PaperTrade, 'side' | 'entryPrice' | 'peakPrice' | 'targetPrice' | 'terms' | 'conditions' | 'instrument' | 'stopPrice'>): { price: number; reason: 'STOP' | 'TRAIL' } | null {
  const trail = trailLevel(t);
  if (trailsPastTarget(t) && trailing(t)) return trail === null ? null : { price: trail, reason: 'TRAIL' };
  const fixed = t.stopPrice;
  if (trail === null) return fixed === null ? null : { price: fixed, reason: 'STOP' };
  if (fixed === null) return { price: trail, reason: 'TRAIL' };
  const tighter = t.side === 'BUY' ? trail > fixed : trail < fixed;
  return tighter ? { price: trail, reason: 'TRAIL' } : { price: fixed, reason: 'STOP' };
}

/** A condition tree with something in it (an empty AND / OR = none). */
export function hasCondition(n: ExprNode | null | undefined): n is ExprNode {
  return !!n && !((n.type === 'AND' || n.type === 'OR') && !n.children.length);
}

/** Key of a rule's trailing rules: `<group or *>|STOP`. */
export const conditionKey = (group: string | null) => `${group ?? '*'}|STOP`;

/** The trailing rules of the rules that trade (kept while Trailing SL is off — see `trailingRules`). */
export function planConditions(rules: PaperRule[]): Array<{ key: string; group: string | null; when: ExprNode }> {
  return rules.flatMap((r) => (r.leg && hasCondition(r.stopWhen) ? [{ key: conditionKey(r.group), group: r.group, when: r.stopWhen }] : []));
}

/** The trailing rules a plan trades with: none while Trailing SL is off. */
export function trailingRules(plan: Pick<PaperPlan, 'trailing' | 'rules'>) {
  return plan.trailing ? planConditions(plan.rules) : [];
}

/** Trailing SL on without a target to start it, or without a trailing rule to trail by. */
export function trailingIssue(p: Pick<PaperPlan, 'trailing' | 'targetPct' | 'rules'>): string | null {
  if (!p.trailing) return null;
  if (p.targetPct === null) return 'Trailing SL starts at the target — set a target (or switch Trailing SL off).';
  if (!planConditions(p.rules).length) return 'Trailing SL needs at least one trailing rule (Trailing rules, in the strategy’s trade plan).';
  return null;
}

// ---- watch window -----------------------------------------------------------------------------

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const clockMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
/** Minutes after IST midnight of a moment. */
const istMinute = (ms: number) => Math.floor((((ms + IST_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60_000);

/** A market's watch window as the plan has it ('HH:MM' from / to), or null when the plan watches the whole session. */
export function watchWindow(plan: Pick<PaperPlan, 'watch' | 'watchNseFrom' | 'watchNseTo' | 'watchMcxFrom' | 'watchMcxTo'>, market: Market): { from: string; to: string } | null {
  if (!plan.watch) return null;
  return market === 'MCX' ? { from: plan.watchMcxFrom, to: plan.watchMcxTo } : { from: plan.watchNseFrom, to: plan.watchNseTo };
}

/**
 * Whether a trigger candle is watched: it opens at or after `from` and closes by `to` (IST) — e.g. 09:30–15:00 on
 * 15-minute candles watches 09:30 … 14:45 (closing 15:00). Live-candle mode passes the moment for both. Daily and
 * weekly candles span the whole session, so the window doesn't apply to them.
 */
export function inWatchWindow(w: { from: string; to: string } | null, tf: Timeframe, openMs: number, closeMs: number): boolean {
  if (!w || tf === '1d' || tf === '1w') return true;
  const close = istMinute(closeMs - 1) + 1; // a candle closing 15:00 ends in minute 14:59
  return istMinute(openMs) >= clockMin(w.from) && close <= clockMin(w.to);
}

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time as HH:MM');
const lots = z.number().int().min(1).max(1_000);
const cash = z.number().min(100).max(1e9);
const target = z.number().gt(0).max(1000).nullable();
const stop = z.number().gt(0).max(100).nullable();

const overrideShape = {
  enabled: z.boolean().optional(),
  lotsPerTrade: lots.optional(),
  cashPerTrade: cash.optional(),
  targetPct: target.optional(),
  stopPct: stop.optional(),
  trailing: z.boolean().optional(),
  watch: z.boolean().optional(),
  watchNseFrom: clock.optional(),
  watchNseTo: clock.optional(),
  watchMcxFrom: clock.optional(),
  watchMcxTo: clock.optional(),
  squareOff: z.boolean().optional(),
  squareOffNse: clock.optional(),
  squareOffMcx: clock.optional(),
  exitOnOpposite: z.boolean().optional(),
  charges: z.boolean().optional(),
  slippagePct: z.number().min(0).max(10).optional(),
};
export const paperOverrideSchema = z.object(overrideShape).strict() as unknown as z.ZodType<PaperOverride>;

/** A watch window that ends before it starts (a plan, or a connection's plan with its own values on top). */
export function watchWindowIssue(p: Pick<PaperPlan, 'watch' | 'watchNseFrom' | 'watchNseTo' | 'watchMcxFrom' | 'watchMcxTo'>): string | null {
  if (!p.watch) return null;
  if (clockMin(p.watchNseFrom) >= clockMin(p.watchNseTo)) return `Watch window (NSE / BSE): ${p.watchNseFrom} is not before ${p.watchNseTo}`;
  if (clockMin(p.watchMcxFrom) >= clockMin(p.watchMcxTo)) return `Watch window (MCX): ${p.watchMcxFrom} is not before ${p.watchMcxTo}`;
  return null;
}

const D = PAPER_DEFAULTS;
/** Fields added later default for plans saved (or sent) without them. */
export const paperPlanSchema = z
  .object({
    enabled: z.boolean(),
    lotsPerTrade: lots.default(D.lotsPerTrade),
    cashPerTrade: cash,
    rules: z
      .array(
        z.object({
          group: z.string().nullable(),
          leg: z.enum(['A', 'B', 'C', 'D']).nullable(),
          side: z.enum(['BUY', 'SELL']),
          stopWhen: exprNode.nullable().optional(),
        }),
      )
      .max(8),
    targetPct: target,
    stopPct: stop,
    trailing: z.boolean().default(D.trailing),
    watch: z.boolean().default(D.watch),
    watchNseFrom: clock.default(D.watchNseFrom),
    watchNseTo: clock.default(D.watchNseTo),
    watchMcxFrom: clock.default(D.watchMcxFrom),
    watchMcxTo: clock.default(D.watchMcxTo),
    squareOff: z.boolean(),
    squareOffNse: clock,
    squareOffMcx: clock,
    exitOnOpposite: z.boolean(),
    charges: z.boolean(),
    slippagePct: z.number().min(0).max(10),
  })
  .superRefine((p, ctx) => {
    const issue = watchWindowIssue(p);
    if (issue) ctx.addIssue({ code: 'custom', message: issue, path: ['watch'] });
    const trail = trailingIssue(p as PaperPlan);
    if (trail) ctx.addIssue({ code: 'custom', message: trail, path: ['trailing'] });
  }) as unknown as z.ZodType<PaperPlan>;
