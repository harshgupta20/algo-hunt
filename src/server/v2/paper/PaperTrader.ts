/**
 * Paper trading: turns alerts into simulated trades and follows them to their exit. Nothing is ever
 * sent to a broker. On for every connection by default: the strategy's plan (the preferred defaults
 * until edited) with the connection's own values on top.
 *
 *   open   an alert of a strategy whose paper plan is on → the rule of the group that fired (leg + side)
 *          → futures / options: the plan's lots per trade; stocks: as many shares as the ₹ per trade covers
 *          at the market price (+ slippage), at least one
 *   exit   stop-loss / trailing stop / target (on every price the caller sees), the group's trailing rules (at
 *          each close of their timeframe, on Kite's candles — exitConditions.ts), the other group firing, the
 *          intraday square-off time, or the contract's expiry; charges are deducted when it closes
 *   trail  with a target and trailing (a trailing stop % or trailing rules) the target doesn't close the trade:
 *          reaching it starts the trailing stop and the trailing rules (trailingAt); without a target they run
 *          from the entry
 *
 * One open position per connection and strike shift. Both the live worker (every tick) and the backup
 * scanner (once a minute, while the worker is off) drive exits; closing is conditional on the trade
 * still being open, so the two can never close a trade twice.
 */
import type { ExitLevel, ExprNode, LegId, Market, PaperConditions, PaperExitReason, PaperPlan, PaperRule, PaperSide, PaperTrade, ProductKind, StrategyDefinition, UnitEvaluation, V2Connection, V2Instrument, V2Product, V2Strategy, V2Unit } from '@/shared/v2';
import { atTarget, candleStop, defaultPaperPlan, effectivePlan, exitLevelPrice, stopOf, targetOf, hasCondition, legNameById, nodeText, marketOfExchange, paperGroups, resolveRules, stopNow, trailLevel, trailsPastTarget } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import { dateStartMs, type MarketCalendar } from '../calendar/MarketCalendar';
import type { V2DataProvider } from '../data/DataProvider';
import type { V2Store } from '../persistence/V2Store';
import type { RawCandle } from '../engine/candles';
import { moneyPerUnit, roundTripCharges } from './charges';
import { ConditionWatch } from './exitConditions';

const MINUTE = 60_000;
/** A square-off / expiry close uses the live price until this long after the deadline, then the last known price. */
const LATE_EXIT_MS = 5 * MINUTE;

/** An open trade's latest price (and best price so far, when it improved; when trailing started, once it did). */
export interface PaperMark {
  id: string;
  lastPrice: number;
  at: string;
  peakPrice?: number;
  trailingAt?: string;
}

/** Latest prices for contracts (token → price); contracts without a price are left out. */
export type PriceSource = (instruments: V2Instrument[]) => Promise<Map<number, number>>;

export interface PaperDeps {
  store: V2Store;
  now: () => number;
  prices: PriceSource;
  /** Kite's candles for trades' trailing rules (absent = the rules aren't checked) and signal candles. */
  provider?: V2DataProvider;
  /** The live worker's own 1-minute candles: a contract's high / low over [from, to) when it watched all of it (else undefined → Kite's). */
  liveRange?: (inst: V2Instrument, from: number, to: number) => { high: number; low: number } | undefined;
}

/** High / low of 1-minute candles over [from, to) (null when there are none). */
export function rangeOf(minutes: RawCandle[], from: number, to: number): { high: number; low: number } | null {
  let high = -Infinity;
  let low = Infinity;
  for (const m of minutes) {
    const t = m.time * 1000;
    if (t < from || t >= to) continue;
    high = Math.max(high, m.high);
    low = Math.min(low, m.low);
  }
  return Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null;
}

