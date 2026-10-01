/**
 * The local database (SQLite built into Node) and the app's memory layer (RuntimeV2Store) behave exactly like
 * the in-memory store every other test uses: one behaviour spec runs against all three. Then end to end on SQLite: sync, strategy, connection, a
 * scan that alerts (deduped), a paper trade opened and closed, filters, the alarm feed.
 */
import { describe, expect, it } from 'vitest';
import type { PaperTrade, StrategyDefinition, UnitEvaluation, V2Signal } from '../../src/shared/v2';
import { defaultPaperPlan } from '../../src/shared/v2';
import { openSqlite } from '../../src/server/db/sqlite';
import { SqliteV2Store } from '../../src/server/v2/persistence/SqliteV2Store';
import { RuntimeV2Store, createRuntimeState } from '../../src/server/v2/persistence/RuntimeV2Store';
import type { V2Store as Store } from '../../src/server/v2/persistence/V2Store';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { V2Service } from '../../src/server/v2/V2Service';
import {
  FixtureV2Provider,
  MemoryV2Store,
  NSE_SESSION,
  RecordingChannels,
  and,
  candlesAt,
  cond,
  config,
  field,
  fut,
  ind,
  ist,
  ladder,
  legSeries,
  momentumCloses,
  num,
  productsOf,
  spot,
  strategy,
  timesEndingAt,
} from '../helpers/v2Fakes';

type Maker = (clock: () => number) => Store;
const makers: Array<[string, Maker]> = [
  ['in-memory', (clock) => new MemoryV2Store(clock)],
  ['SQLite', (clock) => new SqliteV2Store(openSqlite(':memory:'), clock)],
  // The one-process app: memory in front of the database (here over SQLite, as over Neon).
  ['memory layer over SQLite', (clock) => new RuntimeV2Store(new SqliteV2Store(openSqlite(':memory:'), clock), clock, createRuntimeState())],
];

const DEF: StrategyDefinition = { ...strategy([{ id: 'A', kind: 'FUT' }], cond(field(legSeries('A')), 'GT', num(1))), name: 'Spec' };
const INST = [spot('NSE:NIFTY', 'NIFTY 50'), fut('NSE:NIFTY', '2026-10-27'), spot('NSE:ITC', 'ITC'), fut('MCX:GOLD', '2026-12-04', 'MCX')];
const evaluation = (productId: string, fired: 'g1' | 'g2', source?: UnitEvaluation['source']): UnitEvaluation =>
  ({
    strategyId: 's',
    version: 1,
    productId,
    unit: { key: 'k', productId, expiry: null, baseStrike: null, shift: 0, legs: {} },
    mode: 'COMPLETED_CANDLE',
    triggerTimeframe: '15m',
    triggerCandle: 1,
    evaluatedAt: 0,
    result: 'TRUE',
    trace: { id: 'root', type: 'OR', result: 'TRUE', children: [{ id: 'g1', type: 'AND', result: fired === 'g1' ? 'TRUE' : 'FALSE' }, { id: 'g2', type: 'AND', result: fired === 'g2' ? 'TRUE' : 'FALSE' }] },
    prices: { A: 100 },
    source,
  }) as UnitEvaluation;

