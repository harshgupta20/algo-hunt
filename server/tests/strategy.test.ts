import { describe, expect, it } from 'vitest';
import { createStrategyEngine } from '../src/services/strategy/StrategyEngine.js';
import { DEFAULT_RSI_SYNC_PARAMS, type LegReadings, type StrategyContext } from '@ash/shared';

const engine = createStrategyEngine();

function ctx(readings: LegReadings): StrategyContext {
  return { timeframe: '15m', bucket: 1_700_000_000_000, readings, params: DEFAULT_RSI_SYNC_PARAMS };
}

describe('RSI-sync strategy', () => {
  it('fires Scenario 1 when all three cross', () => {
    const match = engine.evaluate(
      'rsi-sync',
      ctx({
        future: { prev: 59.99, curr: 60.01 }, // crossing above 60
        call: { prev: 58, curr: 62 }, // crossing above 60
        put: { prev: 40.01, curr: 39.99 }, // crossing below 40
      }),
    );
    expect(match).not.toBeNull();
    expect(match!.scenario).toBe(1);
    expect(match!.strategy).toBe('rsi-sync');
  });

  it('fires Scenario 2 when future is already above and call/put cross', () => {
    const match = engine.evaluate(
      'rsi-sync',
      ctx({
        future: { prev: 65, curr: 67 }, // already above 60
        call: { prev: 58, curr: 62 },
        put: { prev: 41, curr: 39 },
      }),
    );
    expect(match).not.toBeNull();
    expect(match!.scenario).toBe(2);
  });

  it('does not fire when only two of three conditions hold (put stays above 40)', () => {
    const match = engine.evaluate(
      'rsi-sync',
      ctx({
        future: { prev: 59, curr: 61 },
        call: { prev: 58, curr: 62 },
        put: { prev: 45, curr: 43 }, // no cross below 40
      }),
    );
    expect(match).toBeNull();
  });

  it('does not fire when future neither crosses nor is already above', () => {
    const match = engine.evaluate(
      'rsi-sync',
      ctx({
        future: { prev: 50, curr: 55 }, // below 60, no cross
        call: { prev: 58, curr: 62 },
        put: { prev: 41, curr: 39 },
      }),
    );
    expect(match).toBeNull();
  });

  it('returns exactly one match (never separate per-leg alerts)', () => {
    const match = engine.evaluate(
      'rsi-sync',
      ctx({
        future: { prev: 59, curr: 61 },
        call: { prev: 58, curr: 62 },
        put: { prev: 41, curr: 39 },
      }),
    );
    // A single StrategyMatch object, not an array of three.
    expect(Array.isArray(match)).toBe(false);
    expect(match!.readings.future.curr).toBe(61);
    expect(match!.readings.call.curr).toBe(62);
    expect(match!.readings.put.curr).toBe(39);
  });

  it('exposes the strategy definition with both scenarios', () => {
    const strat = engine.get('rsi-sync');
    expect(strat).toBeDefined();
    expect(strat!.definition.scenarios.map((s) => s.id)).toEqual([1, 2]);
  });
});
