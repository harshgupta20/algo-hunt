/**
 * Paper trading: turns alerts into simulated trades and follows them to their exit. Nothing is ever
 * sent to a broker. On for every connection by default: the strategy's plan (the preferred defaults
 * until edited) with the connection's own values on top.
 *
 *   open   an alert of a strategy whose paper plan is on → the rule of the group that fired (leg + side)
 *          → as many lots as the cash per trade covers at the market price (+ slippage), at least one
 *   exit   stop-loss / target (on every price the caller sees), the other group firing, the intraday
 *          square-off time, or the contract's expiry; charges are deducted when it closes
 *
 * One open position per connection and strike shift. Both the live worker (every tick) and the backup
 * scanner (once a minute, while the worker is off) drive exits; closing is conditional on the trade
 * still being open, so the two can never close a trade twice.
 */
import type { LegId, Market, PaperExitReason, PaperPlan, PaperRule, PaperSide, PaperTrade, ProductKind, StrategyDefinition, UnitEvaluation, V2Connection, V2Instrument, V2Product, V2Strategy, V2Unit } from '@/shared/v2';
import { defaultPaperPlan, effectivePlan, marketOfExchange, paperGroups, resolveRules } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import { dateStartMs, type MarketCalendar } from '../calendar/MarketCalendar';
import type { V2Store } from '../persistence/V2Store';
import { moneyPerUnit, roundTripCharges } from './charges';

const MINUTE = 60_000;
/** A square-off / expiry close uses the live price until this long after the deadline, then the last known price. */
const LATE_EXIT_MS = 5 * MINUTE;

/** Latest prices for contracts (token → price); contracts without a price are left out. */
export type PriceSource = (instruments: V2Instrument[]) => Promise<Map<number, number>>;

