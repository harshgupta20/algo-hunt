/**
 * Equity indicators (whole columns) must equal the app's streaming indicator library candle by candle — the
 * same maths the F&O section and TradingView use — plus hand-checked WMA, highest / lowest, ROC and the
 * RSI-based MA.
 */
import { describe, expect, it } from 'vitest';
import { createIndicator } from '../../src/server/services/indicator/registry';
import type { Bar } from '../../src/server/services/indicator/types';
import { dailyBars, type Bars } from '../../src/server/equity/engine/bars';
import { atr, bollinger, dmi, ema, extreme, macd, operandColumn, roc, rsi, sma, supertrend, wma } from '../../src/server/equity/engine/indicators';

/** A deterministic, realistic-looking daily series (trend + waves + noise), 400 candles. */
function series(n = 400): Bars {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  let close = 1000;
  const candles = Array.from({ length: n }, (_, i) => {
    const open = close;
    close = Math.max(50, open * (1 + 0.004 * Math.sin(i / 9) + rand() * 0.03));
    const high = Math.max(open, close) * (1 + Math.abs(rand()) * 0.015);
    const low = Math.min(open, close) * (1 - Math.abs(rand()) * 0.015);
    return { time: Date.parse('2024-01-01T00:00:00+05:30') / 1000 + i * 86_400, open, high, low, close, volume: 1e5 * (1 + Math.abs(rand())) };
  });
  return dailyBars(candles);
}

const b = series();
const bars: Bar[] = b.date.map((_, i) => ({ time: i, open: b.open[i]!, high: b.high[i]!, low: b.low[i]!, close: b.close[i]!, volume: b.volume[i]! }));

/** The library indicator's value at every candle (undefined → NaN). */
function library(kind: string, params: Record<string, number>, field?: string): number[] {
  const ind = createIndicator({ kind: kind as never, params, field });
  return bars.map((bar) => {
    ind.update(bar);
    return ind.value() ?? NaN;
  });
}

function same(actual: Float64Array, expected: number[]) {
  expect(actual.length).toBe(expected.length);
  let compared = 0;
  expected.forEach((e, i) => {
    const a = actual[i]!;
    if (Number.isNaN(e)) expect(Number.isNaN(a), `candle ${i}: expected warm-up (NaN), got ${a}`).toBe(true);
    else {
      expect(a, `candle ${i}`).toBeCloseTo(e, 8);
      compared++;
    }
  });
  expect(compared).toBeGreaterThan(100);
}

describe('equity indicators = the streaming library', () => {
  it('SMA, EMA, RSI', () => {
    same(sma(b.close, 20), library('SMA', { period: 20 }));
    same(ema(b.close, 20), library('EMA', { period: 20 }));
    same(rsi(b.close, 14), library('RSI', { period: 14 }));
  });

  it('MACD line / signal / histogram', () => {
    const m = macd(b.close, 12, 26, 9);
    same(m.line, library('MACD', { fast: 12, slow: 26, signal: 9 }, 'line'));
    same(m.signal, library('MACD', { fast: 12, slow: 26, signal: 9 }, 'signal'));
    same(m.hist, library('MACD', { fast: 12, slow: 26, signal: 9 }, 'hist'));
  });

  it('Bollinger bands, %B and bandwidth', () => {
    const bb = bollinger(b.close, 20, 2);
    for (const f of ['upper', 'mid', 'lower', 'percentB', 'bandwidth'] as const) same(bb[f], library('BBANDS', { period: 20, mult: 2 }, f));
  });

  it('Supertrend line and direction', () => {
    const s = supertrend(b, 10, 3);
    same(s.value, library('SUPERTREND', { period: 10, mult: 3 }, 'value'));
    same(s.direction, library('SUPERTREND', { period: 10, mult: 3 }, 'direction'));
  });

  it('ADX, +DI, −DI', () => {
    const d = dmi(b, 14, 14);
    same(d.adx, library('ADX', { period: 14, smoothing: 14 }));
    same(d.plus, library('DMI', { period: 14 }, 'plus'));
    same(d.minus, library('DMI', { period: 14 }, 'minus'));
  });
});

