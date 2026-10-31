/**
 * Options backtest: the Backtest on contracts as they were listed — expired ones included (Upstox keeps about
 * six months) — instead of today's contracts with strikes fixed for the whole period. Every trigger candle is
 * decided the way the live scanner decides it:
 *
 *   ATM       the index / stock close on the trigger candle (the scanner reads its live price at that close)
 *   unit      the expiry the connection would pick that day (current / next / far among the expiries listed
 *             then) and the strike nearest ATM (+ strike position), resolved by the scanner's own resolveUnits —
 *             each contract with its own lot size and tick
 *   alert     the scanner's policy per unit (unit = expiry + base strike): a unit seen for the first time, or
 *             again after ATM moved away, has its previous candle re-evaluated, exactly as the scanner does
 *   trade     simulate.ts — the same money, fills and exits as the Backtest and paper trading; exit rules are
 *             checked on the legs of the unit the trade was opened on
 *
 * Only days whose expiry schedule is fully known are tested (see OptionsHistory.coveredFrom); the rest are
 * named in the notes. Candles: the history serves past days, so the test ends on the last complete day.
 */
import type { BacktestProduct, BacktestRequest, BacktestResult, ConnectionConfig, LegId, SeriesSpec, StrategyDefinition, TriState, UnitState, V2Instrument, V2Product, V2Strategy, V2Unit } from '@/shared/v2';
import { TIMEFRAME, legNameById, nodeText, paperGroups, resolveRules } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import { decide, initialState } from '../alerts/alertPolicy';
import { calendars, dateStartMs, lastCompleteDay, type MarketCalendar } from '../calendar/MarketCalendar';
import { LOOKBACK_DAYS } from '../data/CandleService';
import type { NativeInterval } from '../data/DataProvider';
import type { HistoryStats, OptionsHistory } from '../data/OptionsHistory';
import { exitDefinition, triggerOpens } from '../debug/tools';
import { buildSeries, type Candle, type RawCandle } from '../engine/candles';
import { alignIndex, evaluateUnit, type SeriesLookup, type UnitEvalInput } from '../engine/evaluator';
import { legInstrument, seriesKey, seriesOf } from '../engine/series';
import type { V2Store } from '../persistence/V2Store';
import { hasOptionLegs, resolveUnits } from '../universe/resolve';
import type { BacktestRun } from './backtest';
import { exitKey, ruleFor, simulate, type SimAlert } from './simulate';
import { breakdowns, paperStats, spark } from './summary';

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const NORMAL: SeriesSpec['candle'] = { type: 'NORMAL' };
/** Span fetches in flight at once (the history's rate gate paces them). */
const PARALLEL = 4;

export interface OptionsBacktestDeps {
  store: V2Store;
  history: OptionsHistory;
  now: () => number;
}

/**
 * Candles fetched for this run: one contiguous span per (contract, native interval) — widened (fetched again,
 * from the history's memory) when a later step needs more, so no series ever has a hole.
 */
class SpanStore {
  private readonly spans = new Map<string, { inst: V2Instrument; interval: NativeInterval; from: string; to: string; rows: RawCandle[] }>();
  private readonly built = new Map<string, Candle[]>();
  private readonly wants = new Map<string, { inst: V2Instrument; interval: NativeInterval; from: string; to: string }>();

  constructor(
    private readonly history: OptionsHistory,
    private readonly cal: MarketCalendar,
    private readonly until: number,
    private readonly stats: HistoryStats,
  ) {}

  private static key(inst: V2Instrument, interval: NativeInterval) {
    return `${inst.token}|${interval}`;
  }

  /** Ask for [from, to] of a contract's native candles (fetched by `load`). */
  want(inst: V2Instrument, interval: NativeInterval, from: string, to: string): void {
    const k = SpanStore.key(inst, interval);
    const w = this.wants.get(k);
    this.wants.set(k, w ? { inst, interval, from: from < w.from ? from : w.from, to: to > w.to ? to : w.to } : { inst, interval, from, to });
  }