export interface PaperAlert {
  connection: V2Connection;
  strategy: V2Strategy;
  product: V2Product;
  unit: V2Unit;
  evaluation: UnitEvaluation;
  alertId: string | null;
  cal: MarketCalendar;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Round to the contract's tick: nearest, or against the trader for fills (buys up, sells down). */
const toTick = (n: number, tick: number, dir: 'near' | 'up' | 'down' = 'near') => {
  const t = tick > 0 ? tick : 0.05;
  const q = n / t;
  return round2((dir === 'up' ? Math.ceil(q - 1e-9) : dir === 'down' ? Math.floor(q + 1e-9) : Math.round(q)) * t);
};
export { stopNow, trailLevel };
export const rupees = (n: number) => `₹${round2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${rupees(Math.abs(n))}`;
const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** When the day's square-off happens for a market (never after the session close). */
export function squareOffAt(cal: MarketCalendar, date: string, clock: string): number {
  return Math.min(dateStartMs(date) + hhmm(clock) * MINUTE, cal.sessionEnd(date));
}

/** The time a trade must close by: the square-off on its entry day (intraday), else its contract's expiry. */
export function exitDeadline(t: PaperTrade, cal: MarketCalendar): { at: number; reason: 'SQUARE_OFF' | 'EXPIRY' } | null {
  if (t.terms.squareOff) {
    const clock = marketOfExchange(t.instrument.exchange) === 'MCX' ? t.terms.squareOffMcx : t.terms.squareOffNse;
    return { at: squareOffAt(cal, istDate(Date.parse(t.entryAt)), clock), reason: 'SQUARE_OFF' };
  }
  if (t.instrument.expiry) return { at: cal.sessionEnd(t.instrument.expiry), reason: 'EXPIRY' };
  return null;
}

/** Stop-loss, trailing stop or target reached at this price (a stop wins when both are; a trade that trails past its target isn't closed there). */
export function paperHit(t: PaperTrade, price: number): 'STOP' | 'TRAIL' | 'TARGET' | null {
  const buy = t.side === 'BUY';
  const stop = stopNow(t);
  if (stop && (buy ? price <= stop.price : price >= stop.price)) return stop.reason;
  if (atTarget(t, price) && !trailsPastTarget(t)) return 'TARGET';
  return null;
}

/** The trade's new best price after seeing `price` (undefined when it isn't better). */
export function newPeak(t: Pick<PaperTrade, 'side' | 'entryPrice' | 'peakPrice'>, price: number): number | undefined {
  const peak = t.peakPrice ?? t.entryPrice;
  return (t.side === 'BUY' ? price > peak : price < peak) ? price : undefined;
}

/** What seeing `price` at `at` changes on an open trade it didn't close: a new best price, and trailing starting at the target. */
export function markChanges(t: PaperTrade, price: number, at: string): Pick<PaperMark, 'peakPrice' | 'trailingAt'> {
  const peak = newPeak(t, price);
  const starts = !t.trailingAt && trailsPastTarget(t) && atTarget(t, price);
  return { ...(peak !== undefined ? { peakPrice: peak } : {}), ...(starts ? { trailingAt: at } : {}) };
}

/** Exit fill, P&L and charges if the trade closed at `price` now. */
export function settle(t: PaperTrade, price: number, reason: PaperExitReason): { exitPrice: number; grossPnl: number; charges: number; netPnl: number } {
  const buy = t.side === 'BUY';
  const slip = t.terms.slippagePct / 100;
  // A target is a resting limit order (fills at its price); every other exit is a market order.
  const exitPrice = reason === 'TARGET' && t.targetPrice !== null ? t.targetPrice : toTick(buy ? price * (1 - slip) : price * (1 + slip), t.instrument.tickSize, buy ? 'down' : 'up');
  const grossPnl = round2((buy ? exitPrice - t.entryPrice : t.entryPrice - exitPrice) * t.quantity);
  const charges = t.terms.charges ? roundTripCharges(t.instrument, t.quantity, buy ? t.entryPrice : exitPrice, buy ? exitPrice : t.entryPrice, t.terms.squareOff) : 0;
  return { exitPrice, grossPnl, charges, netPnl: round2(grossPnl - charges) };
}

/** An open trade's P&L at its last price (as if closed now with a market order, after charges). */
export function unrealizedPnl(t: PaperTrade): number {
  if (t.status !== 'OPEN' || t.lastPrice === null) return 0;
  return settle(t, t.lastPrice, 'MANUAL').netPnl;
}

const describe = (t: Pick<PaperTrade, 'side' | 'lots' | 'quantity' | 'lotSize' | 'instrument'>) =>
  `${t.side} ${t.lotSize > 1 ? `${t.lots} lot${t.lots === 1 ? '' : 's'} (${t.quantity})` : `${t.quantity}`} ${t.instrument.symbol}`;

const REASON_TEXT: Record<PaperExitReason, string> = {
  TARGET: 'target hit',
  STOP: 'stop-loss hit',
  TRAIL: 'trailing stop hit',
  STOP_RULE: 'trailing rule',
  TARGET_RULE: 'exit condition',
  SQUARE_OFF: 'square-off',
  OPPOSITE: 'the other group fired',
  EXPIRY: 'expiry',
  MANUAL: 'closed by hand',
  END: 'end of the backtest',
};

/** Conditions as their logic only: no ids or names, a group of one = that item. */
function logicOf(n: ExprNode): string {
  const bare = (x: ExprNode): unknown => {
    if ((x.type === 'AND' || x.type === 'OR') && x.children.length === 1) return bare(x.children[0]!);
    if (x.type === 'AND' || x.type === 'OR') return { type: x.type, children: x.children.map(bare) };
    if (x.type === 'NOT') return { type: 'NOT', child: bare(x.child) };
    const { id: _id, ...rest } = x;
    return rest;
  };
  return JSON.stringify(bare(n));
}

/**
 * The open trade's exit condition is exactly the conditions of the group that just fired (e.g. its "opposite of the
 * entry" — the sell leg's own entry): so it is true on this candle, and the trade exits on it (then the new one opens).
 */
export function exitFired(t: PaperTrade, d: StrategyDefinition, fired: { id: string } | null): boolean {
  const exit = t.conditions?.exitWhen;
  const node = fired ? paperGroups(d).find((g) => g.id === fired.id)?.node : undefined;
  return !!exit && !!node && logicOf(exit) === logicOf(node);
}

/** The trailing rules and exit condition a rule's trades carry (with the unit's contracts to check them on), or undefined. */
export function tradeConditions(rule: PaperRule, d: Pick<StrategyDefinition, 'legs'>, unit: V2Unit): PaperConditions | undefined {
  const stop = hasCondition(rule.stopWhen) ? rule.stopWhen : undefined;
  const exit = hasCondition(rule.exitWhen) ? rule.exitWhen : undefined;
  return stop || exit ? { ...(stop ? { stopWhen: stop } : {}), ...(exit ? { exitWhen: exit } : {}), legDefs: d.legs, legs: unit.legs } : undefined;
}

/**
 * A new open trade for `ref` (the market price): futures / options the plan's lots per trade, stocks whole shares for
 * the ₹ per trade (≥ 1); slippage, target / stop; with Trailing SL the trailing rules (they start at the target).
 */
export function buildTrade(x: {
  plan: PaperPlan;
  instrument: V2Instrument;
  productKind: ProductKind;
  side: PaperSide;
  ref: number;
  at: number;
  ids: Pick<PaperTrade, 'strategyId' | 'connectionId' | 'productId' | 'slot' | 'unitKey' | 'alertId'>;
  group: { id: string; label: string } | null;
  leg: LegId;
  conditions?: PaperConditions;
  /** The traded contract's signal candle (the one that fired the alert): its low / high is the stop-loss when the plan says so. */
  signal?: { high: number; low: number } | null;
}): Omit<PaperTrade, 'id'> {
  const { plan, instrument: inst, side, ref } = x;
  const slip = plan.slippagePct / 100;
  const entryPrice = toTick(side === 'BUY' ? ref * (1 + slip) : ref * (1 - slip), inst.tickSize, side === 'BUY' ? 'up' : 'down');
  const lotSize = Math.max(1, inst.lotSize || 1);
  const money = moneyPerUnit(inst, x.productKind, side, entryPrice);
  const perLot = money.perUnit * lotSize;
  // Futures / options trade in lots; a stock (Spot leg) gets the shares its ₹ per trade covers.
  const stock = inst.kind === 'SPOT';
  const lots = stock ? Math.max(1, Math.floor(plan.cashPerTrade / perLot)) : Math.max(1, Math.floor(plan.lotsPerTrade));
  // Target / stop-loss in % of the entry or in price points of the contract (a level at or below 0 is never reached: none).
  const target = targetOf(plan);
  const stop = stopOf(plan);
  const level = (e: ExitLevel | null, up: boolean) => {
    const p = exitLevelPrice(entryPrice, e, up);
    return p === null ? null : toTick(p, inst.tickSize);
  };
  // The signal candle's low (buy) / high (sell), when it lies beyond the entry on the loss side (else no stop-loss).
  const byCandle = stop?.unit === 'CANDLE';
  const candle = byCandle ? candleStop(side, entryPrice, x.signal) : null;
  const stopPrice = byCandle ? (candle === null ? null : toTick(candle, inst.tickSize)) : level(stop as ExitLevel | null, side !== 'BUY');
  const at = new Date(x.at).toISOString();
  // Trailing SL needs a target to start at and this group's trailing rules; otherwise a normal trade (the rules stay in the plan).
  const trails = !!plan.trailing && target !== null && !!x.conditions?.stopWhen;
  // The trade keeps its trailing rules only when it trails; its exit condition always (from the entry).
  const { stopWhen, exitWhen, ...where } = x.conditions ?? { legDefs: [], legs: {} };
  const conditions = trails || exitWhen ? { ...where, ...(trails && stopWhen ? { stopWhen } : {}), ...(exitWhen ? { exitWhen } : {}) } : undefined;
  return {
    ...x.ids,
    group: x.group?.id ?? null,
    groupLabel: x.group?.label,
    leg: x.leg,
    side,
    instrument: inst,
    lots,
    lotSize,
    quantity: lots * lotSize,
    cashPerTrade: plan.cashPerTrade,
    capitalUsed: round2(perLot * lots),
    marginEstimated: money.estimated,
    overBudget: stock && perLot > plan.cashPerTrade,
    entryAt: at,
    entryRef: ref,
    entryPrice,
    targetPrice: level(target, side === 'BUY'),
    stopPrice,
    peakPrice: entryPrice,
    ...(conditions ? { conditions } : {}),
    terms: {
      targetPct: target?.unit === 'PCT' ? target.value : null,
      stopPct: stop?.unit === 'PCT' ? stop.value : null,
      ...(target?.unit === 'POINTS' ? { targetPoints: target.value } : {}),
      ...(stop?.unit === 'POINTS' ? { stopPoints: stop.value } : {}),
      ...(byCandle ? { stopCandle: true } : {}),
      squareOff: plan.squareOff,
      squareOffNse: plan.squareOffNse,
      squareOffMcx: plan.squareOffMcx,
      exitOnOpposite: plan.exitOnOpposite,
      charges: plan.charges,
      slippagePct: plan.slippagePct,
      ...(trails ? { trailFromTarget: true } : {}),
    },
    status: 'OPEN',
    lastPrice: ref,
    lastPriceAt: at,
    exitAt: null,
    exitPrice: null,
    exitReason: null,
    grossPnl: null,
    charges: null,
    netPnl: null,
  };
}

/** The top-level group whose condition was true (null for strategies without groups). */
export function firedGroupOf(s: StrategyDefinition, trace: UnitEvaluation['trace']): { id: string; label: string } | null {
  const groups = paperGroups(s);
  if (!groups.length) return null;
  const hit = groups.find((g) => trace.children?.find((c) => c.id === g.id)?.result === 'TRUE');
  return hit ? { id: hit.id, label: hit.label } : { id: groups[0]!.id, label: groups[0]!.label };
}

function firedGroup(s: V2Strategy, e: UnitEvaluation): { id: string; label: string } | null {
  return firedGroupOf(s.definition, e.trace);
}

export class PaperTrader {
  private readonly conditions: ConditionWatch | null;