export interface PaperDeps {
  store: V2Store;
  now: () => number;
  prices: PriceSource;
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

/** Stop-loss or target reached at this price (the stop wins when both are). */
export function paperHit(t: PaperTrade, price: number): 'STOP' | 'TARGET' | null {
  const buy = t.side === 'BUY';
  if (t.stopPrice !== null && (buy ? price <= t.stopPrice : price >= t.stopPrice)) return 'STOP';
  if (t.targetPrice !== null && (buy ? price >= t.targetPrice : price <= t.targetPrice)) return 'TARGET';
  return null;
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
  SQUARE_OFF: 'square-off',
  OPPOSITE: 'the other group fired',
  EXPIRY: 'expiry',
  MANUAL: 'closed by hand',
  END: 'end of the backtest',
};

/** A new open trade for `ref` (the market price): whole lots for the cash per trade (≥ 1), slippage, target / stop. */
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
}): Omit<PaperTrade, 'id'> {
  const { plan, instrument: inst, side, ref } = x;
  const slip = plan.slippagePct / 100;
  const entryPrice = toTick(side === 'BUY' ? ref * (1 + slip) : ref * (1 - slip), inst.tickSize, side === 'BUY' ? 'up' : 'down');
  const lotSize = Math.max(1, inst.lotSize || 1);
  const money = moneyPerUnit(inst, x.productKind, side, entryPrice);
  const perLot = money.perUnit * lotSize;
  const lots = Math.max(1, Math.floor(plan.cashPerTrade / perLot));
  const pct = (n: number | null, up: boolean) => (n === null ? null : toTick(entryPrice * (1 + (up ? n : -n) / 100), inst.tickSize));
  const at = new Date(x.at).toISOString();
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
    overBudget: perLot > plan.cashPerTrade,
    entryAt: at,
    entryRef: ref,
    entryPrice,
    targetPrice: pct(plan.targetPct, side === 'BUY'),
    stopPrice: pct(plan.stopPct, side !== 'BUY'),
    terms: {
      targetPct: plan.targetPct,
      stopPct: plan.stopPct,
      squareOff: plan.squareOff,
      squareOffNse: plan.squareOffNse,
      squareOffMcx: plan.squareOffMcx,
      exitOnOpposite: plan.exitOnOpposite,
      charges: plan.charges,
      slippagePct: plan.slippagePct,
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
  constructor(private readonly deps: PaperDeps) {}

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

    if (open) {
      if (open.group === (fired?.id ?? null)) return `📄 Paper: already in ${describe(open)} — kept open`;
      if (!open.terms.exitOnOpposite) return `📄 Paper: ${describe(open)} is still open — no new trade`;
    }

    // What this alert would trade (checked before closing anything, so both use one price request).
    const inst = rule?.leg ? (a.unit.legs[rule.leg] ?? null) : null;
    let skip: string | null = null;
    if (!rule?.leg) skip = fired ? `${fired.label} doesn't trade` : 'no leg to trade';
    else if (!inst) skip = `leg ${rule.leg} has no listed contract here`;
    else if (inst.kind === 'SPOT' && a.product.kind !== 'STOCK') skip = `an index can't be traded — choose its future or an option leg`;
    else if (!a.cal.isMarketOpen(now)) skip = 'market closed';
    else if (plan.squareOff && now >= squareOffAt(a.cal, istDate(now), a.product.market === 'MCX' ? plan.squareOffMcx : plan.squareOffNse)) {
      skip = `after the ${a.product.market === 'MCX' ? plan.squareOffMcx : plan.squareOffNse} square-off`;
    }

    const wanted = [open?.instrument, skip ? undefined : inst].filter((i): i is V2Instrument => !!i);
    const prices = wanted.length ? await this.deps.prices(wanted).catch(() => new Map<number, number>()) : new Map<number, number>();

    if (open) {
      const px = prices.get(open.instrument.token) ?? open.lastPrice ?? open.entryRef;
      const closed = await this.close(open, px, 'OPPOSITE');
      if (closed) lines.push(`📄 Paper: closed ${describe(closed)} @ ${rupees(closed.exitPrice!)} (${REASON_TEXT.OPPOSITE}) · P&L ${signed(closed.netPnl!)}`);
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
    });
    const trade = await store.paper.insertTrade(draft);
    if (!trade) {
      lines.push('📄 Paper: a trade is already open for this strike — no new trade');
      return lines.join('\n');
    }
    const perLot = trade.capitalUsed / trade.lots;
    const exits = [trade.targetPrice !== null ? `target ${rupees(trade.targetPrice)}` : null, trade.stopPrice !== null ? `stop ${rupees(trade.stopPrice)}` : null].filter(Boolean);
    const budget = trade.overBudget ? ` · 1 lot needs ${rupees(perLot)}${trade.marginEstimated ? ' margin (est.)' : ''}, over the ${rupees(plan.cashPerTrade)} per trade` : '';
    lines.push(`📄 Paper: ${describe(trade)} @ ${rupees(trade.entryPrice)}${exits.length ? ` · ${exits.join(' · ')}` : ''}${budget}`);
    return lines.join('\n');
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
   * Check every open trade: square-off / expiry deadlines, then stop-loss / target at the latest price,
   * and record that price. Prices are asked only for contracts whose market is open.
   */
  async monitor(cals: Record<Market, MarketCalendar>): Promise<{ open: PaperTrade[]; closed: PaperTrade[]; requested: boolean }> {
    const { store } = this.deps;
    const trades = await store.paper.listOpen();
    if (!trades.length) return { open: [], closed: [], requested: false };
    const now = this.deps.now();
    const cal = (t: PaperTrade) => cals[marketOfExchange(t.instrument.exchange)];
    const live = [...new Map(trades.filter((t) => cal(t).isMarketOpen(now, 5)).map((t) => [t.instrument.token, t.instrument])).values()];
    const prices = live.length ? await this.deps.prices(live) : new Map<number, number>();
    const open: PaperTrade[] = [];
    const closed: PaperTrade[] = [];
    const marks: Array<{ id: string; lastPrice: number; at: string }> = [];
    for (const t of trades) {
      const px = prices.get(t.instrument.token);
      const due = exitDeadline(t, cal(t));
      let exit: Promise<PaperTrade | null> | null = null;
      if (due && now >= due.at) {
        // On time: the live price. Late (worker/scanner was off): the last price seen, at the deadline.
        const onTime = px !== undefined && now <= due.at + LATE_EXIT_MS;
        exit = this.close(t, onTime ? px : (t.lastPrice ?? t.entryRef), due.reason, onTime ? now : due.at);
      } else if (px !== undefined) {
        const hit = paperHit(t, px);
        if (hit) exit = this.close(t, px, hit);
        else marks.push({ id: t.id, lastPrice: px, at: new Date(now).toISOString() });
      }
      if (exit) {
        const done = await exit;
        if (done) closed.push(done); // null: closed elsewhere meanwhile
      } else open.push(px !== undefined ? { ...t, lastPrice: px, lastPriceAt: new Date(now).toISOString() } : t);
    }
    await store.paper.updateMarks(marks);
    return { open, closed, requested: live.length > 0 };
  }
}
