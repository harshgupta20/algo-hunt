import { describe, expect, it } from 'vitest';
import type { Tick } from '@ash/shared';
import { TIMEFRAME_MS } from '@ash/shared';
import { MockProvider } from '../src/services/kite/MockProvider.js';
import { InstrumentStore } from '../src/services/kite/instrumentStore.js';
import { MemoryDataStore } from '../src/db/memory/memoryStore.js';
import { createStrategyEngine } from '../src/services/strategy/StrategyEngine.js';
import { WsHub } from '../src/services/notification/wsHub.js';
import { BrowserChannel, NotificationService } from '../src/services/notification/NotificationService.js';
import { AlertService } from '../src/services/history/alertService.js';
import { MarketWorker } from '../src/workers/marketWorker.js';
import { buildScenarioSeries } from '../src/services/strategy/syntheticSeries.js';

const TF = '15m';
const TF_MS = TIMEFRAME_MS[TF];
// Aligned base bucket in the past.
const FINAL_BUCKET = 1_704_067_200_000 + 200 * TF_MS;

async function buildWorker() {
  const provider = new MockProvider(1000);
  const instrumentStore = new InstrumentStore(provider);
  await instrumentStore.load();
  const store = new MemoryDataStore();
  const hub = new WsHub(); // not attached => broadcasts are no-ops
  const notifications = new NotificationService(store, [new BrowserChannel(hub)]);
  const alertService = new AlertService(store, notifications);
  const engine = createStrategyEngine();
  const worker = new MarketWorker({ provider, instrumentStore, engine, alertService, hub, store });
  return { worker, store, instrumentStore };
}

/** Feed a leg's close series as one-tick-per-bucket, ending at FINAL_BUCKET. */
async function feedLeg(worker: MarketWorker, token: number, closes: number[]): Promise<void> {
  const n = closes.length;
  for (let k = 0; k < n; k++) {
    const bucket = FINAL_BUCKET - (n - 1 - k) * TF_MS;
    const tick: Tick = { token, ltp: closes[k]!, timestamp: bucket };
    await worker.handleTick(tick);
  }
  // Closing tick in the next bucket finalizes the FINAL_BUCKET candle.
  await worker.handleTick({ token, ltp: closes[n - 1]!, timestamp: FINAL_BUCKET + TF_MS });
}

describe('MarketWorker end-to-end (tick -> candle -> RSI -> strategy -> alert)', () => {
  it('produces exactly ONE combined alert for Scenario 1', async () => {
    const { worker, store, instrumentStore } = await buildWorker();

    const created = await store.configs.create({
      underlying: 'NIFTY',
      expiryType: 'current-weekly',
      strikeSelection: 'ATM',
      timeframe: TF,
      strategy: 'rsi-sync',
    });
    const activated = await worker.activate(created);

    const triplet = await instrumentStore.resolveTriplet({
      underlying: 'NIFTY',
      expiry: activated.expiryDate!,
      strikeSelection: 'ATM',
    });

    const series = buildScenarioSeries(1, activated.params);
    await feedLeg(worker, triplet.future.token, series.future);
    await feedLeg(worker, triplet.call.token, series.call);
    await feedLeg(worker, triplet.put.token, series.put);

    const alerts = await store.alerts.list({});
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.scenario).toBe(1);
    expect(alerts[0]!.underlying).toBe('NIFTY');
    expect(alerts[0]!.title).toBe('NIFTY Strategy Triggered');
    // Snapshot reflects the synchronized crossing.
    expect(alerts[0]!.snapshot.futureRsi).toBeGreaterThanOrEqual(60);
    expect(alerts[0]!.snapshot.callRsi).toBeGreaterThanOrEqual(60);
    expect(alerts[0]!.snapshot.putRsi).toBeLessThanOrEqual(40);
  });

  it('does not double-fire for the same bucket if ticks repeat', async () => {
    const { worker, store, instrumentStore } = await buildWorker();
    const created = await store.configs.create({
      underlying: 'BANKNIFTY',
      expiryType: 'current-weekly',
      strikeSelection: 'ATM',
      timeframe: TF,
      strategy: 'rsi-sync',
    });
    const activated = await worker.activate(created);
    const triplet = await instrumentStore.resolveTriplet({
      underlying: 'BANKNIFTY',
      expiry: activated.expiryDate!,
      strikeSelection: 'ATM',
    });

    const series = buildScenarioSeries(2, activated.params);
    await feedLeg(worker, triplet.future.token, series.future);
    await feedLeg(worker, triplet.call.token, series.call);
    await feedLeg(worker, triplet.put.token, series.put);
    // Re-send the closing tick; must not create a second alert.
    await worker.handleTick({ token: triplet.put.token, ltp: 1, timestamp: FINAL_BUCKET + 2 * TF_MS });

    const alerts = await store.alerts.list({});
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.scenario).toBe(2);
  });

  it('replayScenario simulates a real alert through the engine', async () => {
    const { worker, store } = await buildWorker();
    const created = await store.configs.create({
      underlying: 'FINNIFTY',
      expiryType: 'current-weekly',
      strikeSelection: 'ATM',
      timeframe: TF,
      strategy: 'rsi-sync',
    });
    await worker.activate(created);

    const fired = await worker.replayScenario(created.id, 1);
    expect(fired).toBe(true);
    const alerts = await store.alerts.list({});
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.scenario).toBe(1);
  });
});
