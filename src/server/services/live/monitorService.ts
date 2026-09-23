/**
 * Live monitoring for a serverless deployment. Replaces the old long-running
 * tick worker: on every scheduler run (cron, or an open dashboard) it pulls
 * each active monitor's candles from Kite, evaluates every newly CLOSED candle
 * through the same RSI + strategy engines the analyzer uses, persists alerts,
 * and stores an RSI snapshot for the dashboard gauges.
 *
 * Correctness properties:
 *  - Decisions use closed candles only (the forming candle only feeds gauges).
 *  - `monitor_state.last_bucket` + the alerts unique index make every candle
 *    fire at most once, across overlapping or retried runs.
 *  - Candles come straight from Kite, so RSI matches the Kite chart exactly
 *    (09:15-aligned buckets, truncated final candle of the session).
 */
import type {
  AlertConfiguration,
  ConfigRuntimeSnapshot,
  InstrumentTriplet,
  Leg,
  LegReadings,
  OHLCV,
  Timeframe,
} from '@ash/shared';
import { TIMEFRAME_MS } from '@ash/shared';
import type { DataStore } from '../../db/store';
import type { MonitorSnapshot, MonitorState } from '../../db/types';
import { childLogger } from '../../utils/logger';
import { candleCloseMs, istDate } from '../../utils/marketTime';
import type { AlertService } from '../history/alertService';
import { computeRsiSeries } from '../indicator/rsi';
import type { Bar } from '../indicator/types';
import type { HistoricalDataProvider } from '../kite/HistoricalDataProvider';
import type { InstrumentStore } from '../kite/instrumentStore';
import { CustomStrategyEvaluator } from '../strategy/customEvaluator';
import type { StrategyEngine } from '../strategy/StrategyEngine';

const log = childLogger('monitor-service');

const LEGS: Leg[] = ['future', 'call', 'put'];
const DAY_MS = 86_400_000;
/** Bars of history fetched per run so RSI/EMA warm-up matches the broker chart. */
const WARMUP_BARS = 300;
/** Trading minutes per session (09:15–15:30). */
const SESSION_MINUTES = 375;
/**
 * Candles that closed longer ago than this are not alerted on (e.g. after the
 * scheduler was down) — a stale alert is worse than none. They still advance
 * the dedupe cursor.
 */
export const MAX_ALERT_LAG_MS = 30 * 60_000;

/** Calendar days of history needed for WARMUP_BARS on a timeframe (weekends included). */
export function lookbackDays(tf: Timeframe): number {
  const barsPerDay = Math.max(1, Math.floor(SESSION_MINUTES / (TIMEFRAME_MS[tf] / 60_000)));
  const tradingDays = Math.ceil(WARMUP_BARS / barsPerDay);
  return Math.ceil((tradingDays * 7) / 5) + 3;
}

export interface MonitorDeps {
  store: DataStore;
  instrumentStore: InstrumentStore;
  engine: StrategyEngine;
  alertService: AlertService;
  historical: HistoricalDataProvider;
}

export interface MonitorRunResult {
  configId: string;
  underlying: string;
  evaluatedCandles: number;
  alerts: number;
  skippedStale: number;
  error?: string;
}

function levelFor(leg: Leg, config: AlertConfiguration): number {
  if (leg === 'future') return config.params.futureLevel;
  if (leg === 'call') return config.params.callLevel;
  return config.params.putLevel;
}

function lastDefined(values: Array<number | undefined>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== undefined) return v;
  }
  return null;
}

function round2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

export class MonitorService {
  constructor(private readonly deps: MonitorDeps) {}

  // ---- Activation -------------------------------------------------------------

  /** Resolve the expiry + triplet (ATM from the live future price) for a config. */
  private async resolve(config: AlertConfiguration): Promise<{ expiryDate: string; triplet: InstrumentTriplet }> {
    await this.deps.instrumentStore.load();
    const expiryDate = this.deps.instrumentStore.resolveExpiryDate(config.underlying, config.expiryType);
    if (!expiryDate) {
      throw new Error(
        `No upcoming ${config.expiryType} expiry for ${config.underlying}. ` +
          'Is Kite connected and the instrument master synced?',
      );
    }
    const triplet = await this.deps.instrumentStore.resolveTriplet({
      underlying: config.underlying,
      expiry: expiryDate,
      strikeSelection: config.strikeSelection,
      customStrike: config.customStrike,
    });
    return { expiryDate, triplet };
  }

  /** Start monitoring a config: lock its strike/contracts and mark it active. */
  async activate(config: AlertConfiguration, now = Date.now()): Promise<AlertConfiguration> {
    if (config.strategy !== 'rsi-sync') {
      const def = await this.deps.store.strategies.get(config.strategy);
      if (!def) throw new Error(`Custom strategy not found: ${config.strategy}`);
      if (def.status === 'disabled') throw new Error(`Strategy "${def.name}" is disabled — publish it first.`);
    }
    const { expiryDate, triplet } = await this.resolve(config);
    await this.deps.store.monitors.upsert({
      configId: config.id,
      strike: triplet.strike,
      expiry: expiryDate,
      triplet,
      activatedAt: new Date(now).toISOString(),
      lastBucket: null,
      snapshot: null,
      lastError: null,
    });
    const saved = await this.deps.store.configs.setActive(config.id, true, expiryDate);
    log.info(
      { configId: config.id, underlying: config.underlying, strike: triplet.strike, expiry: expiryDate, strategy: config.strategy },
      'monitor activated',
    );
    return saved ?? { ...config, expiryDate, active: true };
  }

