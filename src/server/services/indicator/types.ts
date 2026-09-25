/**
 * Streaming indicator contract for the generic strategy engine. Every indicator
 * ingests closed bars and exposes its current + recent output values so the
 * condition engine can evaluate numeric, cross, trend, and percentage operators.
 */
import type { IndicatorRef } from '@ash/shared';

/** A closed OHLCV bar (time in epoch SECONDS, matching the analyzer's OHLCV). */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}

export interface Indicator {
  readonly ref: IndicatorRef;
  update(bar: Bar): void;
  /** Output `back` bars ago (0 = current); undefined during warmup / out of range. */
  value(back?: number): number | undefined;
  /**
   * The output this bar WOULD produce, without committing it — used for the
   * still-forming candle of a larger timeframe (e.g. today's Daily RSI).
   */
  peek(bar: Bar): number | undefined;
  ready(): boolean;
}

const MAX_HISTORY = 512;

/** Deep-copy indicator state; class instances (Ema, RsiCalculator…) keep their prototype. */
function cloneState<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(cloneState) as T;
  const out = Object.create(Object.getPrototypeOf(v)) as Record<string, unknown>;
  for (const k of Object.keys(v)) out[k] = cloneState((v as Record<string, unknown>)[k]);
  return out as T;
}

export abstract class BaseIndicator implements Indicator {
  protected outputs: Array<number | undefined> = [];

  constructor(readonly ref: IndicatorRef) {}

  /** Advance the indicator by one closed bar. Must not read `outputs` (peek() runs it on a copy without them). */
  protected abstract compute(bar: Bar): number | undefined;

  peek(bar: Bar): number | undefined {
    const copy = Object.create(Object.getPrototypeOf(this)) as this;
    const src = this as unknown as Record<string, unknown>;
    const dst = copy as unknown as Record<string, unknown>;
    for (const k of Object.keys(src)) dst[k] = k === 'outputs' ? [] : cloneState(src[k]);
    return copy.compute(bar);
  }

  update(bar: Bar): void {
    this.outputs.push(this.compute(bar));
    if (this.outputs.length > MAX_HISTORY) this.outputs.shift();
  }

  value(back = 0): number | undefined {
    const idx = this.outputs.length - 1 - back;
    if (idx < 0) return undefined;
    return this.outputs[idx];
  }

  ready(): boolean {
    return this.value() !== undefined;
  }
}

/** Read a numeric indicator parameter with a default. */
export function param(ref: IndicatorRef, name: string, def: number): number {
  const v = ref.params?.[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

/** Wilder's moving average (RMA), seeded with the SMA of the first `period` values — as TradingView's ta.rma. */
export class Rma {
  private value: number | undefined;
  private readonly seed: number[] = [];

  constructor(private readonly period: number) {}

  push(x: number): number | undefined {
    if (this.value === undefined) {
      this.seed.push(x);
      if (this.seed.length === this.period) this.value = this.seed.reduce((a, b) => a + b, 0) / this.period;
      return this.value;
    }
    this.value = (this.value * (this.period - 1) + x) / this.period;
    return this.value;
  }
}

/** Small reusable EMA accumulator (seeded with an SMA of the first `period`). */
export class Ema {
  private readonly k: number;
  private ema: number | undefined;
  private readonly seed: number[] = [];

  constructor(private readonly period: number) {
    this.k = 2 / (period + 1);
  }

  push(x: number): number | undefined {
    if (this.ema === undefined) {
      this.seed.push(x);
      if (this.seed.length === this.period) {
        this.ema = this.seed.reduce((a, b) => a + b, 0) / this.period;
      }
      return this.ema;
    }
    this.ema = x * this.k + this.ema * (1 - this.k);
    return this.ema;
  }
}
