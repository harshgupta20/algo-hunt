import { describe, expect, it } from 'vitest';
import { DEFAULT_RSI_SYNC_PARAMS } from '@ash/shared';
import { CustomStrategyEvaluator } from '../src/services/strategy/customEvaluator.js';
import { rsiSyncStrategyDef } from '../src/services/strategy/builtinStrategies.js';
import { createStrategyEngine } from '../src/services/strategy/StrategyEngine.js';
import { buildScenarioSeries } from '../src/services/strategy/syntheticSeries.js';
import { computeRsiSeries } from '../src/services/indicator/rsi.js';
import type { Bar } from '../src/services/indicator/types.js';

function feedBars(ev: CustomStrategyEvaluator, instrument: string, closes: number[]): void {
  closes.forEach((c, i) => {
    const b: Bar = { time: 1_704_067_200 + i * 900, open: c, high: c, low: c, close: c, volume: 100 };
    ev.update(instrument, b);
  });
}

/** The built-in class engine's scenario for the last two RSI values of each leg. */
function builtinScenario(scenario: 1 | 2): number | null {
  const engine = createStrategyEngine();
  const series = buildScenarioSeries(scenario, DEFAULT_RSI_SYNC_PARAMS);
  const lastTwo = (arr: number[]) => {
    const d = computeRsiSeries(arr, DEFAULT_RSI_SYNC_PARAMS.rsiPeriod).filter((v): v is number => v !== undefined);
    return { prev: d[d.length - 2], curr: d[d.length - 1]! };
  };
  const match = engine.evaluate('rsi-sync', {
    timeframe: '15m',
    bucket: 0,
    readings: { future: lastTwo(series.future), call: lastTwo(series.call), put: lastTwo(series.put) },
    params: DEFAULT_RSI_SYNC_PARAMS,
  });
  return match?.scenario ?? null;
}

describe('CustomStrategyEvaluator ≡ built-in rsi-sync', () => {
  for (const scenario of [1, 2] as const) {
    it(`generic JSON engine reproduces built-in Scenario ${scenario}`, () => {
      const ev = new CustomStrategyEvaluator(rsiSyncStrategyDef());
      const series = buildScenarioSeries(scenario, DEFAULT_RSI_SYNC_PARAMS);
      feedBars(ev, 'future', series.future);
      feedBars(ev, 'call', series.call);
      feedBars(ev, 'put', series.put);

      const match = ev.evaluate();
      expect(match).not.toBeNull();
      expect(match!.variant).toBe(`Scenario ${scenario}`);
      // ...and the class-based engine agrees on the scenario number.
      expect(builtinScenario(scenario)).toBe(scenario);

      // Trace explains all three legs and every condition passed.
      expect(match!.traces).toHaveLength(3);
      expect(match!.traces.every((t) => t.passed)).toBe(true);
    });
  }

  it('fires only on the rising edge (not while conditions stay true)', () => {
    // A simple always-true-after-warmup strategy: Close price > 0.
    const ev = new CustomStrategyEvaluator({
      id: 'x',
      name: 'x',
      status: 'active',
      version: 1,
      scope: 'options',
      underlying: 'NIFTY',
      expiryType: 'current-weekly',
      strikeSelection: 'ATM',
      timeframe: '15m',
      root: {
        type: 'group',
        id: 'r',
        logic: 'AND',
        children: [{ type: 'condition', id: 'c', instrument: 'future', indicator: { kind: 'PRICE', field: 'close' }, operator: 'gt', value: 0 }],
      },
      createdAt: '',
      updatedAt: '',
    });
    feedBars(ev, 'future', [10]);
    expect(ev.evaluate()).not.toBeNull(); // rising edge (false -> true)
    feedBars(ev, 'future', [11]);
    expect(ev.evaluate()).toBeNull(); // still true -> no re-fire
  });
});
