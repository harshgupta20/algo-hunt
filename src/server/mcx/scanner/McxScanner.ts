/**
 * The MCX V2 scanner — one cycle, in stages, each failure isolated:
 *
 *   1 gate        market calendar (skip when closed, unless forced)
 *   2 strategies  enabled strategies + settings
 *   3 data        provider session + instrument master freshness
 *   4 clock       trigger candle per strategy (completed or forming)
 *   5 prices      one batched LTP call for every future that sets ATM
 *   6 universe    resolve units — futures, or strikes with FUT / CE / PE legs (ATM re-resolved every cycle), cap
 *   7 due units   units that haven't evaluated this trigger candle yet (new ATM strikes,
 *                 budget-deferred units); nothing due → no candle requests at all
 *   8 plan        distinct (instrument, interval) fetches, within the request budget
 *   9 fetch       candles, shared by every unit/strategy reading the same instrument
 *  10 evaluate    expression per unit (three-valued), seeded previous result
 *  11 alert       policy → signal (deduped by identity) → alert → delivery; persist
 *
 * A failing strategy / unit / series / channel is recorded in the scan run and
 * never stops the others.
 */
import { randomUUID } from 'node:crypto';
import type { McxInstrument, McxScanError, McxTimeframe, McxScanRun, McxSettings, McxStrategy, McxUnit, TriState, UnitEvaluation, UnitState } from '@/shared/mcx';
import { MCX2_TIMEFRAME } from '@/shared/mcx';
import { istDate } from '../../utils/marketTime';
import { childLogger } from '../../utils/logger';
import { decide, initialState, signalIdentity } from '../alerts/alertPolicy';
import { deliver, formatAlert, type ChannelFactory } from '../alerts/notifications';
import { McxMarketCalendar } from '../calendar/McxMarketCalendar';
import { BudgetExceededError, CandleService } from '../data/CandleService';
import type { McxDataProvider } from '../data/McxDataProvider';
import type { McxInstrumentService } from '../data/McxInstrumentService';
import { evaluateUnit, pendingReason, type UnitEvalInput } from '../engine/evaluator';
import { leafCount, legInstrument, seriesOf } from '../engine/series';
import type { McxStore } from '../persistence/McxStore';
import { referenceFutures, resolveUniverse } from '../universe/UniverseResolver';

const log = childLogger('mcx-v2-scan');

export const SCAN_LOCK = 'mcx-v2-scan';
const LEASE_SECONDS = 240;
const MIN_INTERVAL_SECONDS = 45;
/** Minutes after the close during which the last candle still gets evaluated. */
const CLOSE_GRACE_MIN = 5;
const RUN_RETENTION_MS = 3 * 86_400_000;

export interface ScannerDeps {
  store: McxStore;
  provider: McxDataProvider;
  instruments: McxInstrumentService;
  channels: ChannelFactory;
  clock?: () => number;
}

export interface ScanOptions {
  /** Run outside market hours and ignore the minimum spacing (debugging). */
  force?: boolean;
  /** Restrict to these strategies. */
  strategyIds?: string[];
}

export interface ScanResult {
  run: McxScanRun;
  /** Not persisted (nothing to do: market closed, no strategies, lock busy). */
  skipped?: string;
}

interface Clock {
  triggerOpenMs: number;
  at: number;
  /** Open (ms) of the trigger candle before this one — to seed the previous result. */
  prevOpenMs: number | null;
  prevAt: number | null;
}

interface StrategyPlan {
  strategy: McxStrategy;
  clock: Clock;
  units: McxUnit[];
  due: McxUnit[];
  states: Map<string, UnitState>;
}

