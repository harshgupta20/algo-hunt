/**
 * Backtest runner. Feeds historical OHLC candles through the SAME incremental
 * RSI + strategy engine the live worker uses, so historical and live results
 * are guaranteed identical. Contains no strategy logic of its own.
 *
 * Pipeline (mirrors MarketWorker.maybeEvaluate):
 *   historical candles → per-leg RsiCalculator.update(close) → when all three
 *   legs have curr+prev RSI for a bucket → StrategyEngine.evaluate → alert.
 */
import { randomUUID } from 'node:crypto';
import type {
  AnalyzerParams,
  BacktestAlert,
  BacktestResult,
  ChartWindow,
  Leg,
  LegReadings,
  OHLCV,
  RsiPoint,
  StrategyDef,
} from '@ash/shared';
import { DEFAULT_RSI_SYNC_PARAMS, TIMEFRAME_MS } from '@ash/shared';
import { RsiCalculator } from '../indicator/rsi.js';
import type { Bar } from '../indicator/types.js';
import type { StrategyEngine } from '../strategy/StrategyEngine.js';
import { CustomStrategyEvaluator } from '../strategy/customEvaluator.js';
import type { InstrumentStore } from '../kite/instrumentStore.js';
import type { HistoricalDataProvider } from '../kite/HistoricalDataProvider.js';
import type { DataStore } from '../../db/index.js';
import { resolveDateRange } from './dateRange.js';
import { computeStats } from './stats.js';
import { explainMatch } from './explain.js';

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const LEGS: Leg[] = ['future', 'call', 'put'];

interface LegSeries {
  future: OHLCV[];
  callMap: Map<number, number>;
  putMap: Map<number, number>;
  futMap: Map<number, number>;
  /** OHLCV bar per leg keyed by candle time (for indicator-based custom strategies). */
  bars: Record<Leg, Map<number, OHLCV>>;
  /** Candle times (epoch seconds) present in all three legs, ascending. */
  times: number[];
}

export class BacktestRunner {
  constructor(
    private readonly historical: HistoricalDataProvider,
    private readonly instrumentStore: InstrumentStore,
    private readonly engine: StrategyEngine,
    private readonly store: DataStore,
  ) {}

  private async resolve(params: AnalyzerParams) {
    const expiry = this.instrumentStore.resolveExpiryDate(params.underlying, params.expiryType);
    if (!expiry) throw new Error(`No expiry available for ${params.underlying}`);
    const triplet = await this.instrumentStore.resolveTriplet({
      underlying: params.underlying,
      expiry,
      strikeSelection: params.strikeSelection,
      customStrike: params.customStrike,
    });
    return { expiry, triplet };
  }

  private async fetchLegs(
    triplet: Awaited<ReturnType<BacktestRunner['resolve']>>['triplet'],
    timeframe: AnalyzerParams['timeframe'],
    from: string,
    to: string,
  ): Promise<LegSeries> {
    const [future, call, put] = await Promise.all([
      this.historical.getCandles({ token: triplet.future.token, timeframe, from, to }),
      this.historical.getCandles({ token: triplet.call.token, timeframe, from, to }),
      this.historical.getCandles({ token: triplet.put.token, timeframe, from, to }),
    ]);
    const futMap = new Map(future.map((c) => [c.time, c.close]));
    const callMap = new Map(call.map((c) => [c.time, c.close]));
    const putMap = new Map(put.map((c) => [c.time, c.close]));
    const bars: Record<Leg, Map<number, OHLCV>> = {
      future: new Map(future.map((c) => [c.time, c])),
      call: new Map(call.map((c) => [c.time, c])),
      put: new Map(put.map((c) => [c.time, c])),
    };
    const times = future
      .map((c) => c.time)
      .filter((t) => callMap.has(t) && putMap.has(t))
      .sort((a, b) => a - b);
    return { future, futMap, callMap, putMap, bars, times };
  }

