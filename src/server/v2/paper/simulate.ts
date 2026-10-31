/**
 * The money side of a backtest, shared by the Kite backtest (today's contracts) and the Options backtest
 * (Upstox's expired contracts): alerts in time order, each traded exactly like a paper trade, the exits
 * walked on the traded contract's 1-minute candles.
 *
 *   entry     the leg's close on the alert's trigger candle ± slippage; whole lots for the cash per trade
 *   money     a trade opens only if the starting capital + realised P&L − money already in use covers it
 *   exits     stop-loss / target inside each minute (both in one minute → the stop; a gap past the stop fills
 *             at the minute's open), an exit rule coming true (at that candle's close), the other group firing,
 *             the day's square-off, expiry, or the end of the test (still open → closed at the last price)
 *   one open position per product (a backtest tests one strike position)
 */
import type { BacktestSkip, PaperExitReason, PaperPlan, PaperTrade, StrategyDefinition, V2Instrument, V2Product, V2Strategy, V2Unit } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import type { MarketCalendar } from '../calendar/MarketCalendar';
import type { RawCandle } from '../engine/candles';
import { buildTrade, exitDeadline, firedGroupOf, settle, squareOffAt } from './PaperTrader';

const MINUTE = 60_000;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** The rule's key in the exit-rule list (as sent to Compare). */
export const exitKey = (group: string | null) => group ?? '*';

/** An alert to trade: when its trigger candle closed, the unit (legs → contracts) it fired on and its prices. */
export interface SimAlert {
  at: number;
  productId: string;
  unit: V2Unit;
  prices: Partial<Record<string, number>>;
  trace: Parameters<typeof firedGroupOf>[1];
}

export interface SimInput {
  strategy: V2Strategy;
  /** The trade plan with its rules resolved to the strategy's groups. */
  plan: PaperPlan;
  capital: number | null;
  products: Map<string, V2Product>;
  calOf: (productId: string) => MarketCalendar;
  /** Every alert, in time order (money is shared across products). */
  alerts: SimAlert[];
  /** A contract's 1-minute candles, ascending (empty when there are none). */
  minutes: (instrument: V2Instrument) => RawCandle[];
  /** Candle closes (ms, ascending) after the alert where the trade's exit rule is true. */
  exitsFor: (alert: SimAlert, ruleKey: string) => number[];
  /** The end of the test (ms): trades still open are played out to here, then closed at their last price. */
  end: number;
}

export interface SimOutput {
  closed: PaperTrade[];
  skipped: BacktestSkip[];
}

interface Open {
  t: PaperTrade;
  candles: RawCandle[];
  /** Next minute candle to look at. */
  i: number;
  lastClose: number;
  deadline: { at: number; reason: 'SQUARE_OFF' | 'EXPIRY' } | null;
  /** Candle closes after entry where the trade's exit rule is true (ascending). */
  exits: number[];
}

/** The group an alert fired and the trade rule it follows (its group's, else the first). */
export function ruleFor(d: StrategyDefinition, plan: PaperPlan, trace: SimAlert['trace']) {
  const fired = firedGroupOf(d, trace);
  return { fired, rule: plan.rules.find((r) => r.group === (fired?.id ?? null)) ?? plan.rules[0] };
}

