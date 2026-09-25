import { describe, expect, it } from 'vitest';
import type { OHLCV } from '@ash/shared';
import { HeikinAshi, aggregateWeekly } from '../src/server/services/indicator/candles';
import { PATTERN_BY_ID } from '../src/server/services/indicator/patterns';
import { createIndicator } from '../src/server/services/indicator/registry';
import type { Bar } from '../src/server/services/indicator/types';

const ist = (s: string) => Date.parse(`${s}+05:30`) / 1000;

function ohlc(o: number, h: number, l: number, c: number, i = 0): Bar {
  return { time: 1_704_067_200 + i * 900, open: o, high: h, low: l, close: c, volume: 100 };
}

/** Wavy OHLC series with real ranges (for ADX/DMI). */
function wave(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const mid = 100 + i * 0.3 + Math.sin(i / 3) * 4;
    return ohlc(mid - 0.5, mid + 1.5 + (i % 4) * 0.2, mid - 1.5 - (i % 3) * 0.3, mid + 0.4, i);
  });
}

/** Independent TradingView-style reference: ta.rma seeded by SMA; DMI + ADX. */
function referenceDmi(bars: Bar[], len: number, lensig: number) {
  const rma = (xs: number[], n: number) => {
    let v: number | undefined;
    return xs.map((x, i) => {
      if (i < n - 1) return undefined;
      v = i === n - 1 ? xs.slice(0, n).reduce((a, b) => a + b, 0) / n : (v! * (n - 1) + x) / n;
      return v;
    });
  };
  const tr: number[] = [];
  const pdm: number[] = [];
  const mdm: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    const p = bars[i - 1]!;
    const up = b.high - p.high;
    const down = p.low - b.low;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)));
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
  }
  const atr = rma(tr, len);
  const ps = rma(pdm, len);
  const ms = rma(mdm, len);
  const plus = atr.map((a, i) => (a === undefined ? undefined : (100 * ps[i]!) / a));
  const minus = atr.map((a, i) => (a === undefined ? undefined : (100 * ms[i]!) / a));
  const dx = plus.flatMap((p, i) => (p === undefined ? [] : [(100 * Math.abs(p - minus[i]!)) / (p + minus[i]! || 1)]));
  const adx = rma(dx, lensig);
  return { plus: plus.at(-1)!, minus: minus.at(-1)!, adx: adx.at(-1)! };
}

describe('ADX / DMI (Wilder, TradingView-compatible)', () => {
  const bars = wave(80);
  const ref = referenceDmi(bars, 14, 14);

  it('+DI / −DI match the reference', () => {
    const plus = createIndicator({ kind: 'DMI', params: { period: 14 }, field: 'plus' });
    const minus = createIndicator({ kind: 'DMI', params: { period: 14 }, field: 'minus' });
    bars.forEach((b) => {
      plus.update(b);
      minus.update(b);
    });
    expect(plus.value()).toBeCloseTo(ref.plus, 8);
    expect(minus.value()).toBeCloseTo(ref.minus, 8);
  });

  it('ADX matches the reference and reads a steady uptrend as trending', () => {
    const adx = createIndicator({ kind: 'ADX', params: { period: 14, smoothing: 14 } });
    bars.forEach((b) => adx.update(b));
    expect(adx.value()).toBeCloseTo(ref.adx, 8);

    const trend = createIndicator({ kind: 'ADX', params: { period: 14, smoothing: 14 } });
    for (let i = 0; i < 80; i++) trend.update(ohlc(100 + i, 101.5 + i, 99.5 + i, 101 + i, i));
    expect(trend.value()).toBeGreaterThan(50);
  });

  it('needs period + smoothing candles before ADX appears', () => {
    const adx = createIndicator({ kind: 'ADX', params: { period: 5, smoothing: 5 } });
    const series = wave(12);
    series.slice(0, 9).forEach((b) => adx.update(b));
    expect(adx.value()).toBeUndefined(); // 8 DX-able bars → DI from bar 6, ADX needs 5 DX
    series.slice(9).forEach((b) => adx.update(b));
    expect(adx.value()).toBeDefined();
  });
});