  constructor(private readonly deps: PaperDeps) {
    this.conditions = deps.provider ? new ConditionWatch(deps.provider) : null;
  }

  /**
   * An alert went out: close the other group's open trade (if the plan says so) and open this group's.
   * Returns a line for the alert message, or null when paper trading is switched off for the connection.
   */
  async onAlert(a: PaperAlert): Promise<string | null> {
    const { store } = this.deps;
    const [saved, override] = await Promise.all([store.paper.getPlan(a.strategy.id), store.paper.getOverride(a.connection.id)]);
    const plan = effectivePlan(saved ?? defaultPaperPlan(a.strategy.definition), override);
    if (!plan.enabled) return null;
    const now = this.deps.now();
    const fired = firedGroup(a.strategy, a.evaluation);
    const rules = resolveRules(a.strategy.definition, plan.rules);
    const rule: PaperRule | undefined = rules.find((r) => r.group === (fired?.id ?? null)) ?? rules[0];
    const slot = `shift:${a.unit.shift}`;
    const open = await store.paper.openFor(a.connection.id, slot);
    const lines: string[] = [];

    // The open trade's exit condition is what just fired (its "opposite of the entry"): it is true on this candle.
    const exitNow = !!open && exitFired(open, a.strategy.definition, fired);
    if (open) {
      if (open.group === (fired?.id ?? null)) return `📄 Paper: already in ${describe(open)} — kept open`;
      if (!open.terms.exitOnOpposite && !exitNow) return `📄 Paper: ${describe(open)} is still open — no new trade`;
    }

    // What this alert would trade (checked before closing anything, so both use one price request).
    const inst = rule?.leg ? (a.unit.legs[rule.leg] ?? null) : null;
    let skip: string | null = null;
    if (!rule?.leg) skip = fired ? `${fired.label} doesn't trade` : 'nothing to trade';
    else if (!inst) skip = `${legNameById(rule.leg, a.strategy.definition.legs)} has no listed contract here`;
    else if (inst.kind === 'SPOT' && a.product.kind !== 'STOCK') skip = `an index can't be traded — choose its future or an option`;
    else if (!a.cal.isMarketOpen(now)) skip = 'market closed';
    else if (plan.squareOff && now >= squareOffAt(a.cal, istDate(now), a.product.market === 'MCX' ? plan.squareOffMcx : plan.squareOffNse)) {
      skip = `after the ${a.product.market === 'MCX' ? plan.squareOffMcx : plan.squareOffNse} square-off`;
    }

    const wanted = [open?.instrument, skip ? undefined : inst].filter((i): i is V2Instrument => !!i);
    const prices = wanted.length ? await this.deps.prices(wanted).catch(() => new Map<number, number>()) : new Map<number, number>();

    if (open) {
      const px = prices.get(open.instrument.token) ?? open.lastPrice ?? open.entryRef;
      const reason = exitNow ? 'TARGET_RULE' : 'OPPOSITE';
      const closed = await this.close(open, px, reason);
      if (closed) lines.push(`📄 Paper: closed ${describe(closed)} @ ${rupees(closed.exitPrice!)} (${REASON_TEXT[reason]}) · P&L ${signed(closed.netPnl!)}`);
    }

    if (skip || !inst || !rule?.leg) {
      if (skip) lines.push(`📄 Paper: no trade — ${skip}`);
      return lines.join('\n');
    }
    // Market price now; the alert's candle close when no live price came back.
    const ref = prices.get(inst.token) ?? a.evaluation.prices[rule.leg];
    if (ref === undefined || !(ref > 0)) {
      lines.push(`📄 Paper: no trade — no price for ${inst.symbol}`);
      return lines.join('\n');
    }

    const signal = stopOf(plan)?.unit === 'CANDLE' ? await this.signalCandle(inst, a) : undefined;
    const draft = buildTrade({
      plan,
      instrument: inst,
      productKind: a.product.kind,
      side: rule.side,
      ref,
      at: now,
      ids: { strategyId: a.strategy.id, connectionId: a.connection.id, productId: a.product.id, slot, unitKey: a.unit.key, alertId: a.alertId },
      group: fired,
      leg: rule.leg,
      conditions: tradeConditions(rule, a.strategy.definition, a.unit),
      signal,
    });
    const trade = await store.paper.insertTrade(draft);
    if (!trade) {
      lines.push('📄 Paper: a trade is already open for this strike — no new trade');
      return lines.join('\n');
    }
    const perLot = trade.capitalUsed / trade.lots;
    const trails = !!trade.conditions?.stopWhen;
    const candleSide = trade.side === 'BUY' ? 'low' : 'high';
    const exits = [
      trade.targetPrice !== null ? `target ${rupees(trade.targetPrice)}${trails ? ' starts trailing rules' : ''}` : null,
      trade.stopPrice !== null ? `stop ${rupees(trade.stopPrice)}${trade.terms.stopCandle ? ` (signal candle ${candleSide})` : ''}` : null,
      trade.stopPrice === null && trade.terms.stopCandle ? `no stop-loss (${signal ? `the signal candle's ${candleSide} isn't beyond the entry` : 'signal candle not available'})` : null,
      trade.targetPrice === null && trails ? 'trailing rules' : null,
      trade.conditions?.exitWhen ? `or when ${nodeText(trade.conditions.exitWhen, trade.conditions.legDefs)}` : null,
    ].filter(Boolean);
    const budget = trade.overBudget ? ` · 1 share costs ${rupees(perLot)}, over the ${rupees(plan.cashPerTrade)} per trade` : '';
    lines.push(`📄 Paper: ${describe(trade)} @ ${rupees(trade.entryPrice)}${exits.length ? ` · ${exits.join(' · ')}` : ''}${budget}`);
    return lines.join('\n');
  }

