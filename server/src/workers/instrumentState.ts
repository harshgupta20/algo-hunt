/**
 * Live per-configuration runtime state: one candle builder + RSI calculator per
 * leg, and a bucket-keyed record of closed-candle RSI so the strategy can be
 * evaluated once per candle when all three legs have confirmed values.
 */
import type { AlertConfiguration, InstrumentTriplet, Leg, StrategyDef } from '@ash/shared';
import { TIMEFRAME_MS } from '@ash/shared';
import { CandleBuilder } from '../services/indicator/candleBuilder.js';
import { RsiCalculator } from '../services/indicator/rsi.js';
import type { Bar } from '../services/indicator/types.js';
import { CustomStrategyEvaluator } from '../services/strategy/customEvaluator.js';

export interface LegRuntime {
  leg: Leg;
  token: number;
  builder: CandleBuilder;
  rsi: RsiCalculator;
}

export class ConfigRuntime {
  readonly legs: Record<Leg, LegRuntime>;
  readonly rsiByBucket = new Map<number, Partial<Record<Leg, number>>>();
  readonly evaluatedBuckets = new Set<number>();
  readonly lastClosedRsi: Record<Leg, number | null> = { future: null, call: null, put: null };
  lastBroadcast = 0;

  constructor(
    readonly config: AlertConfiguration,
    readonly triplet: InstrumentTriplet,
  ) {
    const period = config.params.rsiPeriod;
    const mk = (leg: Leg, token: number): LegRuntime => ({
      leg,
      token,
      builder: new CandleBuilder(token, config.timeframe),
      rsi: new RsiCalculator(period),
    });
    this.legs = {
      future: mk('future', triplet.future.token),
      call: mk('call', triplet.call.token),
      put: mk('put', triplet.put.token),
    };
  }

  get tokens(): number[] {
    return [this.legs.future.token, this.legs.call.token, this.legs.put.token];
  }

  legByToken(token: number): LegRuntime | undefined {
    for (const leg of ['future', 'call', 'put'] as Leg[]) {
      if (this.legs[leg].token === token) return this.legs[leg];
    }
    return undefined;
  }

  recordClosedRsi(leg: Leg, bucket: number, rsi: number | undefined): void {
    let m = this.rsiByBucket.get(bucket);
    if (!m) {
      m = {};
      this.rsiByBucket.set(bucket, m);
    }
    if (rsi !== undefined) {
      m[leg] = rsi;
      this.lastClosedRsi[leg] = rsi;
    }
  }

  /** Drop bucket state older than `keep` timeframes to bound memory. */
  prune(currentBucket: number, keep = 5): void {
    const cutoff = currentBucket - keep * TIMEFRAME_MS[this.config.timeframe];
    for (const b of this.rsiByBucket.keys()) if (b < cutoff) this.rsiByBucket.delete(b);
    for (const b of this.evaluatedBuckets) if (b < cutoff) this.evaluatedBuckets.delete(b);
  }
}

const LEG_KEYS: Leg[] = ['future', 'call', 'put'];

/**
 * Runtime state for a CUSTOM (builder-defined) strategy: per-instrument candle
 * builders feeding one generic evaluator, with bucket alignment so the strategy
 * is evaluated once all referenced instruments have a confirmed closed bar.
 */
export class CustomConfigRuntime {
  readonly evaluator: CustomStrategyEvaluator;
  readonly instruments: Leg[];
  private readonly builders = new Map<string, CandleBuilder>();
  private readonly tokenToInstrument = new Map<number, string>();
  private readonly barsByBucket = new Map<number, Map<string, Bar>>();
  readonly evaluatedBuckets = new Set<number>();

  constructor(
    readonly config: AlertConfiguration,
    readonly def: StrategyDef,
    readonly triplet: InstrumentTriplet,
  ) {
    this.evaluator = new CustomStrategyEvaluator(def);
    const referenced = new Set(this.evaluator.instruments());
    this.instruments = LEG_KEYS.filter((l) => referenced.has(l));
    if (this.instruments.length === 0) this.instruments = ['future'];

    const legInstrument: Record<Leg, { token: number }> = {
      future: triplet.future,
      call: triplet.call,
      put: triplet.put,
    };
    for (const inst of this.instruments) {
      const token = legInstrument[inst].token;
      this.builders.set(inst, new CandleBuilder(token, config.timeframe));
      this.tokenToInstrument.set(token, inst);
    }
  }

  get tokens(): number[] {
    return [...this.tokenToInstrument.keys()];
  }

  builderFor(token: number): { instrument: string; builder: CandleBuilder } | undefined {
    const instrument = this.tokenToInstrument.get(token);
    if (!instrument) return undefined;
    return { instrument, builder: this.builders.get(instrument)! };
  }

  recordBar(instrument: string, bucket: number, bar: Bar): void {
    let m = this.barsByBucket.get(bucket);
    if (!m) {
      m = new Map();
      this.barsByBucket.set(bucket, m);
    }
    m.set(instrument, bar);
  }

  barsIfComplete(bucket: number): Map<string, Bar> | undefined {
    const m = this.barsByBucket.get(bucket);
    if (!m || !this.instruments.every((i) => m.has(i))) return undefined;
    return m;
  }

  prune(currentBucket: number, keep = 5): void {
    const cutoff = currentBucket - keep * TIMEFRAME_MS[this.config.timeframe];
    for (const b of this.barsByBucket.keys()) if (b < cutoff) this.barsByBucket.delete(b);
    for (const b of this.evaluatedBuckets) if (b < cutoff) this.evaluatedBuckets.delete(b);
  }
}