  async deactivate(configId: string): Promise<void> {
    await this.deps.store.monitors.delete(configId);
    await this.deps.store.configs.setActive(configId, false);
    log.info({ configId }, 'monitor deactivated');
  }

  // ---- Snapshots ---------------------------------------------------------------

  async snapshots(): Promise<ConfigRuntimeSnapshot[]> {
    const [configs, states] = await Promise.all([this.deps.store.configs.listActive(), this.deps.store.monitors.list()]);
    const byId = new Map(states.map((s) => [s.configId, s]));
    return configs.map((c) => {
      const s = byId.get(c.id);
      const leg = (l: Leg) => {
        const snap = s?.snapshot?.legs[l];
        return {
          rsi: snap?.rsi ?? null,
          closedRsi: snap?.closedRsi ?? null,
          ltp: snap?.ltp ?? null,
          level: levelFor(l, c),
        };
      };
      return {
        configId: c.id,
        underlying: c.underlying,
        timeframe: c.timeframe,
        strategy: c.strategy,
        strike: s?.strike ?? 0,
        expiry: s?.expiry ?? c.expiryDate ?? '',
        legs: { future: leg('future'), call: leg('call'), put: leg('put') },
        lastClosedBucket: s?.snapshot?.lastClosedBucket ?? null,
        evaluatedAt: s?.snapshot?.evaluatedAt ?? null,
        lastError: s?.lastError ?? null,
      };
    });
  }

  // ---- Evaluation --------------------------------------------------------------

