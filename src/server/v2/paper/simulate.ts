/**
 * The money side of a backtest, shared by the Kite backtest (today's contracts) and the Options backtest
 * (Upstox's expired contracts): alerts in time order, each traded exactly like a paper trade (the same plan,
 * buildTrade / stopNow / settle), the exits walked on the traded contract's 1-minute candles.
 *
 *   entry     the leg's close on the alert's trigger candle ± slippage; futures / options the plan's lots,
 *             stocks the shares the ₹ per trade covers — no account limit, like paper trading
 *   exits     stop-loss / trailing stop / target inside each minute (a stop and the target in one minute → the
 *             stop; a gap past the stop fills at the minute's open; the trailing stop follows the best price of
 *             the minutes before), a trailing rule coming true (at that candle's close), the other group firing,
 *             the day's square-off, expiry, or the end of the test (still open → the last price)
 *   trailing  Trailing SL on: the minute that reaches the target starts the trailing rules (from the candles
 *             closing after it) instead of closing the trade; from there the stop-loss and target no longer apply
 *   path      each closed trade carries its price path (story.ts) — what its story shows
 *   one open position per product (a backtest tests one strike position)
 */
import type { BacktestSkip, PaperExitReason, PaperPlan, PaperTrade, StrategyDefinition, V2Instrument, V2Product, V2Strategy, V2Unit } from '@/shared/v2';
import { atTarget, conditionKey, nodeText, paperGroups, planSizing, tradePath, trailing, trailingRules, trailsPastTarget, watchWindow } from '@/shared/v2';
import { exitDefinition } from '../engine/series';
import { istDate } from '../../utils/marketTime';
import type { MarketCalendar } from '../calendar/MarketCalendar';
import type { RawCandle } from '../engine/candles';
import { buildTrade, exitDeadline, firedGroupOf, newPeak, settle, squareOffAt, stopNow, tradeConditions } from './PaperTrader';

const MINUTE = 60_000;

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
  products: Map<string, V2Product>;
  calOf: (productId: string) => MarketCalendar;
  /** Every alert, in time order (money is shared across products). */
  alerts: SimAlert[];
  /** A contract's 1-minute candles, ascending (empty when there are none). */
  minutes: (instrument: V2Instrument) => RawCandle[];
  /** Candle closes (ms, ascending) where a rule's trailing rules are true (`conditionKey(group)`). */
  exitsFor: (alert: SimAlert, key: string) => number[];
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
  /** Candle closes after entry where the trade's trailing rules are true (ascending). */
  exits: number[];
  /** Next of `exits` to look at (the ones before trailing started are passed over). */
  x: number;
}