describe.each(makers)('store behaviour — %s', (name, make) => {
  /** Postgres-like details the simple in-memory fake doesn't model (product order, the lock's minimum interval). */
  const real = name !== 'in-memory';
  const setup = () => {
    const clock = { now: ist('2026-10-07', '10:00') };
    return { clock, store: make(() => clock.now) };
  };

  it('instruments, products and the calendar', async () => {
    const { store } = setup();
    await store.instruments.replaceAll(INST, productsOf(INST, { ITC: 'ITC LTD' }));
    expect(await store.instruments.count()).toBe(4);
    expect((await store.instruments.forProduct('NSE:NIFTY')).map((i) => i.kind).sort()).toEqual(['FUT', 'SPOT']);
    expect(await store.instruments.syncedAt()).toEqual(expect.any(String));
    const withFutures = (await store.products.list({ needs: ['FUT'] })).map((p) => p.id);
    expect([...withFutures].sort()).toEqual(['MCX:GOLD', 'NSE:NIFTY']);
    if (real) expect(withFutures).toEqual(['NSE:NIFTY', 'MCX:GOLD']); // indices, then commodities, then stocks
    expect((await store.products.list({ search: 'itc' })).map((p) => [p.id, p.name, p.hasSpot, p.hasFutures])).toEqual([['NSE:ITC', 'ITC LTD', true, false]]);
    expect(await store.products.countByKind({ market: 'NSE' })).toEqual({ INDEX: 1, STOCK: 1, COMMODITY: 0 });
    expect((await store.products.get('MCX:GOLD'))?.futureExpiries).toEqual(['2026-12-04']);
    await store.calendar.replaceAll([{ market: 'NSE', date: '2026-10-02', kind: 'HOLIDAY', note: 'Gandhi Jayanti' }, { market: 'MCX', date: '2026-11-08', kind: 'SPECIAL_SESSION', openMin: 1080, closeMin: 1155 }]);
    expect(await store.calendar.list()).toEqual([
      { market: 'NSE', date: '2026-10-02', kind: 'HOLIDAY', note: 'Gandhi Jayanti' },
      { market: 'MCX', date: '2026-11-08', kind: 'SPECIAL_SESSION', openMin: 1080, closeMin: 1155, note: undefined },
    ]);
  });

  it('strategies with versions; connections; deleting a strategy removes its connections', async () => {
    const { store } = setup();
    const s = await store.strategies.create(DEF);
    expect(s).toMatchObject({ name: 'Spec', version: 1, definition: DEF });
    const s2 = await store.strategies.update(s.id, { ...DEF, name: 'Spec 2' });
    expect(s2).toMatchObject({ name: 'Spec 2', version: 2 });
    expect((await store.strategies.versions(s.id)).map((v) => v.version)).toEqual([2, 1]);
    expect(await store.strategies.count()).toBe(1);
    const c = await store.connections.create(s.id, 'NSE:NIFTY', config());
    expect(c).toMatchObject({ strategyId: s.id, productId: 'NSE:NIFTY', enabled: false, enabledAt: null, config: config() });
    expect(await store.connections.setEnabled(c.id, true, '2026-10-07T04:30:00.000Z')).toMatchObject({ enabled: true, enabledAt: '2026-10-07T04:30:00.000Z' });
    const c2 = await store.connections.create(s.id, 'MCX:GOLD', config());
    expect(await store.connections.counts()).toEqual({ total: 2, enabled: 1 });
    expect(await store.connections.setEnabledMany([c.id, c2.id], false, '2026-10-07T05:00:00.000Z')).toBe(2);
    expect((await store.connections.get(c.id))?.enabledAt).toBe('2026-10-07T04:30:00.000Z'); // kept when switching off
    expect((await store.connections.update(c.id, config({ strikeShifts: [-1, 0] })))?.config.strikeShifts).toEqual([-1, 0]);
    expect(await store.strategies.remove(s.id)).toBe(true);
    expect(await store.strategies.get(s.id)).toBeNull();
    // The in-memory store doesn't cascade; SQLite does (as Postgres) — both leave no strategy behind.
    expect(await store.strategies.count()).toBe(0);
  });

  it('unit states: upsert, list, disable, clear', async () => {
    const { store } = setup();
    const s = await store.strategies.create(DEF);
    const c = await store.connections.create(s.id, 'NSE:NIFTY', config());
    const base = { connectionId: c.id, state: 'IDLE' as const, lastEvaluatedCandle: 10, lastResult: 'TRUE' as const, lastSignalCandle: null, lastAlertAt: null, cooldownUntil: null, lastEvaluation: null };
    await store.units.upsertMany([{ ...base, unitKey: 'a' }, { ...base, unitKey: 'b', lastEvaluation: evaluation('NSE:NIFTY', 'g1') }]);
    await store.units.upsert({ ...base, unitKey: 'a', lastEvaluatedCandle: 11 });
    expect((await store.units.list(c.id)).map((u) => [u.unitKey, u.lastEvaluatedCandle])).toEqual([['a', 11], ['b', 10]]);
    expect((await store.units.get(c.id, 'b'))?.lastEvaluation?.prices).toEqual({ A: 100 });
    await store.units.disableMany([c.id]);
    expect((await store.units.listFor([c.id])).map((u) => u.state)).toEqual(['DISABLED', 'DISABLED']);
    await store.units.clear(c.id);
    expect(await store.units.list(c.id)).toEqual([]);
  });

  it('signals dedupe by identity; alerts, deliveries, acknowledge, feed and filters', async () => {
    const { clock, store } = setup();
    await store.instruments.replaceAll(INST, productsOf(INST));
    const s = await store.strategies.create(DEF);
    const conns = { nifty: await store.connections.create(s.id, 'NSE:NIFTY', config()), gold: await store.connections.create(s.id, 'MCX:GOLD', config()) };
    const signal = (identity: string, productId: string, fired: 'g1' | 'g2', source?: UnitEvaluation['source']): Omit<V2Signal, 'id' | 'createdAt'> => ({
      identity,
      connectionId: productId === 'MCX:GOLD' ? conns.gold.id : conns.nifty.id,
      strategyId: s.id,
      version: 1,
      unitKey: 'k',
      triggerTimeframe: productId === 'MCX:GOLD' ? '5m' : '15m',
      candleTime: 1,
      outcome: 'ALERTED',
      evaluation: evaluation(productId, fired, source),
    });
    const sig = await store.signals.insert(signal('x1', 'NSE:NIFTY', 'g1', 'LIVE_VERIFIED'));
    expect(sig).toMatchObject({ identity: 'x1', outcome: 'ALERTED' });
    expect(await store.signals.insert(signal('x1', 'NSE:NIFTY', 'g1'))).toBeNull(); // same identity: deduped
    const a1 = await store.alerts.insert({ signalId: sig!.id, connectionId: conns.nifty.id, strategyId: s.id, strategyName: 'Spec', version: 1, productId: 'NSE:NIFTY', status: 'SENT', unit: sig!.evaluation.unit, triggerTimeframe: '15m', candleTime: 1, evaluation: sig!.evaluation });
    clock.now += 60_000;
    const sig2 = await store.signals.insert(signal('x2', 'MCX:GOLD', 'g2'));
    const a2 = await store.alerts.insert({ signalId: sig2!.id, connectionId: conns.gold.id, strategyId: s.id, strategyName: 'Spec', version: 1, productId: 'MCX:GOLD', status: 'SENT', unit: sig2!.evaluation.unit, triggerTimeframe: '5m', candleTime: 1, evaluation: sig2!.evaluation });
    await store.alerts.addDelivery(a1.id, { channel: 'telegram', target: 'Harsh (1)', status: 'sent', sentAt: '2026-10-07T04:30:01.000Z' });
    await store.alerts.setStatus(a2.id, 'FAILED');
    expect((await store.alerts.get(a1.id))?.deliveries).toEqual([{ channel: 'telegram', target: 'Harsh (1)', status: 'sent', sentAt: '2026-10-07T04:30:01.000Z', error: undefined }]);
    expect((await store.alerts.get(a1.id))?.evaluation.trace.children).toHaveLength(2); // full alert keeps the trace
    const ids = (list: Array<{ id: string }>) => list.map((x) => x.id);
    expect(ids(await store.alerts.list({}))).toEqual([a2.id, a1.id]);
    expect(ids(await store.alerts.list({ markets: ['MCX'] }))).toEqual([a2.id]);
    expect(ids(await store.alerts.list({ kinds: ['INDEX'], search: 'nif' }))).toEqual([a1.id]);
    expect(ids(await store.alerts.list({ groups: ['g2'] }))).toEqual([a2.id]);
    expect(ids(await store.alerts.list({ sources: ['HISTORICAL'] }))).toEqual([a2.id]);
    expect(ids(await store.alerts.list({ statuses: ['FAILED'] }))).toEqual([a2.id]);
    expect(ids(await store.alerts.list({ timeframes: ['15m'], since: '2026-10-07T04:30:00.000Z', until: '2026-10-07T04:30:30.000Z' }))).toEqual([a1.id]);
    expect((await store.signals.list({ groups: ['g1'] })).map((x) => x.identity)).toEqual(['x1']);
    expect(await store.alerts.acknowledge(a1.id, '2026-10-07T05:00:00.000Z')).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedAt: '2026-10-07T05:00:00.000Z' });
    expect(ids(await store.alerts.list({ active: true }))).toEqual([a2.id]);
    expect((await store.alerts.feed(null, 1)).map((x) => x.id)).toEqual([a2.id]);
    expect(await store.alerts.feed(a2.createdAt, 25)).toEqual([]);
    expect((await store.alerts.feed(a1.createdAt, 25)).map((x) => [x.id, x.strategyName, x.productId])).toEqual([[a2.id, 'Spec', 'MCX:GOLD']]);
  });

  it('scan runs, settings, locks and the live heartbeat', async () => {
    const { clock, store } = setup();
    await store.scanRuns.insert({ id: 'r1', startedAt: '2026-10-06T04:00:00.000Z', finishedAt: '2026-10-06T04:00:01.000Z', status: 'OK', trigger: 'auto', connections: 1, units: 1, unitsEvaluated: 1, instruments: 1, requests: 1, budget: 150, conditions: 1, signals: 0, alerts: 0, errors: [], notes: ['n'] });
    expect((await store.scanRuns.list(10))[0]).toMatchObject({ id: 'r1', status: 'OK', notes: ['n'], budget: 150 });
    await store.scanRuns.prune('2026-10-07T00:00:00.000Z');
    expect(await store.scanRuns.list(10)).toEqual([]);
    const settings = await store.settings.get();
    await store.settings.save({ ...settings, requestBudget: 99, telegramChats: [{ id: '123', name: 'Desk' }] });
    expect(await store.settings.get()).toMatchObject({ requestBudget: 99, telegramChats: [{ id: '123', name: 'Desk' }] });
    expect(await store.locks.acquire('scan', 240, 45)).toBe(true);
    expect(await store.locks.acquire('scan', 240, 45)).toBe(false); // held
    await store.locks.release('scan');
    if (real) expect(await store.locks.acquire('scan', 240, 45)).toBe(false); // released, but ran < 45 s ago
    clock.now += 46_000;
    expect(await store.locks.acquire('scan', 240, 45)).toBe(true);
    const status = { workerId: 'w1', heartbeatAt: '2026-10-07T04:30:00.000Z', state: 'LIVE' } as never;
    await store.live.save(status);
    await store.live.markOfflineNotified('2026-10-07T04:35:00.000Z');
    expect(await store.live.get()).toEqual({ status, offlineNotifiedAt: '2026-10-07T04:35:00.000Z' });
    await store.live.save(status);
    expect((await store.live.get())?.offlineNotifiedAt).toBeNull();
  });

  it('paper: plans, overrides, one open trade per slot, closing once, marks, versions', async () => {
    const { clock, store } = setup();
    const s = await store.strategies.create(DEF);
    const c = await store.connections.create(s.id, 'NSE:NIFTY', config());
    await store.paper.savePlan(s.id, defaultPaperPlan(DEF));
    expect((await store.paper.getPlan(s.id))?.cashPerTrade).toBe(10_000);
    expect(await store.paper.listPlans()).toHaveLength(1);
    expect(await store.paper.saveOverride(c.id, { cashPerTrade: 20_000, stopPct: null })).toEqual({ cashPerTrade: 20_000, stopPct: null });
    expect(await store.paper.getOverride(c.id)).toEqual({ cashPerTrade: 20_000, stopPct: null });
    expect(await store.paper.saveOverride(c.id, {})).toBeNull();
    expect(await store.paper.listOverrides()).toEqual([]);
    const draft = { strategyId: s.id, connectionId: c.id, productId: 'NSE:NIFTY', slot: 'shift:0', unitKey: 'k', alertId: null, status: 'OPEN', entryAt: '2026-10-07T04:30:00.000Z', capitalUsed: 7_500, lastPrice: 100, lastPriceAt: null } as unknown as Omit<PaperTrade, 'id'>;
    const t = await store.paper.insertTrade(draft);
    expect(t).toMatchObject({ slot: 'shift:0', status: 'OPEN' });
    expect(await store.paper.insertTrade({ ...draft, entryAt: '2026-10-07T04:31:00.000Z' })).toBeNull(); // slot taken
    expect((await store.paper.openFor(c.id, 'shift:0'))?.id).toBe(t!.id);
    await store.paper.updateMarks([{ id: t!.id, lastPrice: 104.5, at: '2026-10-07T04:40:00.000Z' }]);
    expect((await store.paper.listOpen())[0]).toMatchObject({ lastPrice: 104.5, lastPriceAt: '2026-10-07T04:40:00.000Z' });
    const v0 = await store.paper.closedVersion();
    clock.now += 60_000;
    const patch = { exitAt: '2026-10-07T04:45:00.000Z', exitPrice: 105, exitReason: 'TARGET' as const, grossPnl: 375, charges: 40, netPnl: 335, lastPrice: 105, lastPriceAt: '2026-10-07T04:45:00.000Z' };
    expect(await store.paper.closeTrade(t!.id, patch)).toMatchObject({ status: 'CLOSED', netPnl: 335, capitalUsed: 7_500 });
    expect(await store.paper.closeTrade(t!.id, patch)).toBeNull(); // only once
    expect(await store.paper.closedVersion()).not.toBe(v0);
    expect(await store.paper.insertTrade({ ...draft, entryAt: '2026-10-07T04:50:00.000Z' })).toMatchObject({ status: 'OPEN' }); // slot free again
    expect((await store.paper.listTrades({ status: 'CLOSED' })).map((x) => x.netPnl)).toEqual([335]);
    expect((await store.paper.listTrades({ since: '2026-10-07T04:45:00.000Z' })).map((x) => x.status)).toEqual(['OPEN']);
    expect(await store.paper.reset(s.id)).toBe(2);
    expect(await store.paper.listTrades({})).toEqual([]);
  });

  it('history clean-up: older alerts, signals and closed paper trades go; open trades and newer records stay', async () => {
    const { clock, store } = setup();
    const s = await store.strategies.create(DEF);
    const c = await store.connections.create(s.id, 'NSE:NIFTY', config());
    const alertFor = async (identity: string) => {
      const sig = await store.signals.insert({ identity, connectionId: c.id, strategyId: s.id, version: 1, unitKey: 'k', triggerTimeframe: '15m', candleTime: 1, outcome: 'ALERTED', evaluation: evaluation('NSE:NIFTY', 'g1') });
      return store.alerts.insert({ signalId: sig!.id, connectionId: c.id, strategyId: s.id, strategyName: 'Spec', version: 1, productId: 'NSE:NIFTY', status: 'SENT', unit: sig!.evaluation.unit, triggerTimeframe: '15m', candleTime: 1, evaluation: sig!.evaluation });
    };
    const iso = () => new Date(clock.now).toISOString();
    const old = await alertFor('old');
    await store.alerts.addDelivery(old.id, { channel: 'telegram', status: 'sent', sentAt: iso() });
    const draft = { strategyId: s.id, connectionId: c.id, productId: 'NSE:NIFTY', slot: 'shift:0', unitKey: 'k', alertId: old.id, status: 'OPEN', entryAt: iso(), capitalUsed: 7_500, lastPrice: 100, lastPriceAt: null } as unknown as Omit<PaperTrade, 'id'>;
    const closed = await store.paper.insertTrade(draft);
    await store.paper.closeTrade(closed!.id, { exitAt: iso(), exitPrice: 105, exitReason: 'TARGET', grossPnl: 375, charges: 40, netPnl: 335, lastPrice: 105, lastPriceAt: iso() });
    await store.paper.insertTrade({ ...draft, slot: 'shift:1', alertId: null }); // still open
    clock.now += 40 * 86_400_000;
    const fresh = await alertFor('fresh');
    const out = await store.maintenance.prune(new Date(clock.now - 30 * 86_400_000).toISOString());
    expect(out).toMatchObject({ alerts: 1, signals: 1, paperTrades: 1 });
    expect((await store.alerts.list({})).map((a) => a.id)).toEqual([fresh.id]);
    expect((await store.alerts.feed(null, 10)).map((a) => a.id)).toEqual([fresh.id]);
    expect((await store.signals.list({})).map((x) => x.identity)).toEqual(['fresh']);
    expect((await store.paper.listTrades({})).map((t) => [t.slot, t.status])).toEqual([['shift:1', 'OPEN']]);
    const size = await store.maintenance.size();
    expect(size.engine).toBe(name === 'in-memory' ? 'memory' : 'sqlite');
    if (real) expect(size.bytes).toBeGreaterThan(0);
  });

  it('the context stamp changes when connections change', async () => {
    const { clock, store } = setup();
    const s = await store.strategies.create(DEF);
    const before = await store.contextStamp();
    expect(await store.contextStamp()).toBe(before);
    clock.now += 1000;
    await store.connections.create(s.id, 'NSE:NIFTY', config());
    expect(await store.contextStamp()).not.toBe(before);
  });
});

