/**
 * Candle construction for MCX V2 series. Everything starts from the native
 * candles Kite serves; derived timeframes and candle types are built here:
 *   - 2h / 4h from 1h, aligned to the session open (calendar)
 *   - weekly from daily (Monday-start weeks; closes on the week's last trading day)
 *   - Heikin Ashi from normal candles
 *   - volume candles: consecutive base candles merged until volume ≥ threshold,
 *     restarting every trading day so boundaries don't depend on the fetch window
 * Every candle carries its close time and whether it had completed at `now`.
 */
import type { CandleSpec, McxTimeframe } from '@/shared/mcx';
import { MCX2_TIMEFRAME } from '@/shared/mcx';
import { HeikinAshi } from '../../services/indicator/candles';
import { istDate } from '../../utils/marketTime';
import type { McxMarketCalendar } from '../calendar/McxMarketCalendar';

/** A candle as the provider returns it (time = open, epoch seconds). */
export interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}

export interface McxCandle extends RawCandle {
  /** Epoch ms when the candle closes (session-truncated). */
  closeMs: number;
  /** Closed at the evaluation clock's `now`. */
  complete: boolean;
}

function merge(agg: RawCandle | null, c: RawCandle, time: number): RawCandle {
  if (!agg) return { time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, oi: c.oi };
  return {
    time: agg.time,
    open: agg.open,
    high: Math.max(agg.high, c.high),
    low: Math.min(agg.low, c.low),
    close: c.close,
    volume: agg.volume + c.volume,
    oi: c.oi ?? agg.oi,
  };
}

/** Group native candles into `tf` periods (calendar-aligned). */
export function aggregate(native: RawCandle[], tf: McxTimeframe, cal: McxMarketCalendar): RawCandle[] {
  const out: RawCandle[] = [];
  let cur: RawCandle | null = null;
  for (const c of native) {
    const open = cal.periodOpen(c.time * 1000, tf) / 1000;
    if (cur && cur.time !== open) {
      out.push(cur);
      cur = null;
    }
    cur = merge(cur, c, open);
  }
  if (cur) out.push(cur);
  return out;
}

export function finalize(raw: RawCandle[], tf: McxTimeframe, cal: McxMarketCalendar, now: number): McxCandle[] {
  return raw.map((c) => {
    const closeMs = cal.candleClose(c.time * 1000, tf);
    return { ...c, closeMs, complete: closeMs <= now };
  });
}

export function heikinAshi(candles: McxCandle[]): McxCandle[] {
  const ha = new HeikinAshi();
  return candles.map((c) => ({ ...ha.next(c), closeMs: c.closeMs, complete: c.complete }));
}

/**
 * Volume candles from base candles. A candle closes on the base candle that
 * takes its volume to ≥ `threshold`; the day's remainder closes with the session.
 */
export function volumeCandles(base: McxCandle[], threshold: number, cal: McxMarketCalendar, now: number): McxCandle[] {
  const out: McxCandle[] = [];
  let cur: McxCandle | null = null;
  let day = '';
  const flush = (complete: boolean) => {
    if (cur) out.push({ ...cur, complete });
    cur = null;
  };
  for (const c of base) {
    const d = istDate(c.time * 1000);
    if (cur && d !== day) flush(cal.sessionEnd(day) <= now && cur.complete);
    day = d;
    const m = merge(cur, c, cur?.time ?? c.time);
    cur = { ...m, closeMs: c.closeMs, complete: c.complete };
    if (cur.volume >= threshold) flush(c.complete);
  }
  if (cur) flush(cal.sessionEnd(day) <= now && (cur as McxCandle).complete);
  return out;
}

/** Build a series of `tf` + candle type from the native candles of that timeframe. */
export function buildSeries(native: RawCandle[], tf: McxTimeframe, candle: CandleSpec, cal: McxMarketCalendar, now: number): McxCandle[] {
  const raw = MCX2_TIMEFRAME[tf].derived ? aggregate(native, tf, cal) : native;
  const normal = finalize(raw, tf, cal, now);
  switch (candle.type) {
    case 'NORMAL':
      return normal;
    case 'HEIKIN_ASHI':
      return heikinAshi(normal);
    case 'VOLUME':
      return volumeCandles(normal, candle.volumePerCandle, cal, now);
  }
}
