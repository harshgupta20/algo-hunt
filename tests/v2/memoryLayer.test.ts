/**
 * The one-process app keeps hot data in memory: a scanned trading session — the alarm feed every 5 s, the
 * status bar every 30 s, the Live card and Paper tab, the scanner every minute — reaches the database only
 * for core records (the alert, its delivery, the paper trade opening and closing, the unit's alert state).
 */
import { describe, expect, it } from 'vitest';
import type { StrategyDefinition } from '../../src/shared/v2';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { RuntimeV2Store, createRuntimeState } from '../../src/server/v2/persistence/RuntimeV2Store';
import type { V2Store } from '../../src/server/v2/persistence/V2Store';
import { V2Service } from '../../src/server/v2/V2Service';
import { FixtureV2Provider, MemoryV2Store, NSE_SESSION, RecordingChannels, and, candlesAt, cond, config, fut, ind, ist, ladder, legSeries, momentumCloses, num, spot, strategy, timesEndingAt } from '../helpers/v2Fakes';

/** Counts every call that reaches the database (by namespace.method). */
function counted(store: V2Store): { store: V2Store; calls: Map<string, number>; total: () => number; reset: () => void } {
  const calls = new Map<string, number>();
  const wrap = <T extends object>(obj: T, ns: string): T =>
    new Proxy(obj, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v === 'function') {
          return (...args: unknown[]) => {
            const k = `${ns}${String(prop)}`;
            calls.set(k, (calls.get(k) ?? 0) + 1);
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return v && typeof v === 'object' && !Array.isArray(v) && ns === '' && typeof prop === 'string' && prop !== 'data' ? wrap(v as object, `${prop}.`) : v;
      },
    });
  return { store: wrap(store, '') as V2Store, calls, total: () => [...calls.values()].reduce((a, b) => a + b, 0), reset: () => calls.clear() };
}

describe('memory layer — database traffic in a session', () => {
  it('routine refreshes and scans never reach the database; events do, once', async () => {
    const D = '2026-10-07';
    const clock = { now: ist(D, '09:30') };
    const inner = new MemoryV2Store(() => clock.now);
    const db = counted(inner);
    const store = new RuntimeV2Store(db.store, () => clock.now, createRuntimeState());
    const niftySpot = spot('NSE:NIFTY', 'NIFTY 50');
    const niftyFut = { ...fut('NSE:NIFTY', '2026-10-27'), lotSize: 75 };
    const opts = ladder('NSE:NIFTY', '2026-10-13', 24_800, 25_200, 50).map((o) => ({ ...o, lotSize: 75 }));
    const atmCe = opts.find((o) => o.kind === 'CE' && o.strike === 25_000)!;
    const provider = new FixtureV2Provider([niftySpot, niftyFut, ...opts]);
    const nse15 = timesEndingAt(ist(D, '10:45'), 15, 65, NSE_SESSION);
    provider.set(niftySpot, '15m', candlesAt(nse15, Array.from({ length: 65 }, (_, i) => 25_000 + i * 0.1)));
    provider.set(niftyFut, '15m', candlesAt(nse15, Array.from({ length: 65 }, (_, i) => 25_100 + i * 0.5)));
    provider.set(atmCe, '15m', candlesAt(nse15, momentumCloses(14), { spread: 0.5 }));
    provider.ltp.set(niftySpot.token, 25_010);
    provider.ltp.set(atmCe.token, 100);
    const svc = new V2Service({ store, provider, products: new ProductService(store, provider), channels: new RecordingChannels(), clock: () => clock.now });
    await svc.syncProducts();
    const S: StrategyDefinition = {
      ...strategy(
        [
          { id: 'A', kind: 'FUT' },
          { id: 'B', kind: 'CE', strikeOffset: 0 },
        ],
        and(cond(ind(legSeries('A'), 'RSI', { period: 14 }), 'GT', ind(legSeries('B'), 'RSI', { period: 14 })), cond(ind(legSeries('B'), 'RSI', { period: 14 }), 'CROSSED_ABOVE', num(60))),
      ),
      name: 'Future leads the call',
    };
    const s = await svc.createStrategy(S);
    const [c] = await svc.createConnections(s.id, ['NSE:NIFTY'], config());
    await svc.enableConnection(c!.id);

    // The screens a trader keeps open: what each poll costs once everything is warm.
    const screens = async () => {
      await svc.alertFeed((await svc.alertFeed(null, 1))[0]?.createdAt ?? null);
      await svc.status();
      await svc.liveStatus();
      await svc.paperSummary();
      await svc.paperTrades({ status: 'OPEN' });
      await svc.listConnections();
      await svc.paperSettings();
    };
    // Warm-up: each kind of data read once — including a product's contracts (once a day) and a new unit's first state.
    clock.now = ist(D, '09:45') + 30_000;
    await svc.scan();
    await screens();
    await store.flushWrites();
    db.reset();

    // 10:00–10:59: scanner every minute + the screens every few seconds — nothing to alert yet.
    for (let m = 0; m < 60; m++) {
      clock.now = ist(D, '10:00') + m * 60_000 + 30_000;
      await svc.scan();
      for (let k = 0; k < 4; k++) await screens();
    }
    await store.flushWrites();
    expect(Object.fromEntries(db.calls)).toEqual({});

    // 11:00 the strategy fires: the alert, its signal, the delivery, the unit's alert state and the paper trade.
    clock.now = ist(D, '11:00') + 30_000;
    const fired = await svc.scan();
    expect(fired.run.alerts).toBe(1);
    await store.flushWrites(); // the writes are saved in the background, in order
    expect(Object.fromEntries(db.calls)).toEqual({ 'signals.insert': 1, 'alerts.insert': 1, 'alerts.addDelivery': 1, 'units.upsertMany': 1, 'paper.insertTrade': 1 });

    // The new alert shows on the alarm feed straight from memory.
    db.reset();
    expect((await svc.alertFeed(null, 5)).length).toBe(1);
    expect((await svc.paperTrades({ status: 'OPEN' })).length).toBe(1);
    expect(db.total()).toBe(0);

    // 11:05 the target is hit: one write closes the trade; the Paper tab shows it from memory.
    clock.now = ist(D, '11:05');
    provider.ltp.set(atmCe.token, 121);
    await svc.scan();
    await store.flushWrites();
    expect(Object.fromEntries(db.calls)).toEqual({ 'paper.closeTrade': 1 });
    db.reset();
    await svc.paperSummary();
    await svc.paperSummary();
    expect(Object.fromEntries(db.calls)).toEqual({});
    expect((await svc.paperSummary()).overall).toMatchObject({ trades: 1, wins: 1 });
    expect(inner.data.alerts).toHaveLength(1); // the core record is in the database
    expect(inner.data.paperTrades[0]).toMatchObject({ status: 'CLOSED', exitReason: 'TARGET' });
  });
});