function emptyRun(now: number, budget: number): McxScanRun {
  const at = new Date(now).toISOString();
  return {
    id: randomUUID(),
    startedAt: at,
    finishedAt: at,
    status: 'OK',
    strategies: 0,
    units: 0,
    unitsEvaluated: 0,
    instruments: 0,
    seriesFetched: 0,
    requests: 0,
    budget,
    conditions: 0,
    signals: 0,
    alerts: 0,
    errors: [],
    notes: [],
  };
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class McxScanner {
  constructor(private readonly deps: ScannerDeps) {}

  private now(): number {
    return this.deps.clock ? this.deps.clock() : Date.now();
  }

  /** Scan under the DB lease (cron + dashboard triggers never overlap). */
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
    const error = (e: McxScanError) => {
      run.errors.push(e);
      log.warn(e, 'mcx v2 scan error');
    };
    const finish = async (status?: McxScanRun['status'], skipped?: string): Promise<ScanResult> => {
      run.finishedAt = new Date(this.now()).toISOString();
      run.status = status ?? (run.errors.length ? (run.unitsEvaluated ? 'PARTIAL' : 'FAILED') : 'OK');
      if (!skipped) {
        await store.scanRuns.insert(run).catch((err) => log.error({ err }, 'failed to record scan run'));
        if (new Date(now).getUTCMinutes() === 0) await store.scanRuns.prune(new Date(now - RUN_RETENTION_MS).toISOString()).catch(() => undefined);
      }
      return { run, skipped };
    };

    // 1 · gate
    const calendar = new McxMarketCalendar(await store.calendar.list());
    if (!opts.force && !calendar.isMarketOpen(now, CLOSE_GRACE_MIN)) {
      run.notes.push('MCX is closed (calendar)');
      return finish('SKIPPED', 'market-closed');
    }

    // 2 · strategies
    let strategies = (await store.strategies.list()).filter((s) => s.enabled);
    if (opts.strategyIds) strategies = strategies.filter((s) => opts.strategyIds!.includes(s.id));
    strategies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    run.strategies = strategies.length;
    if (!strategies.length) {
      run.notes.push('No enabled MCX V2 strategies');
      return finish('SKIPPED', 'no-strategies');
    }

    // 3 · data
    if (!(await this.deps.provider.isConnected())) {
      error({ source: 'provider', message: 'Kite is not connected — log in from Settings → Broker Connection' });
      return finish('FAILED');
    }
    try {
      const note = await this.deps.instruments.ensureFresh(now);
      if (note) run.notes.push(note);
    } catch (err) {
      error({ source: 'instruments', message: `Instrument sync failed: ${msg(err)}` });
    }
    const all = await this.deps.instruments.list();
    if (!all.length) {
      error({ source: 'instruments', message: 'MCX V2 instrument master is empty — sync it from the Instruments tab' });
      return finish('FAILED');
    }
    const today = istDate(now);

    // 4 · clock
    const clocked: Array<{ strategy: McxStrategy; clock: Clock; states: Map<string, UnitState> }> = [];
    for (const strategy of strategies) {
      try {
        const { mode, triggerTimeframe: tf } = strategy.definition.evaluation;
        let clock: Clock;
        if (mode === 'LIVE_CANDLE') {
          const open = calendar.periodOpen(now, tf);
          clock = { triggerOpenMs: open, at: now, prevOpenMs: calendar.lastCompletedOpen(open, tf), prevAt: open };
        } else {
          const open = calendar.lastCompletedOpen(now, tf);
          if (open === null) continue;
          const prev = calendar.lastCompletedOpen(open, tf);
          clock = { triggerOpenMs: open, at: calendar.candleClose(open, tf), prevOpenMs: prev, prevAt: prev === null ? null : calendar.candleClose(prev, tf) };
        }
        const states = new Map((await store.units.list(strategy.id)).map((s) => [s.unitKey, s]));
        clocked.push({ strategy, clock, states });
      } catch (err) {
        error({ source: 'clock', strategyId: strategy.id, message: msg(err) });
      }
    }
    // 5 · prices (ATM)
    const refs = new Map<number, McxInstrument>();
    for (const c of clocked) for (const r of referenceFutures(c.strategy.definition.universe, all, today)) refs.set(r.token, r);
    let ltp = new Map<number, number>();
    if (refs.size) {
      try {
        ltp = await this.deps.provider.getLtp([...refs.values()]);
        run.requests++;
      } catch (err) {
        error({ source: 'ltp', message: `LTP for ATM failed: ${msg(err)}` });
      }
    }

    // 6 · universe + 7 · due units
    const plans: StrategyPlan[] = [];
    for (const c of clocked) {
      const s = c.strategy;
      try {
        const res = resolveUniverse(s.definition.universe, all, ltp, today);
        for (const e of res.errors) error({ source: 'universe', strategyId: s.id, message: e });
        let units = res.units;
        if (units.length > settings.universeCap) {
          error({ source: 'universe', strategyId: s.id, message: `${units.length} units exceed the cap of ${settings.universeCap}; only the first ${settings.universeCap} are scanned` });
          units = units.slice(0, settings.universeCap);
        }
        const candle = Math.floor(c.clock.triggerOpenMs / 1000);
        const due = s.definition.evaluation.mode === 'LIVE_CANDLE' ? units : units.filter((u) => c.states.get(u.key)?.lastEvaluatedCandle !== candle);
        run.units += units.length;
        plans.push({ strategy: s, clock: c.clock, units, due, states: c.states });
      } catch (err) {
        error({ source: 'universe', strategyId: s.id, message: msg(err) });
      }
    }

    if (!plans.some((p) => p.due.length)) {
      run.notes.push('Every strategy already evaluated its latest trigger candle');
      return finish();
    }

    // 8 · plan fetches within the budget
    const candles = new CandleService(this.deps.provider, calendar, now, settings.requestBudget);
    const planned = new Set<string>();
    const fetches: Array<{ instrument: McxInstrument; tf: McxTimeframe }> = [];
    let deferred = 0;
    for (const p of plans) {
      const specs = seriesOf(p.strategy.definition);
      const kept: McxUnit[] = [];
      for (const unit of p.due) {
        const need = new Map<string, { instrument: McxInstrument; tf: McxTimeframe }>();
        for (const s of specs) {
          const inst = legInstrument(s.leg, unit);
          if (!inst) continue;
          const key = CandleService.nativeKey(inst, MCX2_TIMEFRAME[s.timeframe].native);
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
          const key = `${f.instrument.symbol} ${MCX2_TIMEFRAME[f.tf].native}`;
          if (failed.has(key)) return;
          failed.add(key);
          error({
            source: err instanceof BudgetExceededError ? 'budget' : 'candles',
            instrumentId: f.instrument.id,
            timeframe: MCX2_TIMEFRAME[f.tf].native,
            message: `${f.instrument.symbol}: ${msg(err)}`,
          });
        }
      }),
    );
    run.seriesFetched = candles.requests;
    run.requests += candles.requests;
    run.instruments = new Set(fetches.map((f) => f.instrument.token)).size;

    // 10 · evaluate + 11 · alert
    const memo = new Map<string, unknown>();
    for (const p of plans) {
      for (const unit of p.due) {
        try {
          await this.processUnit(p, unit, candles, memo, settings, now, run);
        } catch (err) {
          error({ source: 'evaluate', strategyId: p.strategy.id, instrumentId: unit.key, message: msg(err) });
        }
      }
    }
    return finish();
  }

  private async processUnit(
    p: StrategyPlan,
    unit: McxUnit,
    candles: CandleService,
    memo: Map<string, unknown>,
    settings: McxSettings,
    now: number,
    run: McxScanRun,
  ): Promise<void> {
    const { store } = this.deps;
    const s = p.strategy;
    const d = s.definition;
    const input: UnitEvalInput = {
      strategyId: s.id,
      version: s.version,
      definition: d,
      unit,
      lookup: candles.lookup,
      triggerOpenMs: p.clock.triggerOpenMs,
      at: p.clock.at,
      memo,
    };
    const pending = pendingReason(input, now);
    if (pending) {
      run.notes.push(`Waiting for data: ${pending}`);
      return;
    }
    const evaluation = evaluateUnit(input);
    run.unitsEvaluated++;
    run.conditions += leafCount(d);

    const state = p.states.get(unit.key) ?? initialState(s.id, unit.key);
    const prevResult = this.previousResult(p, state, input, evaluation);
    const decision = decide({
      policy: d.alert,
      state,
      result: evaluation.result,
      prevResult,
      triggerCandle: evaluation.triggerCandle,
      at: p.clock.at,
      now,
      enabledAt: s.enabledAt,
      mode: d.evaluation.mode,
    });

    if (decision.outcome) {
      const identity = signalIdentity({
        strategyId: s.id,
        version: s.version,
        unitKey: unit.key,
        triggerTimeframe: d.evaluation.triggerTimeframe,
        triggerCandle: evaluation.triggerCandle,
        mode: d.evaluation.mode,
        oncePerCandle: d.alert.oncePerCandle,
        now,
      });
      const signal = await store.signals.insert({
        identity,
        strategyId: s.id,
        version: s.version,
        unitKey: unit.key,
        triggerTimeframe: d.evaluation.triggerTimeframe,
        candleTime: evaluation.triggerCandle,
        signalType: 'ENTRY',
        outcome: decision.outcome,
        evaluation,
      });
      if (signal) {
        run.signals++;
        if (decision.outcome === 'ALERTED' || decision.outcome === 'NO_CHANNEL') {
          const draft = {
            signalId: signal.id,
            strategyId: s.id,
            strategyName: s.name,
            version: s.version,
            status: 'SENT' as const,
            unit,
            triggerTimeframe: d.evaluation.triggerTimeframe,
            candleTime: evaluation.triggerCandle,
            evaluation,
          };
          const alert = await store.alerts.insert(draft);
          run.alerts++;
          if (decision.outcome === 'ALERTED') {
            const { deliveries, status } = await deliver(this.deps.channels, settings, d.alert.channels, formatAlert(draft), () => this.now());
            for (const del of deliveries) await store.alerts.addDelivery(alert.id, del);
            if (status !== 'SENT') await store.alerts.setStatus(alert.id, status);
            for (const del of deliveries) {
              if (del.status === 'failed') run.errors.push({ source: `delivery:${del.channel}`, strategyId: s.id, instrumentId: unit.key, message: del.error ?? 'failed' });
            }
          }
        }
      }
    }
    const next: UnitState = { ...decision.next, lastEvaluatedCandle: evaluation.triggerCandle, lastEvaluation: evaluation };
    await store.units.upsert(next);
    p.states.set(unit.key, next);
  }

  /**
   * The unit's result on the previous trigger candle: the stored one when this
   * unit evaluated exactly that candle, otherwise re-evaluated now (first run,
   * a gap, a strike newly inside ATM ± N) so ON_TRANSITION never fires just
   * because there was no history.
   */
  private previousResult(p: StrategyPlan, state: UnitState, input: UnitEvalInput, evaluation: UnitEvaluation): TriState | null {
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
