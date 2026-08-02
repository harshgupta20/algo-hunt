import { describe, expect, it } from 'vitest';
import type { BacktestAlert } from '@ash/shared';
import { resolveDateRange, tradingDaysInRange } from '../src/services/analyzer/dateRange.js';
import { computeStats } from '../src/services/analyzer/stats.js';
import { BacktestRunner } from '../src/services/analyzer/backtestRunner.js';
import { MockProvider } from '../src/services/kite/MockProvider.js';
import { MockHistoricalProvider } from '../src/services/kite/MockHistoricalProvider.js';
import { InstrumentStore } from '../src/services/kite/instrumentStore.js';
import { MemoryDataStore } from '../src/db/memory/memoryStore.js';
import { createStrategyEngine } from '../src/services/strategy/StrategyEngine.js';

describe('dateRange', () => {
  it('resolves custom ranges verbatim', () => {
    expect(resolveDateRange('custom', '2024-01-01', '2024-01-31')).toEqual({
      from: '2024-01-01',
      to: '2024-01-31',
    });
  });

  it('throws when a custom range is missing bounds', () => {
    expect(() => resolveDateRange('custom')).toThrow();
  });

  it('resolves presets to a range ending today', () => {
    const now = Date.parse('2024-06-15T00:00:00Z');
    const r = resolveDateRange('last-week', undefined, undefined, now);
    expect(r.to).toBe('2024-06-15');
    expect(r.from).toBe('2024-06-08');
  });

  it('counts only weekdays', () => {
    // 2024-01-01 (Mon) .. 2024-01-07 (Sun) => 5 weekdays
    expect(tradingDaysInRange('2024-01-01', '2024-01-07')).toBe(5);
  });
});

describe('computeStats', () => {
  const mk = (iso: string, scenario: 1 | 2): BacktestAlert => ({
    id: iso,
    bucket: Date.parse(iso),
    timestamp: iso,
    underlying: 'NIFTY',
    expiry: '2024-01-04',
    strike: 24000,
    timeframe: '15m',
    strategy: 'rsi-sync',
    scenario,
    readings: { future: { curr: 61 }, call: { curr: 61 }, put: { curr: 39 } },
    explanation: [],
  });

  it('summarizes totals, per-day extremes, and heatmaps', () => {
    const alerts = [
      mk('2024-01-02T04:00:00Z', 1), // Tue, 09:30 IST
      mk('2024-01-02T05:00:00Z', 1), // Tue, 10:30 IST
      mk('2024-01-03T04:00:00Z', 2), // Wed, 09:30 IST
    ];
    const stats = computeStats(alerts, {
      from: '2024-01-02',
      to: '2024-01-03',
      underlying: 'NIFTY',
      expiry: '2024-01-04',
      timeframe: '15m',
    });

    expect(stats.totalAlerts).toBe(3);
    expect(stats.scenario1).toBe(2);
    expect(stats.scenario2).toBe(1);
    expect(stats.maxPerDay).toBe(2);
    expect(stats.minPerDay).toBe(1);
    expect(stats.tradingDays).toBe(2);
    expect(stats.avgPerDay).toBe(1.5);
    expect(stats.byWeekday.find((b) => b.key === 'Tue')?.count).toBe(2);
    expect(stats.byWeekday.find((b) => b.key === 'Wed')?.count).toBe(1);
    expect(stats.byHour.find((b) => b.key === '09:00')?.count).toBe(2);
    expect(stats.byHour.find((b) => b.key === '10:00')?.count).toBe(1);
  });
});

describe('BacktestRunner (reuses live RSI + strategy engine)', () => {
  async function buildRunner() {
    const provider = new MockProvider(1000);
    const instrumentStore = new InstrumentStore(provider);
    await instrumentStore.load();
    const historical = new MockHistoricalProvider(instrumentStore);
    const engine = createStrategyEngine();
    return new BacktestRunner(historical, instrumentStore, engine, new MemoryDataStore());
  }

  const params = {
    underlying: 'NIFTY',
    expiryType: 'current-weekly' as const,
    strikeSelection: 'ATM' as const,
    timeframe: '15m' as const,
    strategy: 'rsi-sync' as const,
    preset: 'custom' as const,
    from: '2024-01-01',
    to: '2024-01-31',
  };

  it('produces alerts with valid scenarios and explanations', async () => {
    const runner = await buildRunner();
    const result = await runner.run(params);

    expect(result.meta.candlesAnalyzed).toBeGreaterThan(0);
    expect(result.alerts.length).toBeGreaterThan(0);

    for (const a of result.alerts) {
      expect([1, 2]).toContain(a.scenario);
      expect(a.explanation!).toHaveLength(3);
      // The future explanation must match the scenario definition.
      const future = a.explanation!.find((e) => e.leg === 'future')!;
      expect(future.condition).toBe(a.scenario === 1 ? 'crossed-above' : 'already-above');
      expect(a.explanation!.find((e) => e.leg === 'call')!.condition).toBe('crossed-above');
      expect(a.explanation!.find((e) => e.leg === 'put')!.condition).toBe('crossed-below');
    }
    expect(result.stats.totalAlerts).toBe(result.alerts.length);
  });

  it('is deterministic — identical filters reproduce identical results', async () => {
    const runner = await buildRunner();
    const a = await runner.run(params);
    const b = await runner.run(params);
    expect(b.alerts.length).toBe(a.alerts.length);
    expect(b.alerts.map((x) => x.bucket)).toEqual(a.alerts.map((x) => x.bucket));
    expect(b.alerts.map((x) => x.scenario)).toEqual(a.alerts.map((x) => x.scenario));
  });

  it('returns a windowed chart around an alert', async () => {
    const runner = await buildRunner();
    const result = await runner.run(params);
    const center = result.alerts[0]!.bucket;
    const win = await runner.chartWindow(params, center, 60);
    expect(win.candles.length).toBeGreaterThan(0);
    expect(win.futureRsi.length).toBeGreaterThan(0);
    expect(win.markers.some((m) => m.time === Math.floor(center / 1000))).toBe(true);
    expect(win.levels).toEqual({ future: 60, call: 60, put: 40 });
  });
});
