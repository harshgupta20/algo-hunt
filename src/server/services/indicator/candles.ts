/**
 * Candle construction helpers shared by the strategy evaluator and the
 * historical provider: Heikin Ashi, weekly aggregation of daily candles, and
 * folding smaller candles into the still-forming candle of a larger timeframe.
 */
import type { OHLCV } from '@ash/shared';
import { periodOpenMs } from '../../utils/marketTime';
import type { Bar } from './types';

/**
 * Streaming Heikin Ashi transform:
 *   HA close = (O + H + L + C) / 4
 *   HA open  = (previous HA open + previous HA close) / 2   (first candle: (O + C) / 2)
 *   HA high  = max(H, HA open, HA close) · HA low = min(L, HA open, HA close)
 * Time, volume and OI are carried over unchanged.
 */
export class HeikinAshi {
  private prev: { open: number; close: number } | undefined;

  /** Transform and commit a closed candle. */
  next(bar: Bar): Bar {
    const ha = this.compute(bar);
    this.prev = { open: ha.open, close: ha.close };
    return ha;
  }

  /** Transform a still-forming candle without committing it. */
  peek(bar: Bar): Bar {
    return this.compute(bar);
  }

  private compute(bar: Bar): Bar {
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = this.prev ? (this.prev.open + this.prev.close) / 2 : (bar.open + bar.close) / 2;
    return { ...bar, open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close) };
  }
}

/** Fold `bar` into an aggregate candle (null = start a new one at `time`). */
export function mergeInto(agg: OHLCV | null, bar: OHLCV, time: number): OHLCV {
  if (!agg) return { time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, oi: bar.oi };
  return {
    time: agg.time,
    open: agg.open,
    high: Math.max(agg.high, bar.high),
    low: Math.min(agg.low, bar.low),
    close: bar.close,
    volume: agg.volume + bar.volume,
    oi: bar.oi ?? agg.oi,
  };
}

/** Weekly candles (Monday 00:00 IST start) from daily candles. Kite has no weekly interval. */
export function aggregateWeekly(daily: OHLCV[]): OHLCV[] {
  const out: OHLCV[] = [];
  let current: OHLCV | null = null;
  for (const d of [...daily].sort((a, b) => a.time - b.time)) {
    const week = periodOpenMs(d.time * 1000, '1w') / 1000;
    if (current && current.time !== week) {
      out.push(current);
      current = null;
    }
    current = mergeInto(current, d, week);
  }
  if (current) out.push(current);
  return out;
}
