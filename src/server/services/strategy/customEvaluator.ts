/**
 * The generic strategy evaluator — the SINGLE source of truth for custom
 * (builder-created) strategies, used identically by the live worker and the
 * backtest runner. It owns the indicator instances a strategy needs, is fed
 * closed bars, and fires on the rising edge of the root rule tree, returning
 * the matched branch + trace.
 *
 * Multi-timeframe + candle types: every operand reads one candle SERIES —
 * instrument × timeframe × candle type (normal / Heikin Ashi).
 *  - Series on the RUN timeframe are fed the run's closed candles (update()).
 *  - Other timeframes are seeded with their own candles (seed()) and advanced
 *    as run candles arrive: a candle is committed once it has closed at or
 *    before the run candle's close. A LARGER timeframe's candle that is still
 *    forming is built from the run candles seen so far in its period and read
 *    provisionally — e.g. today's Daily RSI as of the 11:15 close. Nothing is
 *    ever read from a candle that hadn't happened yet, so backtests and live
 *    alerts agree.
 */
import type { CandleType, ConditionTrace, IndicatorRef, OHLCV, StrategyDef, StrategyNode, Timeframe } from '@ash/shared';
import { TIMEFRAME_MS } from '@ash/shared';
import { NSE_SESSION, candleCloseMs, periodOpenMs, type Session } from '../../utils/marketTime';
import { HeikinAshi, mergeInto } from '../indicator/candles';
import { createIndicator, indicatorSignature } from '../indicator/registry';
import type { Bar, Indicator } from '../indicator/types';
import { conditionSeries, evaluateCondition, evaluateGroup, type Resolve, type SeriesSel } from './conditionEngine';

export interface StrategyMatchResult {
  variant: string;
  traces: ConditionTrace[];
}

export interface EvaluatorOptions {
  /**
   * The run's candle size (monitor / backtest timeframe). Conditions on other
   * timeframes need it; omitted = every condition reads the fed candles.
   */
  baseTimeframe?: Timeframe;
  /** Session of the underlying (candle alignment and closes). Default NSE. */
  session?: Session;
}

/** A timeframe other than the run's that some condition reads, per instrument. */
export interface SeriesRequirement {
  instrument: string;
  timeframe: Timeframe;
}

type Relation = 'base' | 'higher' | 'lower';

/** One instrument × timeframe × candle-type stream and the indicators computed on it. */
class Series {
  readonly indicators = new Map<string, Indicator>();
  private readonly ha: HeikinAshi | null;
  private pending: OHLCV[] = [];
  private next = 0;
  /** Larger timeframe: the forming candle, aggregated from run candles (raw OHLC). */
  private partial: OHLCV | null = null;
  /** Larger timeframe: the forming candle as the indicators see it (after Heikin Ashi). */
  private provisional: Bar | null = null;
  private readonly peeked = new Map<string, number | undefined>();

  constructor(
    readonly timeframe: Timeframe | undefined,
    candle: CandleType,
    private readonly relation: Relation,
    private readonly session: Session,
  ) {
    this.ha = candle === 'heikinAshi' ? new HeikinAshi() : null;
  }

  ensure(ref: IndicatorRef): void {
    const sig = indicatorSignature(ref);
    if (!this.indicators.has(sig)) this.indicators.set(sig, createIndicator(ref));
  }

  /** Seed candles of this series' timeframe; times are normalized to their period open so they line up with run candles. */
  seed(candles: OHLCV[]): void {
    const tf = this.timeframe;
    const aligned = tf ? candles.map((c) => ({ ...c, time: periodOpenMs(c.time * 1000, tf, this.session) / 1000 })) : [...candles];
    aligned.sort((a, b) => a.time - b.time);
    this.pending = aligned.filter((c, i) => i === 0 || c.time !== aligned[i - 1]!.time);
    this.next = 0;
  }

  private commit(bar: Bar): void {
    const b = this.ha ? this.ha.next(bar) : bar;
    for (const ind of this.indicators.values()) ind.update(b);
  }

  /** Commit seeded candles while `keep(candle)` holds (in time order). */
  private commitPending(keep: (c: OHLCV) => boolean): void {
    while (this.next < this.pending.length && keep(this.pending[this.next]!)) this.commit(this.pending[this.next++]! as Bar);
  }

  /** The period that opened at `openSec` is over: commit Kite's candle for it, or our aggregate if Kite had none. */
  private finish(openSec: number, fallback: OHLCV): void {
    this.commitPending((c) => c.time < openSec);
    const own = this.pending[this.next];
    if (own && own.time === openSec) {
      this.commit(own as Bar);
      this.next++;
    } else {
      this.commit(fallback as Bar);
    }
  }

  /** Feed one closed candle of the RUN timeframe. */
  onRunCandle(bar: Bar, closeMs: number): void {
    this.peeked.clear();
    if (this.relation === 'base') {
      this.commit(bar);
      return;
    }
    if (this.relation === 'lower') {
      this.commitPending((c) => candleCloseMs(c.time * 1000, this.timeframe!, this.session) <= closeMs);
      return;
    }
    // Larger timeframe.
    const tf = this.timeframe!;
    const periodSec = periodOpenMs(bar.time * 1000, tf, this.session) / 1000;
    if (this.partial && this.partial.time !== periodSec) {
      this.finish(this.partial.time, this.partial);
      this.partial = null;
    }
    this.commitPending((c) => c.time < periodSec);
    this.partial = mergeInto(this.partial, bar, periodSec);
    if (candleCloseMs(periodSec * 1000, tf, this.session) <= closeMs) {
      this.finish(periodSec, this.partial);
      this.partial = null;
      this.provisional = null;
    } else {
      this.provisional = this.ha ? this.ha.peek(this.partial as Bar) : (this.partial as Bar);
    }
  }