  /**
   * The traded contract's signal candle (the trigger candle the alert fired on): the live worker's own minutes when it
   * watched the whole candle, else Kite's 1-minute candles. Null when neither has it.
   */
  private async signalCandle(inst: V2Instrument, a: PaperAlert): Promise<{ high: number; low: number } | null> {
    const open = a.evaluation.triggerCandle * 1000;
    const close = a.cal.candleClose(open, a.evaluation.triggerTimeframe);
    const live = this.deps.liveRange?.(inst, open, close);
    if (live) return live;
    if (!this.deps.provider) return null;
    try {
      const rows = await this.deps.provider.getHistoricalCandles({ instrument: inst, interval: '1m', from: istDate(open), to: istDate(close - 1) });
      return rangeOf(rows, open, close);
    } catch {
      return null;
    }
  }

  /** Close an open trade at a market price (null when something else closed it first). */
  async close(t: PaperTrade, price: number, reason: PaperExitReason, exitAt = this.deps.now()): Promise<PaperTrade | null> {
    const s = settle(t, price, reason);
    const at = new Date(exitAt).toISOString();
    return this.deps.store.paper.closeTrade(t.id, { ...s, exitAt: at, exitReason: reason, lastPrice: price, lastPriceAt: at });
  }

  /** Close by hand at the latest price (the last known one when none comes back). */
  async closeManual(id: string): Promise<PaperTrade | null> {
    const t = (await this.deps.store.paper.listOpen()).find((x) => x.id === id);
    if (!t) return null;
    const px = (await this.deps.prices([t.instrument]).catch(() => new Map<number, number>())).get(t.instrument.token) ?? t.lastPrice ?? t.entryRef;
    return this.close(t, px, 'MANUAL');
  }

