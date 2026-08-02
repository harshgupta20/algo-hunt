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
  ready(): boolean;
}

const MAX_HISTORY = 512;

export abstract class BaseIndicator implements Indicator {
  protected outputs: Array<number | undefined> = [];

  constructor(readonly ref: IndicatorRef) {}

  protected abstract compute(bar: Bar): number | undefined;

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