describe('peek() — the still-forming candle', () => {
  it('returns what update() would produce, without changing state', () => {
    const rsi = createIndicator({ kind: 'RSI', params: { period: 3 } });
    [10, 11, 10.5, 12, 11.5].forEach((c, i) => rsi.update(ohlc(c, c, c, c, i)));
    const before = rsi.value();
    const peeked = rsi.peek(ohlc(13, 13, 13, 13, 5));
    expect(rsi.value()).toBe(before);
    rsi.update(ohlc(13, 13, 13, 13, 5));
    expect(peeked).toBe(rsi.value());
  });

  it('works for stateful multi-part indicators (ADX)', () => {
    const adx = createIndicator({ kind: 'ADX', params: { period: 5, smoothing: 5 } });
    const series = wave(30);
    series.slice(0, 29).forEach((b) => adx.update(b));
    const before = adx.value();
    const peeked = adx.peek(series[29]!);
    expect(adx.value()).toBe(before);
    adx.update(series[29]!);
    expect(peeked).toBeCloseTo(adx.value()!, 10);
  });
});

describe('candlestick patterns', () => {
  const detect = (id: string, bars: Bar[]) => PATTERN_BY_ID[id]!.detect(bars);
  const falling = [110, 108, 106, 104, 102, 100].map((c, i) => ohlc(c + 1, c + 2, c - 1, c, i));
  const rising = [90, 92, 94, 96, 98, 100].map((c, i) => ohlc(c - 1, c + 1, c - 2, c, i));
  const hammerBar = ohlc(99, 99.6, 96, 99.5, 6);

  it('doji: open ≈ close', () => {
    expect(detect('doji', [ohlc(100, 101, 99, 100.05)])).toBe(true);
    expect(detect('doji', [ohlc(100, 101, 99, 100.8)])).toBe(false);
  });

  it('hammer after a decline, hanging man after a rise (same shape)', () => {
    expect(detect('hammer', [...falling, hammerBar])).toBe(true);
    expect(detect('hangingMan', [...falling, hammerBar])).toBe(false);
    expect(detect('hangingMan', [...rising, hammerBar])).toBe(true);
    expect(detect('hammer', [...rising, hammerBar])).toBe(false);
  });

  it('bullish / bearish engulfing', () => {
    expect(detect('bullishEngulfing', [ohlc(102, 102.5, 99.5, 100), ohlc(99.5, 103.5, 99, 103)])).toBe(true);
    expect(detect('bullishEngulfing', [ohlc(102, 102.5, 99.5, 100), ohlc(100.5, 101.5, 100, 101)])).toBe(false);
    expect(detect('bearishEngulfing', [ohlc(100, 102.5, 99.5, 102), ohlc(102.5, 103, 98, 99)])).toBe(true);
  });

  it('morning star and the “any bullish” roll-up', () => {
    const star = [ohlc(110, 111, 99, 100), ohlc(99, 100, 98.5, 99.5), ohlc(100, 107, 99.8, 106)];
    expect(detect('morningStar', star)).toBe(true);
    expect(detect('anyBullish', star)).toBe(true);
    expect(detect('anyBearish', star)).toBe(false);
  });

  it('pattern indicator outputs 1 on the completing candle, 0 otherwise', () => {
    const ind = createIndicator({ kind: 'PATTERN', field: 'bullishEngulfing' });
    ind.update(ohlc(102, 102.5, 99.5, 100, 0));
    ind.update(ohlc(99.5, 103.5, 99, 103, 1));
    expect(ind.value()).toBe(1);
    ind.update(ohlc(103, 104, 102.5, 103.5, 2));
    expect(ind.value()).toBe(0);
  });
});

describe('Heikin Ashi', () => {
  it('builds HA candles from the previous HA candle', () => {
    const ha = new HeikinAshi();
    const a = ha.next(ohlc(10, 12, 9, 11));
    expect(a).toMatchObject({ open: 10.5, close: 10.5, high: 12, low: 9 });
    const peeked = ha.peek(ohlc(11, 13, 10, 12, 1));
    const b = ha.next(ohlc(11, 13, 10, 12, 1));
    expect(b).toMatchObject({ open: 10.5, close: 11.5, high: 13, low: 10 });
    expect(peeked).toEqual(b);
  });
});

describe('weekly aggregation', () => {
  it('groups daily candles into Monday-start weeks', () => {
    const day = (d: string, o: number, h: number, l: number, c: number): OHLCV => ({ time: ist(`${d}T00:00:00`), open: o, high: h, low: l, close: c, volume: 10 });
    const weeks = aggregateWeekly([
      day('2026-09-21', 100, 105, 99, 104),
      day('2026-09-22', 104, 108, 103, 107),
      day('2026-09-25', 107, 110, 95, 96),
      day('2026-09-28', 96, 99, 94, 98),
    ]);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ time: ist('2026-09-21T00:00:00'), open: 100, high: 110, low: 95, close: 96, volume: 30 });
    expect(weeks[1]).toMatchObject({ time: ist('2026-09-28T00:00:00'), open: 96, close: 98 });
  });
});