  /** Dispatch to the built-in RSI engine or the generic engine for a custom strategy. */
  async run(params: AnalyzerParams): Promise<BacktestResult> {
    if (params.strategy === 'rsi-sync') return this.runBuiltin(params);
    const def = await this.store.strategies.get(params.strategy);
    if (!def) throw new Error(`Strategy not found: ${params.strategy}`);
    return this.runCustom(params, def);
  }

  private async runBuiltin(params: AnalyzerParams): Promise<BacktestResult> {
    const effParams = { ...DEFAULT_RSI_SYNC_PARAMS, ...params.params };
    const { from, to } = resolveDateRange(params.preset, params.from, params.to);
    const { expiry, triplet } = await this.resolve(params);
    const legs = await this.fetchLegs(triplet, params.timeframe, from, to);

    const rsiF = new RsiCalculator(effParams.rsiPeriod);
    const rsiC = new RsiCalculator(effParams.rsiPeriod);
    const rsiP = new RsiCalculator(effParams.rsiPeriod);
    let prevF: number | undefined;
    let prevC: number | undefined;
    let prevP: number | undefined;
    const alerts: BacktestAlert[] = [];

    for (const t of legs.times) {
      const currF = rsiF.update(legs.futMap.get(t)!);
      const currC = rsiC.update(legs.callMap.get(t)!);
      const currP = rsiP.update(legs.putMap.get(t)!);

      if (currF !== undefined && currC !== undefined && currP !== undefined) {
        const bucket = t * 1000;
        const readings: LegReadings = {
          future: { prev: prevF, curr: currF },
          call: { prev: prevC, curr: currC },
          put: { prev: prevP, curr: currP },
        };
        const match = this.engine.evaluate(params.strategy, {
          timeframe: params.timeframe,
          bucket,
          readings,
          params: effParams,
        });
        if (match) {
          alerts.push({
            id: randomUUID(),
            bucket,
            timestamp: new Date(bucket).toISOString(),
            underlying: params.underlying,
            expiry,
            strike: triplet.strike,
            timeframe: params.timeframe,
            strategy: params.strategy,
            scenario: match.scenario,
            readings: match.readings,
            explanation: explainMatch(match.readings, effParams),
          });
        }
      }
      prevF = currF;
      prevC = currC;
      prevP = currP;
    }

    const stats = computeStats(alerts, { from, to, underlying: params.underlying, expiry, timeframe: params.timeframe });
    return {
      meta: {
        underlying: params.underlying,
        expiry,
        strike: triplet.strike,
        timeframe: params.timeframe,
        from,
        to,
        candlesAnalyzed: legs.times.length,
        provider: this.historical.name,
        tokens: { future: triplet.future.token, call: triplet.call.token, put: triplet.put.token },
      },
      alerts,
      stats,
    };
  }

  /** Run a CUSTOM (builder) strategy over historical candles via the generic engine. */
  private async runCustom(params: AnalyzerParams, def: StrategyDef): Promise<BacktestResult> {
    const { from, to } = resolveDateRange(params.preset, params.from, params.to);
    const { expiry, triplet } = await this.resolve(params);
    const legs = await this.fetchLegs(triplet, params.timeframe, from, to);

    const evaluator = new CustomStrategyEvaluator(def);
    const instruments = evaluator.instruments().filter((i): i is Leg => (LEGS as string[]).includes(i));
    const alerts: BacktestAlert[] = [];

    for (const t of legs.times) {
      for (const inst of instruments) {
        const bar = legs.bars[inst].get(t);
        if (bar) evaluator.update(inst, bar as Bar);
      }
      const match = evaluator.evaluate();
      if (match) {
        const bucket = t * 1000;
        alerts.push({
          id: randomUUID(),
          bucket,
          timestamp: new Date(bucket).toISOString(),
          underlying: params.underlying,
          expiry,
          strike: triplet.strike,
          timeframe: params.timeframe,
          strategy: def.id,
          variant: match.variant,
          conditions: match.traces,
        });
      }
    }

    const stats = computeStats(alerts, { from, to, underlying: params.underlying, expiry, timeframe: params.timeframe });
    return {
      meta: {
        underlying: params.underlying,
        expiry,
        strike: triplet.strike,
        timeframe: params.timeframe,
        from,
        to,
        candlesAnalyzed: legs.times.length,
        provider: this.historical.name,
        tokens: { future: triplet.future.token, call: triplet.call.token, put: triplet.put.token },
      },
      alerts,
      stats,
    };
  }