export function simulate(x: SimInput): SimOutput {
  const { strategy, plan } = x;
  const d = strategy.definition;
  const open = new Map<string, Open>();
  const closed: PaperTrade[] = [];
  const skipped: BacktestSkip[] = [];
  let realized = 0;
  let inUse = 0;
  let n = 0;

  const finish = (o: Open, price: number, reason: PaperExitReason, at: number) => {
    const s = settle(o.t, price, reason);
    const exitAt = new Date(at).toISOString();
    closed.push({ ...o.t, ...s, status: 'CLOSED', exitAt, exitReason: reason, lastPrice: price, lastPriceAt: exitAt });
    open.delete(o.t.slot);
    inUse -= o.t.capitalUsed;
    realized += s.netPnl;
  };

  /** The next timed exit: the square-off / expiry deadline or the exit rule, whichever is first. */
  const due = (o: Open): { at: number; reason: PaperExitReason } | null => {
    const rule = o.exits[0];
    if (rule !== undefined && (!o.deadline || rule < o.deadline.at)) return { at: rule, reason: 'EXIT_RULE' };
    return o.deadline;
  };

  /** Walk a trade's minutes that closed by `until`; true when it closed. */
  const advance = (o: Open, until: number): boolean => {
    const t = o.t;
    const buy = t.side === 'BUY';
    while (o.i < o.candles.length) {
      const c = o.candles[o.i]!;
      const t0 = c.time * 1000;
      if (t0 + MINUTE > until) break;
      const next = due(o);
      if (next && t0 >= next.at) {
        finish(o, o.lastClose, next.reason, next.at);
        return true;
      }
      const hitStop = t.stopPrice !== null && (buy ? c.low <= t.stopPrice : c.high >= t.stopPrice);
      const hitTarget = t.targetPrice !== null && (buy ? c.high >= t.targetPrice : c.low <= t.targetPrice);
      if (hitStop) {
        // A gap through the stop fills at the minute's open.
        finish(o, buy ? Math.min(t.stopPrice!, c.open) : Math.max(t.stopPrice!, c.open), 'STOP', t0 + MINUTE);
        return true;
      }
      if (hitTarget) {
        finish(o, t.targetPrice!, 'TARGET', t0 + MINUTE);
        return true;
      }
      o.lastClose = c.close;
      o.i++;
    }
    const next = due(o);
    if (next && until > next.at && (o.i >= o.candles.length || o.candles[o.i]!.time * 1000 >= next.at)) {
      finish(o, o.lastClose, next.reason, next.at);
      return true;
    }
    return false;
  };

  const skip = (e: SimAlert, reason: string) => skipped.push({ productId: e.productId, at: new Date(e.at).toISOString(), reason });

  for (const e of x.alerts) {
    for (const o of [...open.values()]) advance(o, e.at);
    const product = x.products.get(e.productId);
    if (!product) continue;
    const cal = x.calOf(e.productId);
    const { fired, rule } = ruleFor(d, plan, e.trace);
    const slot = e.productId;
    const cur = open.get(slot);
    if (cur) {
      if (cur.t.group === (fired?.id ?? null)) continue; // the same group again: keep the position
      if (!plan.exitOnOpposite) {
        skip(e, `${fired?.label ?? 'Alert'}: a trade was still open`);
        continue;
      }
      finish(cur, cur.lastClose, 'OPPOSITE', e.at);
    }
    if (!rule?.leg) {
      if (!cur) skip(e, `${fired?.label ?? 'This group'} doesn't trade`);
      continue;
    }
    const inst = e.unit.legs[rule.leg] ?? null;
    if (!inst) {
      skip(e, `Leg ${rule.leg} has no listed contract`);
      continue;
    }
    if (inst.kind === 'SPOT' && product.kind !== 'STOCK') {
      skip(e, 'An index can’t be traded — choose its future or an option leg');
      continue;
    }
    const squareOffTime = product.market === 'MCX' ? plan.squareOffMcx : plan.squareOffNse;
    if (plan.squareOff && e.at >= squareOffAt(cal, istDate(e.at), squareOffTime)) {
      skip(e, `After the ${squareOffTime} square-off — switch “Square off daily” off to hold trades overnight`);
      continue;
    }
    const candles = x.minutes(inst);
    const ref = e.prices[rule.leg] ?? candles.filter((c) => c.time * 1000 + MINUTE <= e.at).at(-1)?.close;
    if (ref === undefined || !(ref > 0)) {
      skip(e, `No price for ${inst.symbol}`);
      continue;
    }
    const draft = buildTrade({
      plan,
      instrument: inst,
      productKind: product.kind,
      side: rule.side,
      ref,
      at: e.at,
      ids: { strategyId: strategy.id, connectionId: `backtest:${e.productId}`, productId: e.productId, slot, unitKey: e.unit.key, alertId: null },
      group: fired,
      leg: rule.leg,
    });
    if (x.capital !== null) {
      const free = x.capital + realized - inUse;
      if (draft.capitalUsed > free) {
        skip(e, `Not enough money: needs ${inr(draft.capitalUsed)}${draft.marginEstimated ? ' margin (est.)' : ''}, ${inr(Math.max(0, free))} free`);
        continue;
      }
    }
    const t: PaperTrade = { ...draft, id: `bt-${++n}` };
    const first = candles.findIndex((c) => c.time * 1000 >= e.at);
    const exits = x.exitsFor(e, exitKey(rule.group)).filter((at) => at > e.at);
    open.set(slot, { t, candles, i: first < 0 ? candles.length : first, lastClose: ref, deadline: exitDeadline(t, cal), exits });
    inUse += t.capitalUsed;
  }
  // Play out what's still open, then close the rest at the last price.
  for (const o of [...open.values()]) if (!advance(o, x.end)) finish(o, o.lastClose, 'END', Math.min(x.end, (o.candles.at(-1)?.time ?? x.end / 1000) * 1000 + MINUTE));

  return { closed, skipped };
}
