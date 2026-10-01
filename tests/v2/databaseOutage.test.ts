/**
 * Alerts never wait for the database. While it can't be reached (Neon asleep, offline, over its allowance)
 * the app keeps alerting and paper trading from memory and saves the records, in order, once it's back —
 * also after a restart. Lists are reused until something changes, and history is kept until the trader
 * chooses a period (then older records are deleted daily).
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StrategyDefinition, UnitState } from '../../src/shared/v2';
import { DEFAULT_V2_SETTINGS } from '../../src/shared/v2';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { RuntimeV2Store, createRuntimeState } from '../../src/server/v2/persistence/RuntimeV2Store';
import type { V2Store } from '../../src/server/v2/persistence/V2Store';
import { WriteQueue, isPermanentWriteError } from '../../src/server/v2/persistence/writeQueue';
import { V2Service } from '../../src/server/v2/V2Service';
import { FixtureV2Provider, MemoryV2Store, NSE_SESSION, RecordingChannels, and, candlesAt, cond, config, field, fut, ind, ist, ladder, legSeries, momentumCloses, num, spot, strategy, timesEndingAt } from '../helpers/v2Fakes';

const DAY = 86_400_000;

/** A database that can be switched off; counts the calls that reach it. */
function switchable(store: V2Store) {
  const state = { down: false, calls: new Map<string, number>() };
  const refuse = () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
  const wrap = <T extends object>(obj: T, ns: string): T =>
    new Proxy(obj, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v === 'function') {
          return (...args: unknown[]) => {
            const k = `${ns}${String(prop)}`;
            state.calls.set(k, (state.calls.get(k) ?? 0) + 1);
            return state.down ? refuse() : (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return v && typeof v === 'object' && !Array.isArray(v) && ns === '' && typeof prop === 'string' && prop !== 'data' ? wrap(v as object, `${prop}.`) : v;
      },
    });
  return { store: wrap(store, '') as V2Store, state };
}