  /** Evaluate every active monitor once. Candle fetches are shared across monitors. */
  async runAll(now = Date.now()): Promise<MonitorRunResult[]> {
    const configs = await this.deps.store.configs.listActive();
    if (configs.length === 0) return [];
    const states = new Map((await this.deps.store.monitors.list()).map((s) => [s.configId, s]));
    const cache = new Map<string, Promise<OHLCV[]>>();
    const results: MonitorRunResult[] = [];

    for (const config of configs) {
      try {
        let state = states.get(config.id);
        // Missing state (pre-migration activation) or an expired contract → re-resolve.
        if (!state || state.expiry < istDate(now)) {
          await this.activate(config, now);
          state = (await this.deps.store.monitors.get(config.id)) ?? undefined;
          if (!state) throw new Error('monitor state could not be created');
        }
        results.push(await this.evaluate(config, state, now, cache));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ configId: config.id, err: message }, 'monitor evaluation failed');
        await this.deps.store.monitors.recordRun(config.id, { lastBucket: null, snapshot: null, lastError: message });
        results.push({ configId: config.id, underlying: config.underlying, evaluatedCandles: 0, alerts: 0, skippedStale: 0, error: message });
      }
    }
    return results;
  }

  private candles(token: number, tf: Timeframe, now: number, cache: Map<string, Promise<OHLCV[]>>): Promise<OHLCV[]> {
    const key = `${token}:${tf}`;
    let p = cache.get(key);
    if (!p) {
      p = this.deps.historical.getCandles({
        token,
        timeframe: tf,
        from: istDate(now - lookbackDays(tf) * DAY_MS),
        to: istDate(now),
      });
      cache.set(key, p);
    }
    return p;
  }

  /** Evaluate one monitor: all candles closed since the last run, plus a fresh snapshot. */
  async evaluate(
    config: AlertConfiguration,
    state: MonitorState,
    now: number,
    cache = new Map<string, Promise<OHLCV[]>>(),
  ): Promise<MonitorRunResult> {
    const tf = config.timeframe;
    const triplet = state.triplet;
    const [future, call, put] = await Promise.all(
      [triplet.future.token, triplet.call.token, triplet.put.token].map((t) => this.candles(t, tf, now, cache)),
    );
    const all: Record<Leg, OHLCV[]> = { future: future!, call: call!, put: put! };
    const isClosed = (c: OHLCV) => candleCloseMs(c.time * 1000, tf) <= now;
    const closed: Record<Leg, OHLCV[]> = {
      future: all.future.filter(isClosed),
      call: all.call.filter(isClosed),
      put: all.put.filter(isClosed),
    };

    // Candles are only alerted on if they closed after activation, after the
    // previous run's cursor, and recently enough to still be actionable.
    const activatedAt = Date.parse(state.activatedAt);
    const isNew = (t: number) => {
      const openMs = t * 1000;
      return (state.lastBucket === null || openMs > state.lastBucket) && candleCloseMs(openMs, tf) > activatedAt;
    };
    const isFresh = (t: number) => now - candleCloseMs(t * 1000, tf) <= MAX_ALERT_LAG_MS;

    const result: MonitorRunResult = {
      configId: config.id,
      underlying: config.underlying,
      evaluatedCandles: 0,
      alerts: 0,
      skippedStale: 0,
    };

    if (config.strategy === 'rsi-sync') {
      await this.evaluateBuiltin(config, triplet, closed, isNew, isFresh, result);
    } else {
      await this.evaluateCustom(config, triplet, closed, isNew, isFresh, result);
    }

    const lastClosed = closed.future.at(-1)?.time;
    await this.deps.store.monitors.recordRun(config.id, {
      lastBucket: lastClosed === undefined ? null : lastClosed * 1000,
      snapshot: this.snapshot(config, all, closed, now),
      lastError: null,
    });
    return result;
  }

  private async evaluateBuiltin(
    config: AlertConfiguration,
    triplet: InstrumentTriplet,
    closed: Record<Leg, OHLCV[]>,
    isNew: (t: number) => boolean,
    isFresh: (t: number) => boolean,
    result: MonitorRunResult,
  ): Promise<void> {
    const period = config.params.rsiPeriod;
    const rsi = {} as Record<Leg, Map<number, number>>;
    for (const leg of LEGS) {
      const series = computeRsiSeries(closed[leg].map((c) => c.close), period);
      rsi[leg] = new Map();
      closed[leg].forEach((c, i) => {
        const v = series[i];
        if (v !== undefined) rsi[leg].set(c.time, v);
      });
    }
    // Buckets present in all three legs, ascending — prev = the previous such bucket.
    const times = closed.future.map((c) => c.time).filter((t) => rsi.call.has(t) && rsi.put.has(t) && rsi.future.has(t));

    for (let i = 1; i < times.length; i++) {
      const t = times[i]!;
      if (!isNew(t)) continue;
      result.evaluatedCandles++;
      const tp = times[i - 1]!;
      const readings: LegReadings = {
        future: { prev: rsi.future.get(tp), curr: rsi.future.get(t)! },
        call: { prev: rsi.call.get(tp), curr: rsi.call.get(t)! },
        put: { prev: rsi.put.get(tp), curr: rsi.put.get(t)! },
      };
      const match = this.deps.engine.evaluate(config.strategy, {
        timeframe: config.timeframe,
        bucket: t * 1000,
        readings,
        params: config.params,
      });
      if (!match) continue;
      if (!isFresh(t)) {
        result.skippedStale++;
        continue;
      }
      const saved = await this.deps.alertService.record(config, triplet, match, candleCloseMs(t * 1000, config.timeframe));
      if (saved) result.alerts++;
    }
  }

  private async evaluateCustom(
    config: AlertConfiguration,
    triplet: InstrumentTriplet,
    closed: Record<Leg, OHLCV[]>,
    isNew: (t: number) => boolean,
    isFresh: (t: number) => boolean,
    result: MonitorRunResult,
  ): Promise<void> {
    const def = await this.deps.store.strategies.get(config.strategy);
    if (!def) throw new Error(`Custom strategy not found: ${config.strategy}`);
    const evaluator = new CustomStrategyEvaluator(def);
    const referenced = new Set(evaluator.instruments());
    const instruments = LEGS.filter((l) => referenced.has(l));
    if (instruments.length === 0) instruments.push('future');

    const bars = Object.fromEntries(LEGS.map((l) => [l, new Map(closed[l].map((c) => [c.time, c]))])) as Record<
      Leg,
      Map<number, OHLCV>
    >;
    const times = closed[instruments[0]!].map((c) => c.time).filter((t) => instruments.every((i) => bars[i].has(t)));

    // Replay the full window so indicators warm up and the rising-edge state is
    // exact; only candles not yet evaluated can raise alerts.
    for (const t of times) {
      for (const inst of instruments) evaluator.update(inst, bars[inst].get(t)! as Bar);
      const match = evaluator.evaluate();
      if (!isNew(t)) continue;
      result.evaluatedCandles++;
      if (!match) continue;
      if (!isFresh(t)) {
        result.skippedStale++;
        continue;
      }
      const saved = await this.deps.alertService.recordCustom(
        config,
        triplet,
        def,
        match,
        t * 1000,
        candleCloseMs(t * 1000, config.timeframe),
      );
      if (saved) result.alerts++;
    }
  }

  private snapshot(
    config: AlertConfiguration,
    all: Record<Leg, OHLCV[]>,
    closed: Record<Leg, OHLCV[]>,
    now: number,
  ): MonitorSnapshot {
    const period = config.params.rsiPeriod;
    const legs = {} as MonitorSnapshot['legs'];
    for (const leg of LEGS) {
      const closedRsi = lastDefined(computeRsiSeries(closed[leg].map((c) => c.close), period));
      const provisional = lastDefined(computeRsiSeries(all[leg].map((c) => c.close), period));
      legs[leg] = {
        rsi: round2(provisional ?? closedRsi),
        closedRsi: round2(closedRsi),
        ltp: all[leg].at(-1)?.close ?? null,
        level: levelFor(leg, config),
      };
    }
    const lastClosed = closed.future.at(-1)?.time;
    return { legs, lastClosedBucket: lastClosed === undefined ? null : lastClosed * 1000, evaluatedAt: now };
  }
}
