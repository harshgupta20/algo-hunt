/**
 * Backtest a strategy on products with money: the alerts it would have sent over past candles (the same
 * evaluation as Compare), each traded exactly like a paper trade, the exits found on the traded contract's
 * 1-minute Kite candles.
 *
 *   entry     the leg's close on the alert's trigger candle ± slippage; whole lots for the cash per trade
 *   money     a trade opens only if the starting capital + realised P&L − money already in use covers it
 *   exits     stop-loss / target inside each minute (both in one minute → the stop; a gap past the stop fills
 *             at the minute's open), the other group firing, the day's square-off, expiry, or the end of the
 *             test (still open → closed at the last price)
 *   one open position per product (Compare tests one strike position)
 *
 * Limits (as Compare): contracts are those listed today with their strikes fixed at the start of the period,
 * and Kite has no candles for expired contracts.
 */
import type { BacktestProduct, BacktestRequest, BacktestResult, BacktestSkip, PaperExitReason, PaperTrade, StrategyDefinition, V2Instrument, V2Strategy, V2Unit } from '@/shared/v2';
import { resolveRules } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import { calendars, dateStartMs, type MarketCalendar } from '../calendar/MarketCalendar';
import type { V2DataProvider } from '../data/DataProvider';
import type { V2Tools } from '../debug/tools';
import type { RawCandle } from '../engine/candles';
import type { V2Store } from '../persistence/V2Store';
import { buildTrade, exitDeadline, firedGroupOf, settle, squareOffAt } from './PaperTrader';
import { breakdowns, paperStats, spark } from './summary';

const MINUTE = 60_000;
const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export interface BacktestDeps {
  store: V2Store;
  provider: V2DataProvider;
  tools: V2Tools;
  now: () => number;
}

interface Open {
  t: PaperTrade;
  candles: RawCandle[];
  /** Next minute candle to look at. */
  i: number;
  lastClose: number;
  deadline: { at: number; reason: 'SQUARE_OFF' | 'EXPIRY' } | null;
}

interface AlertEvent {
  at: number;
  productId: string;
  unit: V2Unit;
  prices: Partial<Record<string, number>>;
  trace: Parameters<typeof firedGroupOf>[1];
}