  /** Fetch what was asked and isn't held yet; returns the failures (contract symbol → message). */
  async load(checkpoint: () => void): Promise<Array<{ symbol: string; error: string }>> {
    const todo = [...this.wants.values()].filter((w) => {
      const have = this.spans.get(SpanStore.key(w.inst, w.interval));
      return !have || have.from > w.from || have.to < w.to;
    });
    this.wants.clear();
    const failed: Array<{ symbol: string; error: string }> = [];
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        checkpoint();
        const w = todo[next++]!;
        const k = SpanStore.key(w.inst, w.interval);
        const have = this.spans.get(k);
        const from = have && have.from < w.from ? have.from : w.from;
        const to = have && have.to > w.to ? have.to : w.to;
        try {
          const rows = await this.history.candles(w.inst, w.interval, from, to, this.stats);
          this.spans.set(k, { inst: w.inst, interval: w.interval, from, to, rows });
          for (const b of [...this.built.keys()]) if (b.startsWith(`${w.inst.token}|`)) this.built.delete(b);
        } catch (err) {
          failed.push({ symbol: w.inst.symbol, error: msg(err) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
    return failed;
  }

  raw(inst: V2Instrument, interval: NativeInterval): RawCandle[] {
    return this.spans.get(SpanStore.key(inst, interval))?.rows ?? [];
  }

  lookup: SeriesLookup = (inst, spec) => {
    const key = seriesKey(inst, spec);
    const hit = this.built.get(key);
    if (hit) return { candles: hit };
    const span = this.spans.get(SpanStore.key(inst, TIMEFRAME[spec.timeframe].native));
    if (!span) return { error: 'no candles fetched for this contract' };
    const candles = buildSeries(span.rows, spec.timeframe, spec.candle, this.cal, this.until);
    this.built.set(key, candles);
    return { candles };
  };
}

interface ProductRun {
  product: V2Product | undefined;
  productId: string;
  alerts: SimAlert[];
  /** Trigger candles tested / with enough data to decide. */
  candles: number;
  decided: number;
  contracts: Map<LegId, Map<string, V2Instrument>>;
  notes: string[];
  errors: string[];
  store: SpanStore | null;
}

export async function runOptionsBacktest(deps: OptionsBacktestDeps, strategy: V2Strategy, req: BacktestRequest, run?: BacktestRun): Promise<BacktestResult> {
  const d: StrategyDefinition = strategy.definition;
  const tf = d.evaluation.triggerTimeframe;
  const now = deps.now();
  const ids = [...new Set(req.products)];
  const cals = calendars(await deps.store.calendar.list());
  const cal = cals.NSE;
  const products = new Map((await deps.store.products.list({ ids })).map((p) => [p.id, p]));
  const plan = { ...req.plan, enabled: true, rules: resolveRules(d, req.plan.rules) };
  const stats = run?.stats ?? { fetched: 0, cached: 0 };
  const checkpoint = () => run?.checkpoint();
  const notes: string[] = [];

  const lastDay = lastCompleteDay(cal, now);
  const to = req.to > lastDay ? lastDay : req.to;
  if (to < req.to) notes.push(`${deps.history.name} serves complete past days only — the test ends on ${to}.`);
  if (req.from > to) throw new Error(`${deps.history.name} has no complete day between ${req.from} and ${req.to} yet — choose a period ending on or before ${lastDay}`);
  const from = req.from;
  const until = dateStartMs(addDays(to, 1));
  const options = hasOptionLegs(d.legs);
  const futures = d.legs.some((l) => l.kind === 'FUT');
  const config: Pick<ConnectionConfig, 'expiry' | 'strikeShifts'> = { expiry: req.expiry ?? { mode: 'CURRENT' }, strikeShifts: [req.strikeShift ?? 0] };
  const policy = { channels: { telegram: false, email: false }, trigger: req.trigger ?? 'ON_TRANSITION', cooldownMinutes: req.cooldownMinutes ?? null, oncePerCandle: true } as const;
  const exitDefs = (req.exits ?? []).map((x) => ({ key: exitKey(x.group), def: exitDefinition(d, x.when) }));
  const series = seriesOf(d);
  const triggerNative = TIMEFRAME[tf].native;
  const lookbackFrom = (date: string, interval: NativeInterval) => addDays(date, -LOOKBACK_DAYS[interval]);
  /** The last day a trade opened at `at` on `inst` can still be open. */
  const horizon = (at: number, inst: V2Instrument | null | undefined) => {
    if (plan.squareOff) return istDate(at);
    const e = inst?.expiry;
    return e && e < to ? e : to;
  };

  const runs: ProductRun[] = [];
  for (const [index, id] of ids.entries()) {
    checkpoint();
    const product = products.get(id);
    run?.progress({ phase: 'CANDLES', done: index, total: ids.length, current: product?.symbol ?? id });
    const r: ProductRun = { product, productId: id, alerts: [], candles: 0, decided: 0, contracts: new Map(), notes: [], errors: [], store: null };
    runs.push(r);
    if (!product) {
      r.errors.push('Not in the product catalogue — sync products');
      continue;
    }
    if (product.market === 'MCX') {
      r.errors.push(`${deps.history.name} has no expired MCX contracts — the Options backtest covers NSE and BSE products`);
      continue;
    }
    try {
      const list = await deps.history.contracts(product, { from, to }, { options, futures }, stats);
      r.notes.push(...list.notes);
      const all = [list.spot, ...list.contracts];
      const store = new SpanStore(deps.history, cal, until, stats);
      r.store = store;

      // Trigger candles on days whose expiry schedule is known.
      const inGap = (date: string) => list.gaps.some((g) => date >= g.from && date <= g.to);
      const covered = (date: string) => (!options && !futures) || (list.coveredFrom !== null && date >= list.coveredFrom && !inGap(date));
      const allOpens = triggerOpens(cal, from, to, tf, until);
      const opens = allOpens.filter((o) => covered(istDate(o)));
      r.candles = opens.length;
      const skippedDays = new Set(allOpens.filter((o) => !covered(istDate(o))).map((o) => istDate(o)));
      if (skippedDays.size) {
        const days = [...skippedDays].sort();
        const why = list.coveredFrom === null ? `${deps.history.name} lists no contracts for this product` : `${deps.history.name}’s contract history is complete from ${list.coveredFrom}`;
        r.notes.push(`${days.length} day(s) not tested (${days[0]}${days.length > 1 ? ` … ${days.at(-1)}` : ''}): ${why}`);
        if (!opens.length) r.errors.push(`No day of the period could be tested — ${why}${list.coveredFrom ? `; choose dates from ${list.coveredFrom} on` : ''}`);
      }
      if (!opens.length) continue;

      // ATM: the spot's close on each trigger candle.
      const atm = new Map<number, number>();
      if (options) {
        store.want(list.spot, triggerNative, lookbackFrom(istDate(opens[0]!), triggerNative), to);
        for (const f of await store.load(checkpoint)) r.errors.push(`${f.symbol}: ${f.error}`);
        const res = store.lookup(list.spot, { leg: 'A', timeframe: tf, candle: NORMAL });
        if (!('error' in res)) {
          for (const open of opens) {
            const i = alignIndex(res.candles, 'COMPLETED_CANDLE', cal.candleClose(open, tf));
            const c = i >= 0 ? res.candles[i] : undefined;
            // Only the trigger candle itself (or the session's last before it) — never a stale day.
            if (c && istDate(c.time * 1000) === istDate(open)) atm.set(open, c.close);
          }
        }
      }

      // Plan: each candle's unit (no option candles needed yet), and the spans its legs need.
      const units = new Map<number, V2Unit>();
      const unresolved = new Map<string, number>();
      for (const open of opens) {
        const date = istDate(open);
        const price = options ? atm.get(open) : undefined;
        if (options && price === undefined) {
          unresolved.set(`No ${list.spot.symbol} candle at the trigger candle — ATM unknown`, (unresolved.get(`No ${list.spot.symbol} candle at the trigger candle — ATM unknown`) ?? 0) + 1);
          continue;
        }
        const res = resolveUnits(d, id, all, config, price, date);
        const unit = res.units[0];
        if (!unit) {
          const why = res.errors[0] ?? res.notes[0] ?? 'no contract resolved';
          unresolved.set(why, (unresolved.get(why) ?? 0) + 1);
          continue;
        }
        units.set(open, unit);
        for (const s of series) {
          const inst = legInstrument(s.leg, unit);
          if (!inst) continue;
          const native = TIMEFRAME[s.timeframe].native;
          store.want(inst, native, lookbackFrom(date, native), date);
        }
        for (const [leg, inst] of Object.entries(unit.legs) as Array<[LegId, V2Instrument | null]>) {
          if (!inst) continue;
          const m = r.contracts.get(leg) ?? new Map<string, V2Instrument>();
          m.set(inst.id, inst);
          r.contracts.set(leg, m);
        }
      }
      for (const [why, n] of unresolved) r.notes.push(`${n} candle(s) not evaluated: ${why}`);
      for (const f of await store.load(checkpoint)) r.errors.push(`${f.symbol}: ${f.error}`);

      // Evaluate in time order, one alert state per unit — as the scanner keeps them.
      const states = new Map<string, UnitState>();
      const memo = new Map<string, unknown>();
      for (const open of opens) {
        const unit = units.get(open);
        if (!unit) continue;
        const at = cal.candleClose(open, tf);
        const input: UnitEvalInput = { strategyId: strategy.id, version: strategy.version, productId: id, definition: d, unit, lookup: store.lookup, triggerOpenMs: open, at, mode: 'COMPLETED_CANDLE', memo };
        const e = evaluateUnit(input);
        if (e.result !== 'UNKNOWN') r.decided++;
        const state = states.get(unit.key) ?? initialState('options-backtest', unit.key);
        // The previous candle's result: stored when this unit evaluated exactly that candle, else re-evaluated.
        const prevOpen = cal.lastCompletedOpen(open, tf);
        let prev: TriState | null = null;
        if (prevOpen !== null) prev = state.lastEvaluatedCandle === Math.floor(prevOpen / 1000) ? state.lastResult : evaluateUnit({ ...input, triggerOpenMs: prevOpen, at: cal.candleClose(prevOpen, tf) }).result;
        const decision = decide({ policy, state, result: e.result, prevResult: prev, triggerCandle: e.triggerCandle, at, now: at, enabledAt: null, mode: 'COMPLETED_CANDLE' });
        states.set(unit.key, { ...decision.next, lastEvaluatedCandle: e.triggerCandle });
        if (decision.outcome) r.alerts.push({ at, productId: id, unit, prices: e.prices, trace: e.trace });
      }
      if (r.candles && r.decided < r.candles) r.notes.push(`${r.candles - r.decided} of ${r.candles} candles had too little data to decide`);

      // What the alerts' trades read: the traded contract's minutes and the exit rules' series, to their horizon.
      for (const a of r.alerts) {
        const date = istDate(a.at);
        const leg = ruleFor(d, plan, a.trace).rule?.leg;
        const traded = leg ? a.unit.legs[leg] : null;
        const last = horizon(a.at, traded);
        if (traded) store.want(traded, '1m', date, last);
        for (const x of exitDefs) {
          for (const s of seriesOf(x.def)) {
            const inst = legInstrument(s.leg, a.unit);
            const native = TIMEFRAME[s.timeframe].native;
            if (inst) store.want(inst, native, lookbackFrom(date, native), last);
          }
        }
      }
      for (const f of await store.load(checkpoint)) r.errors.push(`${f.symbol}: ${f.error}`);
    } catch (err) {
      if ((err as Error)?.name === 'BacktestCancelled') throw err;
      r.errors.push(msg(err));
    }
  }
  run?.progress({ phase: 'TRADES', done: ids.length, total: ids.length, current: null });

  // Exit rules per alert (its own unit), evaluated when a trade asks.
  const byAlert = new Map<SimAlert, ProductRun>();
  for (const r of runs) for (const a of r.alerts) byAlert.set(a, r);
  const exitMemo = new Map<SimAlert, Map<string, number[]>>();
  const exitsFor = (a: SimAlert, key: string): number[] => {
    const r = byAlert.get(a);
    const x = exitDefs.find((e) => e.key === key);
    if (!r?.store || !x) return [];
    const done = exitMemo.get(a)?.get(key);
    if (done) return done;
    const xtf = x.def.evaluation.triggerTimeframe;
    const leg = ruleFor(d, plan, a.trace).rule?.leg;
    const last = horizon(a.at, leg ? a.unit.legs[leg] : null);
    const memo = new Map<string, unknown>();
    const times: number[] = [];
    for (const open of triggerOpens(cal, istDate(a.at), last, xtf, until)) {
      const at = cal.candleClose(open, xtf);
      if (at <= a.at) continue;
      const res = evaluateUnit({ strategyId: strategy.id, version: strategy.version, productId: a.productId, definition: x.def, unit: a.unit, lookup: r.store.lookup, triggerOpenMs: open, at, mode: 'COMPLETED_CANDLE', memo });
      if (res.result === 'TRUE') times.push(at);
    }
    const m = exitMemo.get(a) ?? new Map<string, number[]>();
    m.set(key, times);
    exitMemo.set(a, m);
    return times;
  };

  const alerts = runs.flatMap((r) => r.alerts).sort((a, b) => a.at - b.at);
  const end = until;
  const { closed, skipped } = simulate({
    strategy,
    plan,
    capital: req.capital,
    products,
    calOf: (productId) => cals[products.get(productId)?.market ?? 'NSE'],
    alerts,
    minutes: (inst) => {
      for (const r of runs) {
        if (r.productId !== inst.productId || !r.store) continue;
        return r.store.raw(inst, '1m');
      }
      return [];
    },
    exitsFor,
    end,
  });

  const results: BacktestProduct[] = runs.map((r) => {
    const list = closed.filter((t) => t.productId === r.productId);
    const contracts = [...r.contracts].sort(([a], [b]) => a.localeCompare(b)).map(([leg, m]) => {
      const insts = [...m.values()].sort((a, b) => (a.expiry ?? '').localeCompare(b.expiry ?? '') || (a.strike ?? 0) - (b.strike ?? 0));
      const expiries = new Set(insts.map((i) => i.expiry)).size;
      const name = legNameById(leg, d.legs);
      return insts.length === 1 ? `${name}: ${insts[0]!.symbol}` : `${name}: ${insts.length} contracts over ${expiries} expir${expiries === 1 ? 'y' : 'ies'} (${insts[0]!.symbol} … ${insts.at(-1)!.symbol})`;
    });
    return {
      productId: r.productId,
      symbol: r.product?.symbol ?? r.productId.split(':')[1] ?? r.productId,
      name: r.product?.name ?? r.productId,
      alerts: r.alerts.length,
      trades: list.length,
      skipped: skipped.filter((s) => s.productId === r.productId).length,
      stats: paperStats(list, end),
      spark: spark(list),
      contracts,
      notes: r.notes,
      errors: r.errors,
    };
  });

  const overall = paperStats(closed, end);
  let cum = 0;
  let low = 0;
  for (const t of [...closed].sort((a, b) => (a.exitAt ?? '').localeCompare(b.exitAt ?? ''))) low = Math.min(low, (cum += t.netPnl ?? 0));
  const capital = req.capital;
  const expiryName = config.expiry.mode === 'SPECIFIC' ? config.expiry.date : config.expiry.mode.toLowerCase();
  const shift = req.strikeShift ?? 0;
  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    from,
    to,
    triggerTimeframe: tf,
    capital,
    finalCapital: capital === null ? null : round2(capital + overall.netPnl),
    returnOnCapitalPct: capital ? round2((overall.netPnl / capital) * 100) : null,
    lowestCapital: capital === null ? null : round2(capital + low),
    summary: { from, overall, strategies: [], connections: [], ...breakdowns(closed) },
    products: results.sort((a, b) => b.stats.netPnl - a.stats.netPnl),
    trades: [...closed].sort((a, b) => b.entryAt.localeCompare(a.entryAt)),
    skipped,
    requests: stats.fetched,
    source: 'UPSTOX',
    notes: [
      ...notes,
      ...(options
        ? [
            `Contracts as they were listed, from ${deps.history.name} (expired ones included): at every trigger candle the ${expiryName} expiry of that day and the strike nearest the index’s close${shift ? ` ${shift > 0 ? '+' : '−'}${Math.abs(shift)}` : ''} — re-picked like the live scanner, each contract with its own lot size.`,
          ]
        : []),
      ...(plan.squareOff && (tf === '1d' || tf === '1w')
        ? ['Daily / weekly candles close after the day’s square-off time, so with “Square off daily” on no alert can be traded — switch it off to hold positions overnight.']
        : []),
      'Each alert is entered at its trigger candle’s close (± slippage) and exited on the traded contract’s 1-minute candles; if the target and stop-loss fall in the same minute the stop counts.',
      ...(req.exits ?? []).map((x) => {
        const group = paperGroups(d).find((g) => g.id === x.group)?.label;
        return `Exit rule${group ? ` (${group})` : ''}: ${nodeText(x.when, d.legs)} — checked at each ${exitDefinition(d, x.when).evaluation.triggerTimeframe} candle close on the legs the trade was opened with; the trade exits at that close.`;
      }),
    ],
  };
}

