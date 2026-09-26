/**
 * The V2 scanner — one cycle over every enabled connection, in stages, each
 * failure isolated:
 *
 *   1 gate         market calendars (NSE / MCX); connections whose market is closed wait
 *   2 connections  enabled connections + their strategies (current version) and products
 *   3 data         provider session + instrument freshness
 *   4 clock        trigger candle per connection (completed or forming)
 *   5 prices       one batched LTP call for every ATM reference (spot or future)
 *   6 units        legs → contracts for each strike position
 *   7 due          units that haven't evaluated this trigger candle yet
 *   8 plan         distinct (instrument, interval) fetches within the request budget
 *   9 fetch        candles, shared by every connection reading the same contract
 *  10 evaluate     expression per unit (three-valued), seeded previous result
 *  11 alert        policy → signal (deduped by identity) → alert → delivery; persist
 */
import { randomUUID } from 'node:crypto';
import type { Market, ScanError, ScanRun, StrategyDefinition, Timeframe, TriState, UnitEvaluation, UnitState, V2Connection, V2Instrument, V2Product, V2Settings, V2Strategy, V2Unit } from '@/shared/v2';
import { TIMEFRAME } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import { childLogger } from '../../utils/logger';
import { decide, initialState, signalIdentity } from '../alerts/alertPolicy';
import { deliver, formatAlert, type ChannelFactory } from '../alerts/notifications';
import { calendars, type MarketCalendar } from '../calendar/MarketCalendar';
import { BudgetExceededError, CandleService } from '../data/CandleService';
import type { V2DataProvider } from '../data/DataProvider';
import type { ProductService } from '../data/ProductService';
import { evaluateUnit, pendingReason, type UnitEvalInput } from '../engine/evaluator';
import { leafCount, legInstrument, seriesOf } from '../engine/series';
import type { V2Store } from '../persistence/V2Store';
import { atmReference, resolveUnits } from '../universe/resolve';

const log = childLogger('v2-scan');

export const SCAN_LOCK = 'v2-scan';
const LEASE_SECONDS = 240;
const MIN_INTERVAL_SECONDS = 45;
const CLOSE_GRACE_MIN = 5;
const RUN_RETENTION_MS = 3 * 86_400_000;

export interface ScannerDeps {
  store: V2Store;
  provider: V2DataProvider;
  products: ProductService;
  channels: ChannelFactory;
  clock?: () => number;
}

export interface ScanOptions {
  force?: boolean;
  connectionIds?: string[];
}

export interface ScanResult {
  run: ScanRun;
  skipped?: string;
}

interface Clock {
  triggerOpenMs: number;
  at: number;
  prevOpenMs: number | null;
  prevAt: number | null;
}

interface Plan {
  connection: V2Connection;
  strategy: V2Strategy;
  product: V2Product;
  clock: Clock;
  units: V2Unit[];
  due: V2Unit[];
  states: Map<string, UnitState>;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function clockFor(cal: MarketCalendar, d: StrategyDefinition, now: number): Clock | null {
  const tf = d.evaluation.triggerTimeframe;
  if (d.evaluation.mode === 'LIVE_CANDLE') {
    const open = cal.periodOpen(now, tf);
    return { triggerOpenMs: open, at: now, prevOpenMs: cal.lastCompletedOpen(open, tf), prevAt: open };
  }
  const open = cal.lastCompletedOpen(now, tf);
  if (open === null) return null;
  const prev = cal.lastCompletedOpen(open, tf);
  return { triggerOpenMs: open, at: cal.candleClose(open, tf), prevOpenMs: prev, prevAt: prev === null ? null : cal.candleClose(prev, tf) };
}

function emptyRun(now: number, budget: number): ScanRun {
  const at = new Date(now).toISOString();
  return { id: randomUUID(), startedAt: at, finishedAt: at, status: 'OK', connections: 0, units: 0, unitsEvaluated: 0, instruments: 0, requests: 0, budget, conditions: 0, signals: 0, alerts: 0, errors: [], notes: [] };
}

export class V2Scanner {
  constructor(private readonly deps: ScannerDeps) {}

  private now(): number {
    return this.deps.clock ? this.deps.clock() : Date.now();
  }