describe('TradingView edge cases', () => {
  it('a gap in a series (ROC of a zero-volume day) leaves that candle unknown — not every average after it', () => {
    const src = Float64Array.from([1, 2, NaN, 4, 5, 6]);
    expect(Array.from(sma(src, 2))).toEqual([NaN, 1.5, NaN, 3, 4.5, 5.5]);
    expect(Number.isFinite(ema(src, 2)[5]!)).toBe(true);
    expect(Number.isFinite(wma(src, 2)[5]!)).toBe(true);
  });

  it('Bollinger on a flat window: zero width, %B undefined (not a floating-point sliver)', () => {
    const flat = Float64Array.from(Array(20).fill(38.39));
    const bb = bollinger(flat, 20, 2);
    expect([bb.upper[19], bb.lower[19], bb.bandwidth[19]]).toEqual([bb.mid[19], bb.mid[19], 0]);
    expect(bb.percentB[19]).toBeNaN();
  });

  it('DMI keeps its last values over a stretch with no price range (fixnan)', () => {
    const rows = [...Array.from({ length: 20 }, (_, i) => 100 + (i % 3)), ...Array(30).fill(100)];
    const b = dailyBars(rows.map((c, i) => ({ time: 1_700_000_000 + i * 86_400, open: c, high: c, low: c, close: c, volume: 1 })));
    const d = dmi(b, 3, 3);
    expect(Number.isFinite(d.plus.at(-1)!)).toBe(true);
    expect(Number.isFinite(d.adx.at(-1)!)).toBe(true);
  });
});

describe('hand-checked indicators', () => {
  const col = Float64Array.from([10, 11, 12, 13, 14, 15, 9, 20]);

  it('WMA weights the newest value most', () => {
    const w = wma(col, 3);
    expect(Number.isNaN(w[1]!)).toBe(true);
    expect(w[2]).toBeCloseTo((10 * 1 + 11 * 2 + 12 * 3) / 6, 10);
    expect(w[7]).toBeCloseTo((15 * 1 + 9 * 2 + 20 * 3) / 6, 10);
  });

  it('highest / lowest of the PREVIOUS n candles, the current one excluded', () => {
    const hi = extreme(col, 3, 'max');
    const lo = extreme(col, 3, 'min');
    expect(Number.isNaN(hi[2]!)).toBe(true);
    expect(hi[3]).toBe(12); // 10, 11, 12 — not 13
    expect(hi[7]).toBe(15); // 14, 15, 9 — not today's 20
    expect(lo[7]).toBe(9);
  });

  it('ROC = % change over n candles', () => {
    const r = roc(col, 2);
    expect(r[2]).toBeCloseTo(20, 10); // 12 vs 10
    expect(r[7]).toBeCloseTo(((20 - 15) / 15) * 100, 10);
  });

  it('ATR is Wilder’s average of the true range (first candle: high − low)', () => {
    const a = atr(b, 14);
    const tr = b.date.map((_, i) => (i === 0 ? b.high[0]! - b.low[0]! : Math.max(b.high[i]! - b.low[i]!, Math.abs(b.high[i]! - b.close[i - 1]!), Math.abs(b.low[i]! - b.close[i - 1]!))));
    let v = tr.slice(0, 14).reduce((x, y) => x + y, 0) / 14;
    expect(a[13]).toBeCloseTo(v, 10);
    for (let i = 14; i < 40; i++) v = (v * 13 + tr[i]!) / 14;
    expect(a[39]).toBeCloseTo(v, 10);
  });

  it('RSI-based MA = SMA of the RSI values (TradingView RSI “MA” line)', () => {
    const r = rsi(b.close, 14);
    const ma = operandColumn(b, { kind: 'INDICATOR', indicator: 'RSI', params: { period: 14 }, ma: { type: 'SMA', period: 9 } });
    expect(Number.isNaN(ma[14 + 7]!)).toBe(true); // RSI starts at candle 14; 9 values → candle 22
    const at = 100;
    const expected = Array.from({ length: 9 }, (_, j) => r[at - j]!).reduce((x, y) => x + y, 0) / 9;
    expect(ma[at]).toBeCloseTo(expected, 10);
    expect(Number.isFinite(ma[22]!)).toBe(true);
  });

  it('multiplier scales the value', () => {
    const v = operandColumn(b, { kind: 'INDICATOR', indicator: 'SMA', params: { period: 5 }, source: 'volume', multiplier: 2 });
    expect(v[50]).toBeCloseTo(2 * sma(b.volume, 5)[50]!, 6);
  });
});