describe('SQLite end to end', () => {
  it('sync → strategy → connection → scan alerts once → paper trade opens and closes at the target', async () => {
    const D = '2026-10-07';
    const clock = { now: ist(D, '09:30') };
    const store: Store = new SqliteV2Store(openSqlite(':memory:'), () => clock.now);
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
    const S = {
      ...strategy(
        [
          { id: 'A', kind: 'FUT' },
          { id: 'B', kind: 'CE', strikeOffset: 0 },
        ],
        and(cond(ind(legSeries('A'), 'RSI', { period: 14 }), 'GT', ind(legSeries('B'), 'RSI', { period: 14 })), cond(ind(legSeries('B'), 'RSI', { period: 14 }), 'CROSSED_ABOVE', num(60))),
      ),
      name: 'Future leads the call',
    } as StrategyDefinition;
    const s = await svc.createStrategy(S);
    const [c] = await svc.createConnections(s.id, ['NSE:NIFTY'], config());
    await svc.enableConnection(c!.id);

    clock.now = ist(D, '11:00') + 30_000;
    const first = await svc.scan();
    expect(first.run.errors).toEqual([]);
    expect(first.run.alerts).toBe(1);
    expect(channels.sent[0]!.message.text).toMatch(/Future leads the call[\s\S]*📄 Paper: BUY 1 lot \(75\)/);
    const [alert] = await svc.alerts({});
    expect(alert).toMatchObject({ productId: 'NSE:NIFTY', strategyName: 'Future leads the call' });
    expect('trace' in alert!.evaluation).toBe(false); // lists leave the trace out
    expect((await svc.alert(alert!.id)).evaluation.trace).toBeTruthy();
    expect((await svc.alertFeed(null, 1))[0]!.id).toBe(alert!.id);

    // Rescanning the same candle never alerts twice.
    await store.locks.release('v2-scan');
    clock.now += 50_000;
    expect((await svc.scan({ force: true })).run.alerts).toBe(0);

    // The option trades above the target: the next scan closes the paper trade.
    await store.locks.release('v2-scan');
    clock.now = ist(D, '11:05');
    provider.ltp.set(atmCe.token, 121);
    await svc.scan();
    const [t] = await svc.paperTrades({});
    expect(t).toMatchObject({ status: 'CLOSED', exitReason: 'TARGET', exitPrice: 120.6, grossPnl: 1507.5 });
    const sum = await svc.paperSummary({ markets: ['NSE'] });
    expect(sum.overall).toMatchObject({ trades: 1, wins: 1 });
    expect(sum.connections[0]).toMatchObject({ connectionId: c!.id, switchedOn: true });
    expect((await svc.alerts({ kinds: ['COMMODITY'] })).length).toBe(0);
  });
});