  value(ref: IndicatorRef, back: number): number | undefined {
    const sig = indicatorSignature(ref);
    const ind = this.indicators.get(sig);
    if (!ind) return undefined;
    if (!this.provisional) return ind.value(back);
    if (back > 0) return ind.value(back - 1);
    if (!this.peeked.has(sig)) this.peeked.set(sig, ind.peek(this.provisional));
    return this.peeked.get(sig);
  }
}

export class CustomStrategyEvaluator {
  /** instrument → series key → series. */
  private readonly series = new Map<string, Map<string, Series>>();
  private readonly base: Timeframe | undefined;
  private readonly session: Session;
  private prevPassed = false;

  constructor(
    readonly def: StrategyDef,
    opts: EvaluatorOptions = {},
  ) {
    this.base = opts.baseTimeframe;
    this.session = opts.session ?? NSE_SESSION;
    this.collect(def.root);
  }

  /** Normalized series identity: conditions on the run timeframe share the base series. */
  private key(sel: SeriesSel | undefined): { key: string; timeframe?: Timeframe; candle: CandleType; relation: Relation } {
    const candle = sel?.candle ?? 'normal';
    const tf = this.base && sel?.timeframe && sel.timeframe !== this.base ? sel.timeframe : undefined;
    if (!tf) return { key: `base|${candle}`, candle, relation: 'base' };
    const relation: Relation = TIMEFRAME_MS[tf] > TIMEFRAME_MS[this.base!] ? 'higher' : 'lower';
    return { key: `${tf}|${candle}`, timeframe: tf, candle, relation };
  }

  private ensure(instrument: string, ref: IndicatorRef, sel: SeriesSel): void {
    let m = this.series.get(instrument);
    if (!m) {
      m = new Map();
      this.series.set(instrument, m);
    }
    const k = this.key(sel);
    let s = m.get(k.key);
    if (!s) {
      s = new Series(k.timeframe, k.candle, k.relation, this.session);
      m.set(k.key, s);
    }
    s.ensure(ref);
  }

  private collect(node: StrategyNode): void {
    if (node.type === 'condition') {
      const { lhs, rhs } = conditionSeries(node);
      this.ensure(node.instrument, node.indicator, lhs);
      if (node.compareTo) this.ensure(node.compareInstrument ?? node.instrument, node.compareTo, rhs);
    } else {
      node.children.forEach((c) => this.collect(c));
    }
  }

  /** Instruments this strategy references (so the runtime knows what to feed). */
  instruments(): string[] {
    return [...this.series.keys()];
  }

  /** Extra timeframes the runtime must fetch candles for and pass to seed(). */
  requirements(): SeriesRequirement[] {
    const out: SeriesRequirement[] = [];
    for (const [instrument, m] of this.series) {
      const tfs = new Set([...m.values()].map((s) => s.timeframe).filter((t): t is Timeframe => t !== undefined));
      for (const timeframe of tfs) out.push({ instrument, timeframe });
    }
    return out;
  }

  /** Candles of a non-run timeframe for one instrument (warm-up history included). */
  seed(instrument: string, timeframe: Timeframe, candles: OHLCV[]): void {
    for (const s of this.series.get(instrument)?.values() ?? []) if (s.timeframe === timeframe) s.seed(candles);
  }

  /** Feed one closed run-timeframe bar for the given instrument. */
  update(instrument: string, bar: Bar): void {
    const m = this.series.get(instrument);
    if (!m) return;
    const closeMs = this.base ? candleCloseMs(bar.time * 1000, this.base, this.session) : bar.time * 1000;
    for (const s of m.values()) s.onRunCandle(bar, closeMs);
  }

  private makeResolve(): Resolve {
    return (instrument, ref, back, sel) => this.series.get(instrument)?.get(this.key(sel).key)?.value(ref, back);
  }

  /**
   * Evaluate the current bar state. Returns a match ONLY on the rising edge
   * (root transitions false → true), so a strategy fires once per trigger, not
   * every bar its conditions remain satisfied.
   */
  evaluate(): StrategyMatchResult | null {
    const resolve = this.makeResolve();
    const root = this.def.root;
    const res = evaluateGroup(root, resolve);
    const rising = res.passed && !this.prevPassed;
    this.prevPassed = res.passed;
    if (!rising) return null;

    // For an OR root, report the first matching branch as the variant.
    if (root.logic === 'OR') {
      for (const child of root.children) {
        if (child.type === 'group') {
          const r = evaluateGroup(child, resolve);
          if (r.passed) return { variant: child.label ?? 'Triggered', traces: r.traces };
        } else {
          const t = evaluateCondition(child, resolve);
          if (t.passed) return { variant: 'Triggered', traces: [t] };
        }
      }
    }
    return { variant: root.label ?? 'Triggered', traces: res.traces };
  }
}