  async runLocked(opts: ScanOptions = {}): Promise<ScanResult> {
    const got = await this.deps.store.locks.acquire(SCAN_LOCK, LEASE_SECONDS, opts.force ? 0 : MIN_INTERVAL_SECONDS);
    if (!got) {
      const run = emptyRun(this.now(), 0);
      run.status = 'SKIPPED';
      run.notes.push('Another scan ran within the last 45 s or is still running');
      return { run, skipped: 'busy' };
    }
    try {
      return await this.run(opts);
    } finally {
      await this.deps.store.locks.release(SCAN_LOCK).catch(() => undefined);
    }
  }

  async run(opts: ScanOptions = {}): Promise<ScanResult> {
    const { store } = this.deps;
    const now = this.now();
    const settings = await store.settings.get();
    const run = emptyRun(now, settings.requestBudget);
    const error = (e: ScanError) => {
      run.errors.push(e);
      log.warn(e, 'v2 scan error');
    };
    const finish = async (status?: ScanRun['status'], skipped?: string): Promise<ScanResult> => {
      run.finishedAt = new Date(this.now()).toISOString();
      run.status = status ?? (run.errors.length ? (run.unitsEvaluated ? 'PARTIAL' : 'FAILED') : 'OK');
      if (!skipped) {
        await store.scanRuns.insert(run).catch((err) => log.error({ err }, 'failed to record scan run'));
        if (new Date(now).getUTCMinutes() === 0) await store.scanRuns.prune(new Date(now - RUN_RETENTION_MS).toISOString()).catch(() => undefined);
      }
      return { run, skipped };
    };

    // 1–2 · gate + connections
    const cals = calendars(await store.calendar.list());
    let connections = (await store.connections.list()).filter((c) => c.enabled);
    if (opts.connectionIds) connections = connections.filter((c) => opts.connectionIds!.includes(c.id));
    if (!connections.length) {
      run.notes.push('No enabled connections');
      return finish('SKIPPED', 'no-connections');
    }
    const products = new Map((await store.products.list({ ids: [...new Set(connections.map((c) => c.productId))] })).map((p) => [p.id, p]));
    const open = (m: Market) => opts.force || cals[m].isMarketOpen(now, CLOSE_GRACE_MIN);
    const live = connections.filter((c) => {
      const p = products.get(c.productId);
      return p ? open(p.market) : true; // unknown product → reported below
    });
    if (!live.length) {
      run.notes.push('Markets for the enabled connections are closed');
      return finish('SKIPPED', 'market-closed');
    }
    run.connections = live.length;

    // 3 · data
    if (!(await this.deps.provider.isConnected())) {
      error({ source: 'provider', message: 'Kite is not connected — log in from Settings → Broker Connection' });
      return finish('FAILED');
    }
    try {
      const note = await this.deps.products.ensureFresh(now);
      if (note) run.notes.push(note);
    } catch (err) {
      error({ source: 'instruments', message: `Instrument sync failed: ${msg(err)}` });
    }
    const today = istDate(now);

    // 4 · clock + strategies
    const strategies = new Map<string, V2Strategy | null>();
    const staged: Array<{ connection: V2Connection; strategy: V2Strategy; product: V2Product; clock: Clock; all: V2Instrument[]; states: Map<string, UnitState> }> = [];
    for (const c of live) {
      try {
        const product = products.get(c.productId);
        if (!product) {
          error({ source: 'connection', connectionId: c.id, productId: c.productId, message: `Product ${c.productId} is not in the catalogue — sync products` });
          continue;
        }
        if (!strategies.has(c.strategyId)) strategies.set(c.strategyId, await store.strategies.get(c.strategyId));
        const strategy = strategies.get(c.strategyId);
        if (!strategy) continue;
        const clock = clockFor(cals[product.market], strategy.definition, now);
        if (!clock) continue;
        const all = await this.deps.products.instruments(product.id, now);
        const states = new Map((await store.units.list(c.id)).map((s) => [s.unitKey, s]));
        staged.push({ connection: c, strategy, product, clock, all, states });
      } catch (err) {
        error({ source: 'clock', connectionId: c.id, message: msg(err) });
      }
    }

    // 5 · prices (ATM references)
    const refs = new Map<number, V2Instrument>();
    for (const s of staged) {
      const r = atmReference(s.strategy.definition, s.all, s.connection.config, today);
      if (r) refs.set(r.token, r);
    }
    let ltp = new Map<number, number>();
    if (refs.size) {
      try {
        ltp = await this.deps.provider.getLtp([...refs.values()]);
        run.requests++;
      } catch (err) {
        error({ source: 'ltp', message: `Live prices for ATM failed: ${msg(err)}` });
      }
    }

    // 6 · units + 7 · due
    const plans: Plan[] = [];
    for (const s of staged) {
      try {
        const ref = atmReference(s.strategy.definition, s.all, s.connection.config, today);
        const res = resolveUnits(s.strategy.definition, s.product.id, s.all, s.connection.config, ref ? ltp.get(ref.token) : undefined, today);
        for (const e of res.errors) error({ source: 'units', connectionId: s.connection.id, productId: s.product.id, message: e });
        const candle = Math.floor(s.clock.triggerOpenMs / 1000);
        const due = s.strategy.definition.evaluation.mode === 'LIVE_CANDLE' ? res.units : res.units.filter((u) => s.states.get(u.key)?.lastEvaluatedCandle !== candle);
        run.units += res.units.length;
        plans.push({ connection: s.connection, strategy: s.strategy, product: s.product, clock: s.clock, units: res.units, due, states: s.states });
      } catch (err) {
        error({ source: 'units', connectionId: s.connection.id, message: msg(err) });
      }
    }
    if (!plans.some((p) => p.due.length)) {
      run.notes.push('Every connection already evaluated its latest trigger candle');
      return finish();
    }

    // 8 · plan fetches within the budget
    const candles = new CandleService(this.deps.provider, cals, now, settings.requestBudget);
    const planned = new Set<string>();
    const fetches: Array<{ instrument: V2Instrument; tf: Timeframe }> = [];
    let deferred = 0;
    for (const p of plans) {
      const specs = seriesOf(p.strategy.definition);
      const kept: V2Unit[] = [];
      for (const unit of p.due) {
        const need = new Map<string, { instrument: V2Instrument; tf: Timeframe }>();
        for (const s of specs) {
          const inst = legInstrument(s.leg, unit);
          if (!inst) continue;
          const key = CandleService.nativeKey(inst, TIMEFRAME[s.timeframe].native);
          if (!planned.has(key)) need.set(key, { instrument: inst, tf: s.timeframe });
        }
        if (planned.size + need.size > settings.requestBudget) {
          deferred++;
          continue;
        }
        for (const [k, v] of need) {
          planned.add(k);
          fetches.push(v);
        }
        kept.push(unit);
      }
      p.due = kept;
    }
    if (deferred) error({ source: 'budget', message: `${deferred} unit(s) deferred: the ${settings.requestBudget}-request budget is used up — they run next cycle` });
    run.notes.push(`${plans.reduce((n, p) => n + p.due.length, 0)} unit(s) due · ${fetches.length} candle request(s) planned`);

    // 9 · fetch
    const failed = new Set<string>();
    await Promise.all(
      fetches.map(async (f) => {
        try {
          await candles.fetchSeries(f.instrument, f.tf);
        } catch (err) {
          const k = `${f.instrument.symbol} ${TIMEFRAME[f.tf].native}`;
          if (failed.has(k)) return;
          failed.add(k);
          error({
            source: err instanceof BudgetExceededError ? 'budget' : 'candles',
            productId: f.instrument.productId,
            timeframe: TIMEFRAME[f.tf].native,
            message: `${f.instrument.symbol}: ${msg(err)}`,
          });
        }
      }),
    );
    run.requests += candles.requests;
    run.instruments = new Set(fetches.map((f) => f.instrument.token)).size;

    // 10 · evaluate + 11 · alert
    const memo = new Map<string, unknown>();
    for (const p of plans) {
      for (const unit of p.due) {
        try {
          await this.processUnit(p, unit, candles, memo, settings, now, run);
        } catch (err) {
          error({ source: 'evaluate', connectionId: p.connection.id, unitKey: unit.key, message: msg(err) });
        }
      }
    }
    return finish();
  }

