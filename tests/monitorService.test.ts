import { describe, expect, it } from 'vitest';
import { DEFAULT_RSI_SYNC_PARAMS, TIMEFRAME_MS, type OHLCV } from '@ash/shared';
import { AlertService } from '../src/server/services/history/alertService';
import { NotificationService } from '../src/server/services/notification/NotificationService';
import { MAX_ALERT_LAG_MS, MonitorService, lookbackDays } from '../src/server/services/live/monitorService';
import { createStrategyEngine } from '../src/server/services/strategy/StrategyEngine';
import { rsiSyncStrategyDef } from '../src/server/services/strategy/builtinStrategies';
import { candleCloseMs } from '../src/server/utils/marketTime';
import { buildScenarioSeries } from './helpers/syntheticSeries';
import { FixtureHistorical, fixtureInstrumentStore, fixtureStore, niftyMaster, toCandles } from './helpers/fixtures';

const TF = '15m' as const;
// Wednesday 2026-09-23, 11:00 IST candle (closes 11:15 IST).
const LAST_OPEN = Date.parse('2026-09-23T11:00:00+05:30');
const LAST_CLOSE = LAST_OPEN + TIMEFRAME_MS[TF];

async function setup(scenario: 1 | 2, opts: { strategy?: string } = {}) {
  const master = niftyMaster();
  const instrumentStore = fixtureInstrumentStore(master); // LTP 22010 → ATM 22000
  const future = master.find((i) => i.instrumentType === 'FUT')!;
  const call = master.find((i) => i.instrumentType === 'CE' && i.strike === 22000)!;
  const put = master.find((i) => i.instrumentType === 'PE' && i.strike === 22000)!;
  const series = buildScenarioSeries(scenario, DEFAULT_RSI_SYNC_PARAMS);
  const candles = new Map<number, OHLCV[]>([
    [future.token, toCandles(series.future, LAST_OPEN, TF)],
    [call.token, toCandles(series.call, LAST_OPEN, TF)],
    [put.token, toCandles(series.put, LAST_OPEN, TF)],
  ]);
  const custom = { ...rsiSyncStrategyDef(), id: 'custom-rsi', status: 'active' as const };
  const store = fixtureStore([custom]);
  const historical = new FixtureHistorical(candles);
  const alertService = new AlertService(store, new NotificationService(store, []));
  const monitors = new MonitorService({ store, instrumentStore, engine: createStrategyEngine(), alertService, historical });
  const config = await store.configs.create({
    underlying: 'NIFTY',
    expiryType: 'current-weekly',
    strikeSelection: 'ATM',
    timeframe: TF,
    strategy: opts.strategy ?? 'rsi-sync',
  });
  return { store, monitors, config, historical, candles, future };
}