/** What a backtest's notes say about how its trades were made and closed (both backtests). */
export function planNotes(d: StrategyDefinition, plan: PaperPlan, opts: { conditionLegs: string; markets: Array<'NSE' | 'MCX'> }): string[] {
  const tf = d.evaluation.triggerTimeframe;
  const sizing = planSizing(d, plan.rules);
  const groups = paperGroups(d);
  return [
    ...(plan.squareOff && (tf === '1d' || tf === '1w')
      ? ['Daily / weekly candles close after the day’s square-off time, so with “Square off daily” on no alert can be traded — switch it off to hold positions overnight.']
      : []),
    ...(plan.watch && tf !== '1d' && tf !== '1w'
      ? [
          `Watched only ${opts.markets
            .map((m) => {
              const w = watchWindow(plan, m)!;
              return `${w.from}–${w.to}${opts.markets.length > 1 ? ` (${m === 'MCX' ? 'MCX' : 'NSE / BSE'})` : ''}`;
            })
            .join(', ')}: trigger candles outside it sent no alert and opened no trade.`,
        ]
      : []),
    'Each alert is entered at its trigger candle’s close (± slippage) and exited on the traded contract’s 1-minute candles; if a stop and the target fall in the same minute the stop counts.',
    ...(sizing.lots ? [`Futures and options: ${plan.lotsPerTrade} lot${plan.lotsPerTrade === 1 ? '' : 's'} per trade, at each contract’s own lot size.`] : []),
    ...(sizing.cash ? [`Stocks: as many shares as ₹${plan.cashPerTrade.toLocaleString('en-IN')} buys at the entry (at least one).`] : []),
    ...(plan.trailing
      ? ['Trailing SL on: trades don’t close at the target — reaching it starts the trailing rules, and from there the stop-loss and target no longer apply.']
      : []),
    ...trailingRules(plan).map((x) => {
      const group = groups.find((g) => g.id === x.group)?.label;
      return `Trailing rules${group ? ` (${group})` : ''}: ${nodeText(x.when, d.legs)} — checked from the target on, at each ${exitDefinition(d, x.when).evaluation.triggerTimeframe} candle close${opts.conditionLegs}; the trade exits at that close.`;
    }),
  ];
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
  let n = 0;

  const finish = (o: Open, price: number, reason: PaperExitReason, at: number) => {
    const s = settle(o.t, price, reason);
    const exitAt = new Date(at).toISOString();
    const path = tradePath(o.candles, Date.parse(o.t.entryAt), at);
    closed.push({ ...o.t, ...s, status: 'CLOSED', exitAt, exitReason: reason, lastPrice: price, lastPriceAt: exitAt, ...(path ? { path } : {}) });
    open.delete(o.t.slot);
  };

  /** The next timed exit: the square-off / expiry deadline or a trailing rule (once trailing is on), whichever is first. */
  const due = (o: Open): { at: number; reason: PaperExitReason } | null => {
    let rule: number | undefined;
    if (trailing(o.t)) {
      const since = Date.parse(o.t.trailingAt ?? o.t.entryAt);
      while (o.x < o.exits.length && o.exits[o.x]! <= since) o.x++;
      rule = o.exits[o.x];
    }
    if (rule !== undefined && (!o.deadline || rule < o.deadline.at)) return { at: rule, reason: 'STOP_RULE' };
    return o.deadline;
  };

  /** Walk a trade's minutes that closed by `until`; true when it closed. */
  const advance = (o: Open, until: number): boolean => {
    const buy = o.t.side === 'BUY';
    while (o.i < o.candles.length) {
      const t = o.t;
      const c = o.candles[o.i]!;
      const t0 = c.time * 1000;
      if (t0 + MINUTE > until) break;
      const next = due(o);
      if (next && t0 >= next.at) {
        finish(o, o.lastClose, next.reason, next.at);
        return true;
      }
      // The stop as it stood when this minute opened (the trailing stop follows the minutes before).
      const stop = stopNow(t);
      const hitStop = stop !== null && (buy ? c.low <= stop.price : c.high >= stop.price);
      const hitTarget = atTarget(t, buy ? c.high : c.low);
      if (hitStop) {
        // A gap through the stop fills at the minute's open.
        finish(o, buy ? Math.min(stop.price, c.open) : Math.max(stop.price, c.open), stop.reason, t0 + MINUTE);
        return true;
      }
      const trails = trailsPastTarget(t);
      if (hitTarget && !trails) {
        finish(o, t.targetPrice!, 'TARGET', t0 + MINUTE);
        return true;
      }
      const peak = newPeak(t, buy ? c.high : c.low);
      // Reaching the target starts trailing (the trailing stop from the next minute, the rules from the candles closing after this one opened).
      const starts = hitTarget && trails && !t.trailingAt;
      if (peak !== undefined || starts) o.t = { ...t, ...(peak !== undefined ? { peakPrice: peak } : {}), ...(starts ? { trailingAt: new Date(t0).toISOString() } : {}) };
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
      conditions: tradeConditions(rule, d, e.unit),
    });
    const t: PaperTrade = { ...draft, id: `bt-${++n}` };
    const first = candles.findIndex((c) => c.time * 1000 >= e.at);
    const exits = x.exitsFor(e, conditionKey(rule.group)).filter((at) => at > e.at);
    open.set(slot, { t, candles, i: first < 0 ? candles.length : first, lastClose: ref, deadline: exitDeadline(t, cal), exits, x: 0 });
  }
  // Play out what's still open, then close the rest at the last price.
  for (const o of [...open.values()]) if (!advance(o, x.end)) finish(o, o.lastClose, 'END', Math.min(x.end, (o.candles.at(-1)?.time ?? x.end / 1000) * 1000 + MINUTE));

  return { closed, skipped };
}