  private async processUnit(p: Plan, unit: V2Unit, candles: CandleService, memo: Map<string, unknown>, settings: V2Settings, now: number, run: ScanRun): Promise<void> {
    const { store } = this.deps;
    const { connection: c, strategy: s, product } = p;
    const d = s.definition;
    const input: UnitEvalInput = { strategyId: s.id, version: s.version, productId: product.id, definition: d, unit, lookup: candles.lookup, triggerOpenMs: p.clock.triggerOpenMs, at: p.clock.at, memo };
    const pending = pendingReason(input, now);
    if (pending) {
      run.notes.push(`Waiting for data: ${pending}`);
      return;
    }
    const evaluation = evaluateUnit(input);
    run.unitsEvaluated++;
    run.conditions += leafCount(d);

    const state = p.states.get(unit.key) ?? initialState(c.id, unit.key);
    const prevResult = this.previousResult(p, state, input, evaluation);
    const policy = c.config.alert;
    const decision = decide({ policy, state, result: evaluation.result, prevResult, triggerCandle: evaluation.triggerCandle, at: p.clock.at, now, enabledAt: c.enabledAt, mode: d.evaluation.mode });

    if (decision.outcome) {
      const identity = signalIdentity({
        connectionId: c.id,
        version: s.version,
        unitKey: unit.key,
        triggerTimeframe: d.evaluation.triggerTimeframe,
        triggerCandle: evaluation.triggerCandle,
        mode: d.evaluation.mode,
        oncePerCandle: policy.oncePerCandle,
        now,
      });
      const signal = await store.signals.insert({
        identity,
        connectionId: c.id,
        strategyId: s.id,
        version: s.version,
        unitKey: unit.key,
        triggerTimeframe: d.evaluation.triggerTimeframe,
        candleTime: evaluation.triggerCandle,
        outcome: decision.outcome,
        evaluation,
      });
      if (signal) {
        run.signals++;
        if (decision.outcome === 'ALERTED' || decision.outcome === 'NO_CHANNEL') {
          const draft = {
            signalId: signal.id,
            connectionId: c.id,
            strategyId: s.id,
            strategyName: s.name,
            version: s.version,
            productId: product.id,
            status: 'SENT' as const,
            unit,
            triggerTimeframe: d.evaluation.triggerTimeframe,
            candleTime: evaluation.triggerCandle,
            evaluation,
          };
          const alert = await store.alerts.insert(draft);
          run.alerts++;
          if (decision.outcome === 'ALERTED') {
            const message = formatAlert(draft, { productSymbol: product.symbol, productName: product.name, legs: d.legs });
            const { deliveries, status } = await deliver(this.deps.channels, settings, policy.channels, message, () => this.now());
            for (const del of deliveries) await store.alerts.addDelivery(alert.id, del);
            if (status !== 'SENT') await store.alerts.setStatus(alert.id, status);
            for (const del of deliveries) {
              if (del.status === 'failed') run.errors.push({ source: `delivery:${del.channel}`, connectionId: c.id, unitKey: unit.key, message: del.error ?? 'failed' });
            }
          }
        }
      }
    }
    const next: UnitState = { ...decision.next, lastEvaluatedCandle: evaluation.triggerCandle, lastEvaluation: evaluation };
    await store.units.upsert(next);
    p.states.set(unit.key, next);
  }

  /** The unit's result on the previous trigger candle: stored when it evaluated exactly that candle, otherwise re-evaluated now. */
  private previousResult(p: Plan, state: UnitState, input: UnitEvalInput, evaluation: UnitEvaluation): TriState | null {
    const { clock } = p;
    if (input.definition.evaluation.mode === 'LIVE_CANDLE') {
      const last = state.lastEvaluation;
      if (last && state.lastResult && evaluation.evaluatedAt - last.evaluatedAt <= 3 * 60_000) return state.lastResult;
      if (clock.prevOpenMs === null || clock.prevAt === null) return null;
      return evaluateUnit({ ...input, mode: 'COMPLETED_CANDLE', triggerOpenMs: clock.prevOpenMs, at: clock.prevAt }).result;
    }
    if (clock.prevOpenMs === null || clock.prevAt === null) return null;
    if (state.lastEvaluatedCandle === Math.floor(clock.prevOpenMs / 1000)) return state.lastResult;
    return evaluateUnit({ ...input, triggerOpenMs: clock.prevOpenMs, at: clock.prevAt }).result;
  }
}
