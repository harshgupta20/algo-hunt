import { describe, expect, it } from 'vitest';
import { RsiCalculator, computeRsiSeries, rsiFromAverages } from '../src/services/indicator/rsi.js';

describe('rsiFromAverages', () => {
  it('returns 100 when there are no losses', () => {
    expect(rsiFromAverages(1, 0)).toBe(100);
    expect(rsiFromAverages(0, 0)).toBe(100); // flat series convention
  });

  it('returns 0 when there are no gains', () => {
    expect(rsiFromAverages(0, 1)).toBe(0);
  });

  it('returns 50 for equal average gain and loss', () => {
    expect(rsiFromAverages(0.5, 0.5)).toBe(50);
  });
});

describe('RsiCalculator (incremental, Wilder)', () => {
  it('needs period + 1 closes before producing a value', () => {
    const calc = new RsiCalculator(14);
    for (let i = 0; i < 14; i++) {
      expect(calc.update(100 + i)).toBeUndefined();
    }
    expect(calc.ready).toBe(false);
    expect(calc.update(115)).toBeDefined();
    expect(calc.ready).toBe(true);
  });

  it('computes an exact hand-verified series for period 2', () => {
    // closes 10,11,10,11 -> changes +1,-1,+1
    // after 3rd close: avgGain=avgLoss=0.5 -> RSI 50
    // after 4th close: avgGain=0.75, avgLoss=0.25 -> RS 3 -> RSI 75
    expect(computeRsiSeries([10, 11, 10, 11], 2)).toEqual([undefined, undefined, 50, 75]);
  });

  it('drives RSI to 100 on a monotonically rising series', () => {
    const series = computeRsiSeries([1, 2, 3, 4, 5, 6], 2);
    expect(series.at(-1)).toBe(100);
  });

  it('drives RSI to 0 on a monotonically falling series', () => {
    const series = computeRsiSeries([6, 5, 4, 3, 2, 1], 2);
    expect(series.at(-1)).toBe(0);
  });

  it('holds RSI at 100 on a flat series', () => {
    const series = computeRsiSeries([5, 5, 5, 5, 5], 2);
    expect(series.slice(2)).toEqual([100, 100, 100]);
  });

  it('matches the canonical StockCharts RSI(14) reference (~70.5)', () => {
    const closes = [
      44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826,
      45.8931, 46.0328, 45.614, 46.282, 46.282,
    ];
    const series = computeRsiSeries(closes, 14);
    const first = series.at(-1);
    expect(first).toBeDefined();
    expect(first as number).toBeGreaterThan(69.5);
    expect(first as number).toBeLessThan(71.5);
  });

  it('rejects invalid periods', () => {
    expect(() => new RsiCalculator(0)).toThrow();
    expect(() => new RsiCalculator(1.5)).toThrow();
  });
});
