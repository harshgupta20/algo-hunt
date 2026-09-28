/**
 * Database traffic (Neon bills the data it sends): contracts are read once until the next instrument
 * sync, the alarm polls only for alerts newer than the last one it saw, and closed paper trades are
 * reused until one closes.
 */
import { describe, expect, it, vi } from 'vitest';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { V2Service } from '../../src/server/v2/V2Service';
import { FixtureV2Provider, MemoryV2Store, RecordingChannels, fut, ist, spot } from '../helpers/v2Fakes';

const ALL = [spot('NSE:NIFTY', 'NIFTY 50'), fut('NSE:NIFTY', '2026-10-27')];

describe('database traffic', () => {
  it('reads a product’s contracts once, and again only after the list is synced', async () => {
    const store = new MemoryV2Store();
    const provider = new FixtureV2Provider(ALL);
    const products = new ProductService(store, provider);
    await products.sync();
    const read = vi.spyOn(store.instruments, 'forProduct');
    const t0 = ist('2026-10-07', '10:00');
    for (let m = 0; m < 30; m++) await products.instruments('NSE:NIFTY', t0 + m * 60_000);
    expect(read).toHaveBeenCalledTimes(1);
    // Another process (the live worker's morning sync) syncs; noticed at the next check (≤ 5 min).
    store.data.syncedAt = new Date(t0 + 31 * 60_000).toISOString();
    await products.instruments('NSE:NIFTY', t0 + 36 * 60_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('the alarm feed returns only alerts newer than the cursor', async () => {
    const clock = { now: ist('2026-10-07', '10:00') };
    const store = new MemoryV2Store(() => clock.now);
    const svc = new V2Service({ store, provider: new FixtureV2Provider(ALL), products: new ProductService(store, new FixtureV2Provider(ALL)), channels: new RecordingChannels(), clock: () => clock.now });
    const add = async (min: number) => {
      clock.now = ist('2026-10-07', '10:00') + min * 60_000;
      const e = { unit: { key: 'k', productId: 'NSE:NIFTY', expiry: null, baseStrike: null, shift: 0, legs: {} } } as never;
      return store.alerts.insert({ signalId: 's', connectionId: 'c', strategyId: 's1', strategyName: 'S', version: 1, productId: 'NSE:NIFTY', status: 'SENT', unit: { key: 'k', productId: 'NSE:NIFTY', expiry: null, baseStrike: null, shift: 0, legs: {} }, triggerTimeframe: '5m', candleTime: 0, evaluation: e });
    };
    const a = await add(0);
    const [first] = await svc.alertFeed(null, 1);
    expect(first).toEqual({ id: a.id, strategyName: 'S', productId: 'NSE:NIFTY', unit: expect.objectContaining({ key: 'k' }), createdAt: a.createdAt });
    expect(await svc.alertFeed(first!.createdAt)).toEqual([]); // nothing new: nothing sent
    const b = await add(5);
    expect((await svc.alertFeed(first!.createdAt)).map((x) => x.id)).toEqual([b.id]);
  });

  it('closed paper trades are read again only when one closes', async () => {
    const store = new MemoryV2Store();
    const svc = new V2Service({ store, provider: new FixtureV2Provider(ALL), products: new ProductService(store, new FixtureV2Provider(ALL)), channels: new RecordingChannels() });
    const read = vi.spyOn(store.paper, 'listTrades');
    await svc.paperSummary();
    await svc.paperSummary();
    await svc.paperTrades({ status: 'CLOSED' });
    expect(read.mock.calls.filter(([f]) => f.status === 'CLOSED')).toHaveLength(1);
    const t = await store.paper.insertTrade({ status: 'OPEN', connectionId: 'c', slot: 's', strategyId: 'x', productId: 'NSE:NIFTY', entryAt: new Date().toISOString(), capitalUsed: 1, terms: {} } as never);
    await store.paper.closeTrade(t!.id, { exitAt: new Date().toISOString(), exitPrice: 1, exitReason: 'MANUAL', grossPnl: 0, charges: 0, netPnl: 0, lastPrice: 1, lastPriceAt: null });
    await svc.paperSummary();
    expect(read.mock.calls.filter(([f]) => f.status === 'CLOSED')).toHaveLength(2);
  });
});