  /** Windowed chart data around a candle bucket — lazy-loaded per selection. */
  async chartWindow(params: AnalyzerParams, center: number, span = 120): Promise<ChartWindow> {
    const effParams = { ...DEFAULT_RSI_SYNC_PARAMS, ...params.params };
    const tfMs = TIMEFRAME_MS[params.timeframe];
    // Warm indicators over the SAME analysis range as run(), so RSI (which is
    // warmup-path-dependent) matches exactly and markers align with the alert
    // table. Only the display-window slice is returned.
    const { from, to } = resolveDateRange(params.preset, params.from, params.to);
    const { triplet } = await this.resolve(params);
    const legs = await this.fetchLegs(triplet, params.timeframe, from, to);

    const displayStart = center - span * tfMs;
    const displayEnd = center + span * tfMs;

    const rsiF = new RsiCalculator(effParams.rsiPeriod);
    const rsiC = new RsiCalculator(effParams.rsiPeriod);
    const rsiP = new RsiCalculator(effParams.rsiPeriod);
    let prevF: number | undefined;
    let prevC: number | undefined;
    let prevP: number | undefined;

    const futureRsi: RsiPoint[] = [];
    const callRsi: RsiPoint[] = [];
    const putRsi: RsiPoint[] = [];
    const markers: ChartWindow['markers'] = [];

    for (const t of legs.times) {
      const bucket = t * 1000;
      const currF = rsiF.update(legs.futMap.get(t)!);
      const currC = rsiC.update(legs.callMap.get(t)!);
      const currP = rsiP.update(legs.putMap.get(t)!);
      const inWindow = bucket >= displayStart && bucket <= displayEnd;

      if (inWindow) {
        if (currF !== undefined) futureRsi.push({ time: t, value: round2(currF) });
        if (currC !== undefined) callRsi.push({ time: t, value: round2(currC) });
        if (currP !== undefined) putRsi.push({ time: t, value: round2(currP) });
      }

      if (params.strategy === 'rsi-sync' && currF !== undefined && currC !== undefined && currP !== undefined) {
        const match = this.engine.evaluate('rsi-sync', {
          timeframe: params.timeframe,
          bucket,
          readings: {
            future: { prev: prevF, curr: currF },
            call: { prev: prevC, curr: currC },
            put: { prev: prevP, curr: currP },
          },
          params: effParams,
        });
        if (match && inWindow) markers.push({ time: t, scenario: match.scenario });
      }
      prevF = currF;
      prevC = currC;
      prevP = currP;
    }

    // Custom strategies: derive markers from the generic evaluator over the window.
    if (params.strategy !== 'rsi-sync') {
      const def = await this.store.strategies.get(params.strategy);
      if (def) {
        const ev = new CustomStrategyEvaluator(def);
        const insts = ev.instruments().filter((i): i is Leg => (LEGS as string[]).includes(i));
        for (const t of legs.times) {
          for (const inst of insts) {
            const bar = legs.bars[inst].get(t);
            if (bar) ev.update(inst, bar as Bar);
          }
          const m = ev.evaluate();
          if (m && t * 1000 >= displayStart && t * 1000 <= displayEnd) markers.push({ time: t, scenario: 1 });
        }
      }
    }

    const candles = legs.future.filter((c) => c.time * 1000 >= displayStart && c.time * 1000 <= displayEnd);
    return {
      candles,
      futureRsi,
      callRsi,
      putRsi,
      markers,
      levels: { future: effParams.futureLevel, call: effParams.callLevel, put: effParams.putLevel },
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