async function until(done: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

const unitState = (connectionId: string): UnitState => ({ connectionId, unitKey: 'k', state: 'TRIGGERED', lastEvaluatedCandle: 1, lastResult: 'TRUE', lastSignalCandle: 1, lastAlertAt: '2026-10-07T05:30:00.000Z', cooldownUntil: null, lastEvaluation: null });

/** NIFTY: the future leads the call; fires on the 11:00 candle (as in memoryLayer.test.ts). */
async function session() {
  const D = '2026-10-07';
  const clock = { now: ist(D, '09:30') };
  const inner = new MemoryV2Store(() => clock.now);
  const db = switchable(inner);
  const store = new RuntimeV2Store(db.store, () => clock.now, createRuntimeState(), { retryMs: () => 1 });
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
  const channels = new RecordingChannels();
  const svc = new V2Service({ store, provider, products: new ProductService(store, provider), channels, clock: () => clock.now });
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
  // Warm-up with the database up: the screens a trader keeps open.
  clock.now = ist(D, '09:45') + 30_000;
  await svc.scan();
  await svc.alertFeed(null, 1);
  await svc.paperSummary();
  await store.flushWrites();
  return { D, clock, inner, db, store, svc, channels, connectionId: c!.id, strategyId: s.id };
}

describe('database unreachable', () => {
  it('the alert still goes out (Telegram, alarm, paper trade); its records are saved when the database is back', async () => {
    const { D, clock, inner, db, store, svc, channels } = await session();
    db.state.down = true;
    clock.now = ist(D, '11:00') + 30_000;
    const fired = await svc.scan();
    expect(fired.run.alerts).toBe(1);
    expect(channels.sent).toHaveLength(1); // Telegram didn't wait for the database
    expect((await svc.alertFeed(null, 5)).map((a) => a.strategyName)).toEqual(['Future leads the call']); // the alarm rings
    expect(await svc.paperTrades({ status: 'OPEN' })).toHaveLength(1);
    expect((await svc.paperSummary()).overall).toMatchObject({ open: 1 });
    const waiting = store.pendingWrites();
    expect(waiting).toMatchObject({ count: 5, dropped: 0 }); // signal, alert, paper trade, delivery, unit state
    expect(waiting.failingSince).not.toBeNull();
    expect((await svc.status()).database).toMatchObject({ count: 5 });
    expect(inner.data.alerts).toHaveLength(0);

    db.state.down = false;
    await until(() => store.pendingWrites().count === 0);
    expect(store.pendingWrites()).toMatchObject({ failingSince: null, lastError: null });
    expect(inner.data.signals.filter((x) => x.outcome === 'ALERTED')).toHaveLength(1);
    expect(inner.data.alerts).toHaveLength(1);
    expect(inner.data.alerts[0]!.deliveries).toHaveLength(1);
    expect(inner.data.alerts[0]!.signalId).toBe(inner.data.signals.find((x) => x.outcome === 'ALERTED')!.id); // same ids as in memory
    expect(inner.data.paperTrades).toEqual([expect.objectContaining({ status: 'OPEN', alertId: inner.data.alerts[0]!.id })]);
    expect([...inner.data.units.values()].some((u) => u.state === 'TRIGGERED')).toBe(true);
  });

  it('records left when the app stops are kept in a file and saved on the next start', async () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'algo-hunt-writes-')), 'pending-writes.json');
    const down = switchable(new MemoryV2Store());
    down.state.down = true;
    const q1 = new WriteQueue(down.store, { file, retryMs: () => 5 });
    q1.push({ op: 'units.upsertMany', args: [[unitState('c1')]] });
    q1.push({ op: 'scanRuns.prune', args: ['2026-01-01T00:00:00.000Z'] });
    await until(() => q1.pending().failingSince !== null);
    await q1.close(50);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(2);

    const next = new MemoryV2Store();
    const q2 = new WriteQueue(next, { file }); // the next start
    await until(() => q2.size === 0);
    expect([...next.data.units.values()]).toEqual([expect.objectContaining({ connectionId: 'c1', state: 'TRIGGERED' })]);
    expect(existsSync(file)).toBe(false);
  });

  it('a write the database refuses is dropped (with the writes that need it); the rest go on', async () => {
    const db = new MemoryV2Store();
    // A signal with this identity is already saved (e.g. by the run before a restart).
    const prior = await db.signals.insert({ identity: 'dup', connectionId: 'c1', strategyId: 's1', version: 1, unitKey: 'k', triggerTimeframe: '15m', candleTime: 1, outcome: 'ALERTED', evaluation: {} as never });
    const q = new WriteQueue(db);
    const alert = { id: 'A2', signalId: 'S2', connectionId: 'c1', strategyId: 's1', strategyName: 'X', version: 1, productId: 'NSE:NIFTY', status: 'SENT', unit: {}, triggerTimeframe: '15m', candleTime: 1, evaluation: {} } as never;
    q.push({ op: 'signals.insert', args: [{ ...prior!, id: 'S2' }], provides: 'S2' });
    q.push({ op: 'alerts.insert', args: [alert], provides: 'A2', dependsOn: ['S2'] });
    q.push({ op: 'alerts.addDelivery', args: ['A2', { channel: 'telegram', status: 'sent', sentAt: '2026-10-07T05:30:00.000Z' }], dependsOn: ['A2'] });
    q.push({ op: 'paper.insertTrade', args: [{ id: 'T2', connectionId: 'c1', slot: 'shift:0', status: 'OPEN', alertId: 'A2' }], provides: 'T2', dependsOn: ['A2'] });
    q.push({ op: 'units.upsertMany', args: [[unitState('c1')]] });
    await q.drain();
    expect(db.data.signals.map((x) => x.id)).toEqual([prior!.id]);
    expect(db.data.alerts).toHaveLength(0); // its signal wasn't saved (duplicate)
    expect(db.data.paperTrades).toEqual([expect.objectContaining({ id: 'T2', alertId: null })]); // the trade stands on its own
    expect(db.data.units.size).toBe(1);

    // A constraint error (e.g. the connection was deleted meanwhile): tried 3 times, then dropped.
    const refusing = new Proxy(db, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        return prop === 'alerts' ? { ...v, insert: () => Promise.reject(Object.assign(new Error('violates foreign key constraint'), { code: '23503' })) } : v;
      },
    }) as V2Store;
    const q2 = new WriteQueue(refusing);
    q2.push({ op: 'alerts.insert', args: [{ ...(alert as object), id: 'A3' }], provides: 'A3' });
    q2.push({ op: 'alerts.addDelivery', args: ['A3', { channel: 'telegram', status: 'sent', sentAt: '2026-10-07T05:30:00.000Z' }], dependsOn: ['A3'] });
    q2.push({ op: 'units.upsertMany', args: [[unitState('c2')]] });
    await until(() => q2.size === 0);
    expect(q2.pending()).toMatchObject({ dropped: 1, failingSince: null });
    expect(db.data.units.size).toBe(2);
    expect(isPermanentWriteError({ code: '23505' })).toBe(true);
    expect(isPermanentWriteError({ code: '57P01' })).toBe(false); // server restarting: retry
    expect(isPermanentWriteError(Object.assign(new Error('timeout exceeded when trying to connect'), {}))).toBe(false);
  });
});

