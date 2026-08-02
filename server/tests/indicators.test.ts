import { describe, expect, it } from 'vitest';
import { createIndicator, indicatorSignature } from '../src/services/indicator/registry.js';
import type { Bar, Indicator } from '../src/services/indicator/types.js';

function bar(close: number, i: number, extra: Partial<Bar> = {}): Bar {
  return { time: 1_704_067_200 + i * 900, open: close, high: close, low: close, close, volume: 100, ...extra };
}

function feed(ind: Indicator, closes: number[]): void {
  closes.forEach((c, i) => ind.update(bar(c, i)));
}

describe('EMA indicator', () => {
  it('seeds with SMA then applies the smoothing factor', () => {
    const ema = createIndicator({ kind: 'EMA', params: { period: 3 } });
    feed(ema, [1, 2, 3, 4, 5]); // seed=2 (SMA of 1,2,3); then 3; then 4
    expect(ema.value()).toBe(4);
    expect(ema.value(1)).toBe(3);
  });
});

describe('SMA indicator', () => {
  it('is the rolling mean over the period', () => {
    const sma = createIndicator({ kind: 'SMA', params: { period: 3 } });
    feed(sma, [2, 4, 6, 8]);
    expect(sma.value()).toBe(6); // (4+6+8)/3
    expect(sma.value(1)).toBe(4); // (2+4+6)/3
  });
});

describe('RSI indicator', () => {
  it('matches the RSI calculator (period 2, closes 10,11,10,11)', () => {
    const rsi = createIndicator({ kind: 'RSI', params: { period: 2 } });
    feed(rsi, [10, 11, 10, 11]);
    expect(rsi.value()).toBe(75);
    expect(rsi.value(1)).toBe(50);
  });
});

describe('Bollinger Bands', () => {
  it('collapses to the mean on a flat series', () => {
    const upper = createIndicator({ kind: 'BBANDS', params: { period: 20, mult: 2 }, field: 'upper' });
    const lower = createIndicator({ kind: 'BBANDS', params: { period: 20, mult: 2 }, field: 'lower' });
    const flat = Array.from({ length: 25 }, () => 10);
    feed(upper, flat);
    feed(lower, flat);
    expect(upper.value()).toBe(10);
    expect(lower.value()).toBe(10);
  });
});

describe('MACD', () => {
  it('line is positive on a sustained uptrend', () => {
    const macd = createIndicator({ kind: 'MACD', field: 'line' });
    feed(macd, Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(macd.value()).toBeGreaterThan(0);
  });
});

describe('Price / Volume / Supertrend / VWAP', () => {
  it('Price high returns the bar high', () => {
    const price = createIndicator({ kind: 'PRICE', field: 'high' });
    price.update(bar(100, 0, { high: 123 }));
    expect(price.value()).toBe(123);
  });

  it('Volume returns the bar volume', () => {
    const vol = createIndicator({ kind: 'VOLUME' });
    vol.update(bar(100, 0, { volume: 4200 }));
    expect(vol.value()).toBe(4200);
  });

  it('Supertrend produces a value and a +1/-1 direction', () => {
    const dir = createIndicator({ kind: 'SUPERTREND', field: 'direction' });
    for (let i = 0; i < 40; i++) dir.update(bar(100 + Math.sin(i) * 5, i, { high: 106, low: 94 }));
    expect([1, -1]).toContain(dir.value());
  });

  it('VWAP sits within the price range', () => {
    const vwap = createIndicator({ kind: 'VWAP' });
    for (let i = 0; i < 10; i++) vwap.update(bar(100 + i, i, { high: 100 + i + 2, low: 100 + i - 2, volume: 1000 }));
    const v = vwap.value()!;
    expect(v).toBeGreaterThan(98);
    expect(v).toBeLessThan(112);
  });
});

describe('indicatorSignature', () => {
  it('is stable regardless of param key order and distinguishes fields', () => {
    expect(indicatorSignature({ kind: 'MACD', params: { slow: 26, fast: 12 }, field: 'line' })).toBe(
      indicatorSignature({ kind: 'MACD', params: { fast: 12, slow: 26 }, field: 'line' }),
    );
    expect(indicatorSignature({ kind: 'MACD', field: 'line' })).not.toBe(
      indicatorSignature({ kind: 'MACD', field: 'signal' }),
    );
  });
});