describe('MonitorService (cron evaluator: Kite candles → RSI → strategy → alert)', () => {
  it('locks the ATM triplet from the live future price at activation', async () => {
    const { store, monitors, config } = await setup(1);
    const activated = await monitors.activate(config, LAST_OPEN - 86_400_000);
    expect(activated.active).toBe(true);
    const state = await store.monitors.get(config.id);
    expect(state?.strike).toBe(22000);
    expect(state?.triplet.call.instrumentType).toBe('CE');
    expect(state?.triplet.put.strike).toBe(22000);
  });

  it('fires exactly ONE combined alert for Scenario 1 when the candle closes', async () => {
    const { store, monitors, config } = await setup(1);
    await monitors.activate(config, LAST_OPEN - 86_400_000);
    const [r] = await monitors.runAll(LAST_CLOSE + 5_000);
    expect(r?.error).toBeUndefined();
    expect(r?.alerts).toBe(1);
    expect(store.alertRows).toHaveLength(1);
    const a = store.alertRows[0]!;
    expect(a.scenario).toBe(1);
    expect(a.title).toBe('NIFTY Strategy Triggered');
    expect(a.bucket).toBe(LAST_OPEN);
    expect(a.triggeredAt).toBe(new Date(LAST_CLOSE).toISOString());
    expect(a.snapshot.futureRsi).toBeGreaterThanOrEqual(60);
    expect(a.snapshot.callRsi).toBeGreaterThanOrEqual(60);
    expect(a.snapshot.putRsi).toBeLessThanOrEqual(40);
  });

  it('fires Scenario 2 when the future is already above its level', async () => {
    const { store, monitors, config } = await setup(2);
    await monitors.activate(config, LAST_OPEN - 86_400_000);
    await monitors.runAll(LAST_CLOSE + 5_000);
    expect(store.alertRows.map((a) => a.scenario)).toEqual([2]);
  });

  it('never double-fires across repeated runs (cursor + dedupe)', async () => {
    const { store, monitors, config } = await setup(1);
    await monitors.activate(config, LAST_OPEN - 86_400_000);
    await monitors.runAll(LAST_CLOSE + 5_000);
    await monitors.runAll(LAST_CLOSE + 65_000);
    await monitors.runAll(LAST_CLOSE + 125_000);
    expect(store.alertRows).toHaveLength(1);
  });

  it('does not decide on a still-forming candle', async () => {
    const { store, monitors, config } = await setup(1);
    await monitors.activate(config, LAST_OPEN - 86_400_000);
    await monitors.runAll(LAST_OPEN + 60_000); // 1 minute into the 11:00 candle
    expect(store.alertRows).toHaveLength(0);
    // Gauges still get a provisional reading that includes the forming candle.
    const [snap] = await monitors.snapshots();
    expect(snap?.legs.future.rsi).not.toBeNull();
    expect(snap?.legs.future.closedRsi).not.toBe(snap?.legs.future.rsi);
  });

  it('ignores candles that closed before the monitor was activated', async () => {
    const { store, monitors, config } = await setup(1);
    await monitors.activate(config, LAST_CLOSE + 1_000);
    await monitors.runAll(LAST_CLOSE + 5_000);
    expect(store.alertRows).toHaveLength(0);
  });

  it('skips alerts that would be stale (scheduler was down) but advances the cursor', async () => {
    const { store, monitors, config } = await setup(1);
    await monitors.activate(config, LAST_OPEN - 86_400_000);
    const [r] = await monitors.runAll(LAST_CLOSE + MAX_ALERT_LAG_MS + 60_000);
    expect(r?.skippedStale).toBe(1);
    expect(store.alertRows).toHaveLength(0);
    expect((await store.monitors.get(config.id))?.lastBucket).toBe(LAST_OPEN);
  });

  it('runs custom (builder) strategies through the same generic engine as the analyzer', async () => {
    const { store, monitors, config } = await setup(1, { strategy: 'custom-rsi' });
    await monitors.activate(config, LAST_OPEN - 86_400_000);
    const [r] = await monitors.runAll(LAST_CLOSE + 5_000);
    expect(r?.error).toBeUndefined();
    expect(store.alertRows).toHaveLength(1);
    expect(store.alertRows[0]!.strategyId).toBe('custom-rsi');
    expect(store.alertRows[0]!.conditions?.length).toBeGreaterThan(0);
  });

  it('pauses monitors whose custom strategy was disabled after activation', async () => {
    const { store, monitors, config } = await setup(1, { strategy: 'custom-rsi' });
    await monitors.activate(config, LAST_OPEN - 86_400_000);
    const def = await store.strategies.get('custom-rsi');
    def!.status = 'disabled';
    const [r] = await monitors.runAll(LAST_CLOSE + 5_000);
    expect(r?.error).toMatch(/disabled/);
    expect(store.alertRows).toHaveLength(0);
  });

  it('shares one candle fetch per instrument across monitors in a run', async () => {
    const { store, monitors, config, historical } = await setup(1);
    const second = await store.configs.create({ ...config, params: config.params });
    await monitors.activate(config, LAST_OPEN - 86_400_000);
    await monitors.activate(second, LAST_OPEN - 86_400_000);
    historical.calls.length = 0;
    await monitors.runAll(LAST_CLOSE + 5_000);
    expect(historical.calls).toHaveLength(3);
    expect(historical.calls[0]!.from <= historical.calls[0]!.to).toBe(true);
  });
});

describe('market-time helpers', () => {
  it('truncates the last candle of the session at 15:30 IST', () => {
    const open = Date.parse('2026-09-23T15:15:00+05:30');
    expect(candleCloseMs(open, '1h')).toBe(Date.parse('2026-09-23T15:30:00+05:30'));
    expect(candleCloseMs(open, '15m')).toBe(Date.parse('2026-09-23T15:30:00+05:30'));
  });

  it('fetches enough history to warm up indicators', () => {
    expect(lookbackDays('1m')).toBeGreaterThanOrEqual(3);
    expect(lookbackDays('1h')).toBeGreaterThan(lookbackDays('15m'));
  });
});