export async function runBacktest(deps: BacktestDeps, strategy: V2Strategy, req: BacktestRequest): Promise<BacktestResult> {
  const d: StrategyDefinition = strategy.definition;
  const tf = d.evaluation.triggerTimeframe;
  const now = deps.now();
  const ids = [...new Set(req.products)];
  const cmp = await deps.tools.compare(d, { products: ids, from: req.from, to: req.to, expiry: req.expiry, strikeShift: req.strikeShift, trigger: req.trigger, cooldownMinutes: req.cooldownMinutes ?? null });
  const cals = calendars(await deps.store.calendar.list());
  const products = new Map((await deps.store.products.list({ ids })).map((p) => [p.id, p]));
  const plan = { ...req.plan, enabled: true, rules: resolveRules(d, req.plan.rules) };
  const end = Math.min(now, dateStartMs(addDays(req.to, 1)));
  let requests = cmp.requests;
  const calOf = (productId: string): MarketCalendar => cals[products.get(productId)?.market ?? 'NSE'];

  // Alerts in time order, across products (money is shared).
  const events: AlertEvent[] = [];
  for (const r of cmp.products) {
    if (!r.unit) continue;
    for (const a of r.alerts) events.push({ at: calOf(r.productId).candleClose(a.candleTime * 1000, tf), productId: r.productId, unit: r.unit, prices: a.prices, trace: a.trace });
  }
  events.sort((a, b) => a.at - b.at);

  // 1-minute candles of every contract a rule trades.
  const errors = new Map<string, string[]>();
  const pushError = (productId: string, e: string) => errors.set(productId, [...(errors.get(productId) ?? []), e]);
  const traded = new Map<number, { inst: V2Instrument; productId: string }>();
  for (const r of cmp.products) for (const rule of plan.rules) if (r.unit && rule.leg && r.unit.legs[rule.leg]) traded.set(r.unit.legs[rule.leg]!.token, { inst: r.unit.legs[rule.leg]!, productId: r.productId });
  const minutes = new Map<number, RawCandle[]>();
  for (const { inst, productId } of traded.values()) {
    try {
      const rows = await deps.provider.getHistoricalCandles({ instrument: inst, interval: '1m', from: req.from, to: req.to });
      requests++;
      minutes.set(inst.token, [...rows].sort((a, b) => a.time - b.time));
      if (!rows.length) pushError(productId, `No 1-minute candles for ${inst.symbol} in the period — its trades close only at square-off / the end of the test`);
    } catch (err) {
      pushError(productId, `1-minute candles for ${inst.symbol}: ${msg(err)}`);
    }
  }

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

  /** Walk a trade's minutes that closed by `until`; true when it closed. */
  const advance = (o: Open, until: number): boolean => {
    const t = o.t;
    const buy = t.side === 'BUY';
    while (o.i < o.candles.length) {
      const c = o.candles[o.i]!;
      const t0 = c.time * 1000;
      if (t0 + MINUTE > until) break;
      if (o.deadline && t0 >= o.deadline.at) {
        finish(o, o.lastClose, o.deadline.reason, o.deadline.at);
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
    if (o.deadline && until > o.deadline.at && (o.i >= o.candles.length || o.candles[o.i]!.time * 1000 >= o.deadline.at)) {
      finish(o, o.lastClose, o.deadline.reason, o.deadline.at);
      return true;
    }
    return false;
  };

  const skip = (e: AlertEvent, reason: string) => skipped.push({ productId: e.productId, at: new Date(e.at).toISOString(), reason });

  for (const e of events) {
    for (const o of [...open.values()]) advance(o, e.at);
    const product = products.get(e.productId);
    if (!product) continue;
    const cal = calOf(e.productId);
    const fired = firedGroupOf(d, e.trace);
    const rule = plan.rules.find((r) => r.group === (fired?.id ?? null)) ?? plan.rules[0];
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
    if (plan.squareOff && e.at >= squareOffAt(cal, istDate(e.at), product.market === 'MCX' ? plan.squareOffMcx : plan.squareOffNse)) {
      skip(e, 'After the square-off time');
      continue;
    }
    const candles = minutes.get(inst.token) ?? [];
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
    if (req.capital !== null) {
      const free = req.capital + realized - inUse;
      if (draft.capitalUsed > free) {
        skip(e, `Not enough money: needs ${inr(draft.capitalUsed)}${draft.marginEstimated ? ' margin (est.)' : ''}, ${inr(Math.max(0, free))} free`);
        continue;
      }
    }
    const t: PaperTrade = { ...draft, id: `bt-${++n}` };
    const first = candles.findIndex((c) => c.time * 1000 >= e.at);
    open.set(slot, { t, candles, i: first < 0 ? candles.length : first, lastClose: ref, deadline: exitDeadline(t, cal) });
    inUse += t.capitalUsed;
  }
  // Play out what's still open, then close the rest at the last price.
  for (const o of [...open.values()]) if (!advance(o, end)) finish(o, o.lastClose, 'END', Math.min(end, (o.candles.at(-1)?.time ?? end / 1000) * 1000 + MINUTE));

  const byProduct = (id: string) => closed.filter((t) => t.productId === id);
  const results: BacktestProduct[] = cmp.products.map((r) => {
    const list = byProduct(r.productId);
    const unitContracts = r.unit ? Object.entries(r.unit.legs).map(([leg, i]) => `${leg}: ${i ? i.symbol : 'not listed'}`) : [];
    return {
      productId: r.productId,
      symbol: products.get(r.productId)?.symbol ?? r.productId.split(':')[1] ?? r.productId,
      name: r.productName,
      alerts: r.alerts.length,
      trades: list.length,
      skipped: skipped.filter((s) => s.productId === r.productId).length,
      stats: paperStats(list, end),
      spark: spark(list),
      contracts: unitContracts,
      notes: r.notes,
      errors: [...r.errors, ...(errors.get(r.productId) ?? [])],
    };
  });

  const overall = paperStats(closed, end);
  let cum = 0;
  let low = 0;
  for (const t of [...closed].sort((a, b) => (a.exitAt ?? '').localeCompare(b.exitAt ?? ''))) low = Math.min(low, (cum += t.netPnl ?? 0));
  const capital = req.capital;
  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    from: req.from,
    to: req.to,
    triggerTimeframe: tf,
    capital,
    finalCapital: capital === null ? null : round2(capital + overall.netPnl),
    returnOnCapitalPct: capital ? round2((overall.netPnl / capital) * 100) : null,
    lowestCapital: capital === null ? null : round2(capital + low),
    summary: { from: req.from, overall, strategies: [], connections: [], ...breakdowns(closed) },
    products: results.sort((a, b) => b.stats.netPnl - a.stats.netPnl),
    trades: [...closed].sort((a, b) => b.entryAt.localeCompare(a.entryAt)),
    skipped,
    requests,
    notes: [
      'Each alert is entered at its trigger candle’s close (± slippage) and exited on the traded contract’s 1-minute candles; if the target and stop-loss fall in the same minute the stop counts.',
      ...cmp.notes.map((x) => x.replace('Alerts only (no trade scoring). ', '')),
    ],
  };
}
