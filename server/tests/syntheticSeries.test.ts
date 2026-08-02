import { describe, expect, it } from 'vitest';
import {
  alreadyAboveSeries,
  crossAboveSeries,
  crossBelowSeries,
} from '../src/services/strategy/syntheticSeries.js';
import { computeRsiSeries } from '../src/services/indicator/rsi.js';

function lastTwoDefined(closes: number[], period: number): [number, number] {
  const defined = computeRsiSeries(closes, period).filter((v): v is number => v !== undefined);
  return [defined[defined.length - 2]!, defined[defined.length - 1]!];
}

describe('syntheticSeries', () => {
  it('crossAboveSeries ends exactly on a cross above the level', () => {
    const [prev, curr] = lastTwoDefined(crossAboveSeries(60, 14), 14);
    expect(prev).toBeLessThan(60);
    expect(curr).toBeGreaterThanOrEqual(60);
  });

  it('crossBelowSeries ends exactly on a cross below the level', () => {
    const [prev, curr] = lastTwoDefined(crossBelowSeries(40, 14), 14);
    expect(prev).toBeGreaterThan(40);
    expect(curr).toBeLessThanOrEqual(40);
  });

  it('alreadyAboveSeries keeps RSI above the level on the last two candles', () => {
    const [prev, curr] = lastTwoDefined(alreadyAboveSeries(60, 14), 14);
    expect(prev).toBeGreaterThanOrEqual(60);
    expect(curr).toBeGreaterThanOrEqual(60);
  });
});