describe('lists and history', () => {
  it('alert and signal lists are read once and reused until an alert / signal changes them', async () => {
    const clock = { now: ist('2026-10-07', '10:00') };
    const db = switchable(new MemoryV2Store(() => clock.now));
    const store = new RuntimeV2Store(db.store, () => clock.now, createRuntimeState());
    const s = await store.strategies.create({ ...strategy([{ id: 'A', kind: 'FUT' }], cond(field(legSeries('A')), 'GT', num(1))), name: 'Spec' });
    const c = await store.connections.create(s.id, 'NSE:NIFTY', config());
    const calls = (k: string) => db.state.calls.get(k) ?? 0;
    await store.alerts.list({ active: true, limit: 50 });
    await store.alerts.list({ active: true, limit: 50 });
    await store.signals.list({ limit: 100 });
    await store.signals.list({ limit: 100 });
    expect([calls('alerts.list'), calls('signals.list')]).toEqual([1, 1]);
    const sig = await store.signals.insert({ identity: 'x', connectionId: c.id, strategyId: s.id, version: 1, unitKey: 'k', triggerTimeframe: '15m', candleTime: 1, outcome: 'ALERTED', evaluation: { productId: 'NSE:NIFTY', trace: { id: 'r', type: 'AND', result: 'TRUE' } } as never });
    await store.alerts.insert({ signalId: sig!.id, connectionId: c.id, strategyId: s.id, strategyName: 'Spec', version: 1, productId: 'NSE:NIFTY', status: 'SENT', unit: {} as never, triggerTimeframe: '15m', candleTime: 1, evaluation: {} as never });
    expect(await store.alerts.list({ active: true, limit: 50 })).toHaveLength(1); // the new alert (saved first)
    expect((await store.signals.list({ limit: 100 })).map((x) => x.identity)).toEqual(['x']);
    expect([calls('alerts.list'), calls('signals.list')]).toEqual([2, 2]);
  });

  it('history is kept until a period is chosen; then older records are deleted, now and once a day', async () => {
    const clock = { now: ist('2026-10-07', '10:00') };
    const store = new MemoryV2Store(() => clock.now);
    const svc = new V2Service({ store, provider: new FixtureV2Provider([]), products: new ProductService(store, new FixtureV2Provider([])), channels: new RecordingChannels(), clock: () => clock.now });
    const s = await store.strategies.create({ ...strategy([{ id: 'A', kind: 'FUT' }], cond(field(legSeries('A')), 'GT', num(1))), name: 'Spec' });
    const c = await store.connections.create(s.id, 'NSE:NIFTY', config());
    const alertAt = async (identity: string, at: number) => {
      const createdAt = new Date(at).toISOString();
      const sig = await store.signals.insert({ identity, connectionId: c.id, strategyId: s.id, version: 1, unitKey: 'k', triggerTimeframe: '15m', candleTime: 1, outcome: 'ALERTED', evaluation: {} as never, createdAt });
      await store.alerts.insert({ signalId: sig!.id, connectionId: c.id, strategyId: s.id, strategyName: 'Spec', version: 1, productId: 'NSE:NIFTY', status: 'SENT', unit: {} as never, triggerTimeframe: '15m', candleTime: 1, evaluation: {} as never, createdAt });
    };
    await alertAt('old', clock.now - 100 * DAY);
    await alertAt('month', clock.now - 40 * DAY);
    await alertAt('new', clock.now - DAY);

    expect((await svc.databaseInfo()).historyDays).toBeNull(); // default: keep everything
    expect(await svc.dailyHousekeeping()).toBeNull();
    expect(store.data.alerts).toHaveLength(3);

    const info = await svc.setHistoryDays(90);
    expect(info).toMatchObject({ historyDays: 90, lastPrune: { alerts: 1, signals: 1 } });
    expect(store.data.alerts).toHaveLength(2);
    // Saving the alert destinations doesn't change how long history is kept.
    const { historyDays: _h, ...destinations } = DEFAULT_V2_SETTINGS;
    await svc.saveSettings({ ...destinations, emailRecipients: ['a@b.co'] });
    expect((await svc.settings()).historyDays).toBe(90);

    expect(await svc.dailyHousekeeping()).toBeNull(); // already ran today
    await svc.setHistoryDays(30);
    expect(store.data.alerts.map((a) => store.data.signals.find((x) => x.id === a.signalId)!.identity)).toEqual(['new']);
    clock.now += DAY;
    expect(await svc.dailyHousekeeping()).toMatchObject({ alerts: 0 }); // the next day: runs again
    await svc.setHistoryDays(null);
    expect((await svc.databaseInfo()).historyDays).toBeNull();
  });
});
