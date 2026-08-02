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
import { RsiCalculator, computeRsiSeries } from '../indicator/rsi.js';
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

  /** Group mode: run the strategy across each member underlying and merge. */
  async runGroup(params: AnalyzerParams): Promise<BacktestResult> {
    const members = params.underlyings && params.underlyings.length > 0 ? params.underlyings : [params.underlying];
    if (members.length <= 1) return this.run({ ...params, underlying: members[0] ?? params.underlying });

    const results: BacktestResult[] = [];
    for (const underlying of members) {
      try {
        results.push(await this.run({ ...params, underlying, underlyings: undefined }));
      } catch {
        // Skip a member with no data / that fails to resolve; others still run.
      }
    }
    const alerts = results.flatMap((r) => r.alerts).sort((a, b) => a.bucket - b.bucket);
    const from = results[0]?.meta.from ?? '';
    const to = results[0]?.meta.to ?? '';
    const expiry = results[0]?.meta.expiry ?? '';
    const label = params.groupName ?? `${members.length} underlyings`;
    return {
      meta: {
        underlying: label,
        expiry,
        strike: 0,
        timeframe: params.timeframe,
        from,
        to,
        candlesAnalyzed: results.reduce((s, r) => s + r.meta.candlesAnalyzed, 0),
        provider: results[0]?.meta.provider ?? this.historical.name,
        tokens: results[0]?.meta.tokens ?? { future: 0, call: 0, put: 0 },
      },
      alerts,
      stats: computeStats(alerts, { from, to, underlying: label, expiry, timeframe: params.timeframe }),
    };
  }

  private rsiSeriesFromCandles(candles: OHLCV[], period: number): Map<number, number> {
    const sorted = [...candles].sort((a, b) => a.time - b.time);
    const rsi = computeRsiSeries(
      sorted.map((c) => c.close),
      period,
    );
    const map = new Map<number, number>();
    sorted.forEach((c, i) => {
      const v = rsi[i];
      if (v !== undefined) map.set(c.time, v);
    });
    return map;
  }

  private async rsiSeriesForToken(
    token: number,
    timeframe: AnalyzerParams['timeframe'],
    from: string,
    to: string,
    period: number,
  ): Promise<Map<number, number>> {
    const candles = await this.historical.getCandles({ token, timeframe, from, to });
    return this.rsiSeriesFromCandles(candles, period);
  }

  /**
   * Fetch the future + EVERY strike that is ATM over the range, and precompute
   * each contract's own RSI series (keyed by time). This is what lets the ATM
   * strike follow the future's price candle-by-candle.
   */
  private async atmData(params: AnalyzerParams, from: string, to: string) {
    const eff = { ...DEFAULT_RSI_SYNC_PARAMS, ...params.params };
    const expiry = this.instrumentStore.resolveExpiryDate(params.underlying, params.expiryType);
    if (!expiry) throw new Error(`No expiry available for ${params.underlying}`);
    const future = this.instrumentStore.resolveFuture(params.underlying, expiry);
    if (!future) throw new Error(`No future contract found for ${params.underlying}`);

    const futureCandles = (
      await this.historical.getCandles({ token: future.token, timeframe: params.timeframe, from, to })
    ).sort((a, b) => a.time - b.time);

    const strikeAt = new Map<number, number>();
    const neededStrikes = new Set<number>();
    for (const c of futureCandles) {
      const strike = this.instrumentStore.strikeFromPrice(params.underlying, c.close, params.strikeSelection, params.customStrike);
      strikeAt.set(c.time, strike);
      neededStrikes.add(strike);
    }

    const ceRsi = new Map<number, Map<number, number>>();
    const peRsi = new Map<number, Map<number, number>>();
    for (const strike of neededStrikes) {
      const ce = this.instrumentStore.option(params.underlying, expiry, strike, 'CE');
      const pe = this.instrumentStore.option(params.underlying, expiry, strike, 'PE');
      if (ce) ceRsi.set(strike, await this.rsiSeriesForToken(ce.token, params.timeframe, from, to, eff.rsiPeriod));
      if (pe) peRsi.set(strike, await this.rsiSeriesForToken(pe.token, params.timeframe, from, to, eff.rsiPeriod));
    }

    return { eff, expiry, future, futureCandles, strikeAt, ceRsi, peRsi, futRsi: this.rsiSeriesFromCandles(futureCandles, eff.rsiPeriod) };
  }

  private async runBuiltin(params: AnalyzerParams): Promise<BacktestResult> {
    const { from, to } = resolveDateRange(params.preset, params.from, params.to);
    const d = await this.atmData(params, from, to);
    const times = d.futureCandles.map((c) => c.time);
    const alerts: BacktestAlert[] = [];

    for (let i = 1; i < times.length; i++) {
      const t = times[i]!;
      const tp = times[i - 1]!;
      const strike = d.strikeAt.get(t)!; // ATM at this candle, from the future price
      const ce = d.ceRsi.get(strike);
      const pe = d.peRsi.get(strike);
      if (!ce || !pe) continue;
      const currF = d.futRsi.get(t);
      const currC = ce.get(t);
      const currP = pe.get(t);
      if (currF === undefined || currC === undefined || currP === undefined) continue;

      const readings: LegReadings = {
        future: { prev: d.futRsi.get(tp), curr: currF },
        call: { prev: ce.get(tp), curr: currC },
        put: { prev: pe.get(tp), curr: currP },
      };
      const match = this.engine.evaluate('rsi-sync', { timeframe: params.timeframe, bucket: t * 1000, readings, params: d.eff });
      if (match) {
        alerts.push({
          id: randomUUID(),
          bucket: t * 1000,
          timestamp: new Date(t * 1000).toISOString(),
          underlying: params.underlying,
          expiry: d.expiry,
          strike,
          timeframe: params.timeframe,
          strategy: 'rsi-sync',
          scenario: match.scenario,
          readings: match.readings,
          explanation: explainMatch(match.readings, d.eff),
        });
      }
    }

    const stats = computeStats(alerts, { from, to, underlying: params.underlying, expiry: d.expiry, timeframe: params.timeframe });
    const lastStrike = times.length ? d.strikeAt.get(times[times.length - 1]!) ?? 0 : 0;
    return {
      meta: {
        underlying: params.underlying,
        expiry: d.expiry,
        strike: lastStrike,
        timeframe: params.timeframe,
        from,
        to,
        candlesAnalyzed: times.length,
        provider: this.historical.name,
        tokens: { future: d.future.token, call: 0, put: 0 },
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
    const tfMs = TIMEFRAME_MS[params.timeframe];
    const { from, to } = resolveDateRange(params.preset, params.from, params.to);
    const displayStart = center - span * tfMs;
    const displayEnd = center + span * tfMs;
    return params.strategy === 'rsi-sync'
      ? this.chartWindowBuiltin(params, from, to, center, displayStart, displayEnd)
      : this.chartWindowCustom(params, from, to, displayStart, displayEnd);
  }

  /** Built-in chart: future candles + ATM-at-selection RSI + ATM-tracked markers. */
  private async chartWindowBuiltin(
    params: AnalyzerParams,
    from: string,
    to: string,
    center: number,
    displayStart: number,
    displayEnd: number,
  ): Promise<ChartWindow> {
    const d = await this.atmData(params, from, to);
    const times = d.futureCandles.map((c) => c.time);
    const centerStrike = d.strikeAt.get(Math.floor(center / 1000)) ?? d.strikeAt.get(times[times.length - 1] ?? 0) ?? 0;
    const ceCenter = d.ceRsi.get(centerStrike);
    const peCenter = d.peRsi.get(centerStrike);

    const futureRsi: RsiPoint[] = [];
    const callRsi: RsiPoint[] = [];
    const putRsi: RsiPoint[] = [];
    const markers: ChartWindow['markers'] = [];

    for (let i = 1; i < times.length; i++) {
      const t = times[i]!;
      const tp = times[i - 1]!;
      const ms = t * 1000;
      const inWin = ms >= displayStart && ms <= displayEnd;
      if (inWin) {
        const f = d.futRsi.get(t);
        if (f !== undefined) futureRsi.push({ time: t, value: round2(f) });
        const c = ceCenter?.get(t);
        if (c !== undefined) callRsi.push({ time: t, value: round2(c) });
        const p = peCenter?.get(t);
        if (p !== undefined) putRsi.push({ time: t, value: round2(p) });
      }
      const strike = d.strikeAt.get(t)!;
      const ce = d.ceRsi.get(strike);
      const pe = d.peRsi.get(strike);
      const cf = d.futRsi.get(t);
      const cc = ce?.get(t);
      const cp = pe?.get(t);
      if (inWin && ce && pe && cf !== undefined && cc !== undefined && cp !== undefined) {
        const m = this.engine.evaluate('rsi-sync', {
          timeframe: params.timeframe,
          bucket: ms,
          readings: { future: { prev: d.futRsi.get(tp), curr: cf }, call: { prev: ce.get(tp), curr: cc }, put: { prev: pe.get(tp), curr: cp } },
          params: d.eff,
        });
        if (m) markers.push({ time: t, scenario: m.scenario });
      }
    }

    const candles = d.futureCandles.filter((c) => c.time * 1000 >= displayStart && c.time * 1000 <= displayEnd);
    return { candles, futureRsi, callRsi, putRsi, markers, levels: { future: d.eff.futureLevel, call: d.eff.callLevel, put: d.eff.putLevel } };
  }

  /** Custom chart: fixed triplet RSI reference + generic-evaluator markers. */
  private async chartWindowCustom(
    params: AnalyzerParams,
    from: string,
    to: string,
    displayStart: number,
    displayEnd: number,
  ): Promise<ChartWindow> {
    const eff = { ...DEFAULT_RSI_SYNC_PARAMS, ...params.params };
    const { triplet } = await this.resolve(params);
    const legs = await this.fetchLegs(triplet, params.timeframe, from, to);
    const rsiF = new RsiCalculator(eff.rsiPeriod);
    const rsiC = new RsiCalculator(eff.rsiPeriod);
    const rsiP = new RsiCalculator(eff.rsiPeriod);
    const futureRsi: RsiPoint[] = [];
    const callRsi: RsiPoint[] = [];
    const putRsi: RsiPoint[] = [];
    const markers: ChartWindow['markers'] = [];

    for (const t of legs.times) {
      const ms = t * 1000;
      const inWin = ms >= displayStart && ms <= displayEnd;
      const f = rsiF.update(legs.futMap.get(t)!);
      const c = rsiC.update(legs.callMap.get(t)!);
      const p = rsiP.update(legs.putMap.get(t)!);
      if (inWin) {
        if (f !== undefined) futureRsi.push({ time: t, value: round2(f) });
        if (c !== undefined) callRsi.push({ time: t, value: round2(c) });
        if (p !== undefined) putRsi.push({ time: t, value: round2(p) });
      }
    }

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

    const candles = legs.future.filter((c) => c.time * 1000 >= displayStart && c.time * 1000 <= displayEnd);
    return { candles, futureRsi, callRsi, putRsi, markers, levels: { future: eff.futureLevel, call: eff.callLevel, put: eff.putLevel } };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