  /**
   * Check every open trade: square-off / expiry deadlines, then stop-loss / trailing stop / target at the latest
   * price (recording it, the best price so far and when trailing started), then trailing rules on candles that
   * closed since the last look. Prices are asked only for contracts whose market is open.
   */
  async monitor(cals: Record<Market, MarketCalendar>): Promise<{ open: PaperTrade[]; closed: PaperTrade[]; requested: boolean }> {
    const { store } = this.deps;
    const trades = await store.paper.listOpen();
    if (!trades.length) return { open: [], closed: [], requested: false };
    const now = this.deps.now();
    const cal = (t: PaperTrade) => cals[marketOfExchange(t.instrument.exchange)];
    const live = [...new Map(trades.filter((t) => cal(t).isMarketOpen(now, 5)).map((t) => [t.instrument.token, t.instrument])).values()];
    const prices = live.length ? await this.deps.prices(live) : new Map<number, number>();
    let open: PaperTrade[] = [];
    const closed: PaperTrade[] = [];
    const marks: PaperMark[] = [];
    for (const t of trades) {
      const px = prices.get(t.instrument.token);
      const due = exitDeadline(t, cal(t));
      let exit: Promise<PaperTrade | null> | null = null;
      let next = t;
      if (due && now >= due.at) {
        // On time: the live price. Late (worker/scanner was off): the last price seen, at the deadline.
        const onTime = px !== undefined && now <= due.at + LATE_EXIT_MS;
        exit = this.close(t, onTime ? px : (t.lastPrice ?? t.entryRef), due.reason, onTime ? now : due.at);
      } else if (px !== undefined) {
        const hit = paperHit(t, px);
        if (hit) exit = this.close(t, px, hit);
        else {
          const at = new Date(now).toISOString();
          const changes = markChanges(t, px, at);
          marks.push({ id: t.id, lastPrice: px, at, ...changes });
          next = { ...t, lastPrice: px, lastPriceAt: at, ...changes };
        }
      }
      if (exit) {
        const done = await exit;
        if (done) closed.push(done); // null: closed elsewhere meanwhile
      } else open.push(next);
    }
    await store.paper.updateMarks(marks);
    if (this.conditions) {
      const fired = await this.conditions.check(open, cals, now);
      for (const f of fired) {
        const t = open.find((x) => x.id === f.id)!;
        const px = prices.get(t.instrument.token) ?? (await this.deps.prices([t.instrument]).catch(() => new Map<number, number>())).get(t.instrument.token) ?? t.lastPrice ?? t.entryRef;
        const done = await this.close(t, px, f.reason);
        if (done) closed.push(done);
      }
      const gone = new Set(fired.map((f) => f.id));
      open = open.filter((t) => !gone.has(t.id));
    }
    return { open, closed, requested: live.length > 0 };
  }
}
