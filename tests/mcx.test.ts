import { describe, expect, it } from 'vitest';
import type { OHLCV, StrategyDef, StrategyMarket } from '@ash/shared';
import { effectiveExpiryType, marketSegment, runsOnSegment } from '@ash/shared';
import { AlertService } from '../src/server/services/history/alertService';
import { NotificationService } from '../src/server/services/notification/NotificationService';
import { MonitorService } from '../src/server/services/live/monitorService';
import { createStrategyEngine } from '../src/server/services/strategy/StrategyEngine';
import { resolveMonitorContext, validateMarket } from '../src/server/services/strategy/runContext';
import { mcxCatalog } from '../src/server/services/mcx/mcxCatalog';
import { FixtureHistorical, fixtureInstrumentStore, fixtureStore, mcxMaster, niftyMaster } from './helpers/fixtures';

const ist = (s: string) => Date.parse(`${s}+05:30`);

describe('MCX contracts in the instrument store', () => {
  const store = fixtureInstrumentStore(mcxMaster(), 5437);

  it('offers near / next / far month — option expiries where options exist, futures expiries otherwise', async () => {
    await store.load();
    expect(store.expiryOptions('CRUDEOIL').map((o) => [o.type, o.date])).toEqual([
      ['near-month', '2099-10-16'],
      ['next-month', '2099-11-17'],
    ]);
    expect(store.expiryOptions('ALUMINIUM').map((o) => o.date)).toEqual(['2099-10-31', '2099-11-28', '2099-12-31']);
  });

  it('maps weekly expiry choices onto months (MCX has no weekly contracts)', async () => {
    await store.load();
    expect(store.resolveExpiryDate('CRUDEOIL', 'current-weekly')).toBe('2099-10-16');
    expect(store.resolveExpiryDate('CRUDEOIL', 'next-weekly')).toBe('2099-11-17');
    expect(store.resolveExpiryDate('CRUDEOIL', 'monthly')).toBe('2099-10-16');
  });

  it('reads the strike interval from the listed strikes and snaps ATM to a real strike', async () => {
    await store.load();
    expect(store.strikeInterval('CRUDEOIL')).toBe(50);
    const t = await store.resolveTriplet({ underlying: 'CRUDEOIL', expiry: '2099-10-16', strikeSelection: 'ATM' });
    expect(t.strike).toBe(5450); // LTP 5437 → nearest listed 5450
    expect(t.future.expiry).toBe('2099-10-20'); // the future the option devolves into
    expect(t.call?.strike).toBe(5450);
    const up = await store.resolveTriplet({ underlying: 'CRUDEOIL', expiry: '2099-10-16', strikeSelection: 'ATM+1' });
    expect(up.strike).toBe(5500);
    expect(store.strikeFromPrice('CRUDEOIL', 5437, 'ATM-1', undefined, '2099-10-16')).toBe(5400);
  });

  it('resolves futures-only products to a future-only contract set', async () => {
    await store.load();
    const t = await store.resolveTriplet({ underlying: 'ALUMINIUM', expiry: '2099-11-28', strikeSelection: 'ATM' });
    expect(t).toMatchObject({ strike: 0, future: { expiry: '2099-11-28' } });
    expect(t.call).toBeUndefined();
    expect(t.put).toBeUndefined();
  });

  it('builds the MCX tab catalog from the master', async () => {
    await store.load();
    const cat = mcxCatalog(store, ist('2026-09-23T12:00:00'));
    const crude = cat.find((p) => p.symbol === 'CRUDEOIL')!;
    expect(crude).toMatchObject({ available: true, hasOptions: true, strikeInterval: 50, strikeCount: 7, optionExpiries: ['2099-10-16', '2099-11-17'] });
    expect(crude.futures.map((f) => f.expiry)).toEqual(['2099-10-20', '2099-11-19', '2099-12-17']);
    expect(cat.find((p) => p.symbol === 'ALUMINIUM')).toMatchObject({ available: true, hasOptions: false });
    expect(cat.find((p) => p.symbol === 'GOLD')).toMatchObject({ available: false });
  });
});

// Wednesday 2026-09-23: NSE closed at 15:30, MCX trades until 23:30.
const LAST_OPEN = ist('2026-09-23T21:00:00');
const LAST_CLOSE = LAST_OPEN + 15 * 60_000;

/** 15-minute candles ending with the one opening at LAST_OPEN. */
function candles(closes: number[]): OHLCV[] {
  return closes.map((c, i) => {
    const time = (LAST_OPEN - (closes.length - 1 - i) * 15 * 60_000) / 1000;
    return { time, open: c, high: c, low: c, close: c, volume: 100 };
  });
}

/** Future close crosses above 250 AND the future's Daily close is above `dailyAbove`. */
function dailyFilterStrategy(id: string, dailyAbove: number): StrategyDef {
  const base = futureStrategy(id);
  base.root.children.push({
    type: 'condition',
    id: 'd',
    instrument: 'future',
    indicator: { kind: 'PRICE', field: 'close' },
    timeframe: '1d',
    operator: 'gt',
    value: dailyAbove,
  });
  return base;
}

function futureStrategy(id: string, instrument: 'future' | 'call' = 'future'): StrategyDef {
  return {
    id,
    name: id,
    status: 'active',
    version: 1,
    market: {},
    root: {
      type: 'group',
      id: 'r',
      logic: 'AND',
      children: [{ type: 'condition', id: 'c', instrument, indicator: { kind: 'PRICE', field: 'close' }, operator: 'crossAbove', value: 250 }],
    },
    createdAt: '',
    updatedAt: '',
  };
}

async function setup() {
  const master = [...mcxMaster(), ...niftyMaster()];
  const instrumentStore = fixtureInstrumentStore(master, 5437);
  const alu = master.find((i) => i.underlying === 'ALUMINIUM' && i.expiry === '2099-10-31')!;
  const closes = Array.from({ length: 40 }, (_, i) => 200 + i); // 200 … 239
  closes[39] = 251; // crosses 250 on the 21:00 candle
  const daily = [ist('2026-09-21T00:00:00'), ist('2026-09-22T00:00:00')].map((t) => ({ time: t / 1000, open: 190, high: 195, low: 185, close: 190, volume: 1000 }));
  const historical = new FixtureHistorical(new Map([[alu.token, candles(closes)]]), new Map([[`${alu.token}:1d`, daily]]));
  const store = fixtureStore([
    futureStrategy('fut-cross'),
    futureStrategy('call-cross', 'call'),
    dailyFilterStrategy('daily-ok', 245),
    dailyFilterStrategy('daily-blocks', 300),
  ]);
  const alertService = new AlertService(store, new NotificationService(store, []));
  const monitors = new MonitorService({ store, instrumentStore, engine: createStrategyEngine(), alertService, historical });
  return { store, monitors, historical };
}

describe('MCX monitors', () => {
  it('evaluate a futures-only product in the evening session', async () => {
    const { store, monitors } = await setup();
    const cfg = await store.configs.create({ underlying: 'ALUMINIUM', expiryType: 'near-month', strikeSelection: 'ATM', timeframe: '15m', strategy: 'fut-cross' });
    await monitors.activate(cfg, LAST_OPEN - 86_400_000);
    const [r] = await monitors.runAll(LAST_CLOSE + 5_000);
    expect(r?.error).toBeUndefined();
    expect(r?.alerts).toBe(1);
    expect(store.alertRows[0]).toMatchObject({ underlying: 'ALUMINIUM', strike: 0, bucket: LAST_OPEN, expiry: '2099-10-31' });
    const [snap] = await monitors.snapshots();
    expect(Object.keys(snap!.contracts!)).toEqual(['future']);
    expect(snap!.legs.call.rsi).toBeNull();
  });

  it('only evaluate monitors whose market is in session (unless forced)', async () => {
    const { store, monitors } = await setup();
    const alu = await store.configs.create({ underlying: 'ALUMINIUM', expiryType: 'near-month', strikeSelection: 'ATM', timeframe: '15m', strategy: 'fut-cross' });
    const nifty = await store.configs.create({ underlying: 'NIFTY', expiryType: 'current-weekly', strikeSelection: 'ATM', timeframe: '15m', strategy: 'fut-cross' });
    await monitors.activate(alu, LAST_OPEN - 86_400_000);
    await store.configs.setActive(nifty.id, true);
    const evening = await monitors.runAll(LAST_CLOSE + 5_000);
    expect(evening.map((r) => r.underlying)).toEqual(['ALUMINIUM']);
    const forced = await monitors.runAll(LAST_CLOSE + 5_000, { force: true });
    expect(forced.map((r) => r.underlying).sort()).toEqual(['ALUMINIUM', 'NIFTY']);
  });

  it('combine timeframes: fetch continuous Daily futures candles and read today’s forming daily close', async () => {
    const { store, monitors, historical } = await setup();
    const ok = await store.configs.create({ underlying: 'ALUMINIUM', expiryType: 'near-month', strikeSelection: 'ATM', timeframe: '15m', strategy: 'daily-ok' });
    const blocks = await store.configs.create({ underlying: 'ALUMINIUM', expiryType: 'near-month', strikeSelection: 'ATM', timeframe: '15m', strategy: 'daily-blocks' });
    await monitors.activate(ok, LAST_OPEN - 86_400_000);
    await monitors.activate(blocks, LAST_OPEN - 86_400_000);
    await monitors.runAll(LAST_CLOSE + 5_000);
    // Daily close as of 21:15 = 251 (today's forming candle): > 245 passes, > 300 blocks.
    expect(store.alertRows.map((a) => a.strategyId)).toEqual(['daily-ok']);
    const dailyCall = historical.calls.find((c) => c.timeframe === '1d');
    expect(dailyCall).toMatchObject({ continuous: true });
    expect(historical.calls.filter((c) => c.timeframe === '1d')).toHaveLength(1); // shared across both monitors
  });

  it('refuse strategies that need options on futures-only products', async () => {
    const { store, monitors } = await setup();
    const builtin = await store.configs.create({ underlying: 'ALUMINIUM', expiryType: 'near-month', strikeSelection: 'ATM', timeframe: '15m', strategy: 'rsi-sync' });
    await expect(monitors.activate(builtin)).rejects.toThrow(/no listed options/);
    const callStrategy = await store.configs.create({ underlying: 'ALUMINIUM', expiryType: 'near-month', strikeSelection: 'ATM', timeframe: '15m', strategy: 'call-cross' });
    await expect(monitors.activate(callStrategy)).rejects.toThrow(/reads the call leg/);
  });
});

describe('market profiles across NSE and MCX', () => {
  it('maps weekly expiries onto MCX months and pins strategies to a market', () => {
    expect(effectiveExpiryType('current-weekly', 'MCX')).toBe('near-month');
    expect(effectiveExpiryType('next-weekly', 'MCX')).toBe('next-month');
    expect(effectiveExpiryType('current-weekly', 'NSE')).toBe('current-weekly');
    const gold: StrategyMarket = { underlyings: ['GOLD', 'SILVER'] };
    expect(marketSegment(gold)).toBe('MCX');
    expect(marketSegment({})).toBeUndefined();
    expect(runsOnSegment(gold, 'NSE')).toBe(false);
    expect(runsOnSegment({ timeframe: '15m' }, 'MCX')).toBe(true);
    expect(runsOnSegment({ expiryType: 'far-month', underlyings: ['GOLD'] }, 'MCX')).toBe(true);
  });

  it('rejects baskets that mix markets and MCX expiries on NSE underlyings', async () => {
    expect(() => validateMarket({ underlyings: ['NIFTY', 'GOLD'] })).toThrow(/not both/);
    expect(() => validateMarket({ expiryType: 'near-month' })).toThrow(/MCX expiry/);
    expect(() => validateMarket({ expiryType: 'near-month', underlyings: ['GOLD'] })).not.toThrow();
    const store = fixtureStore();
    await expect(
      resolveMonitorContext(store, { underlying: 'NIFTY', expiryType: 'near-month', strikeSelection: 'ATM', timeframe: '15m', strategy: 'rsi-sync' }),
    ).rejects.toThrow(/MCX expiry/);
    await expect(
      resolveMonitorContext(store, { underlying: 'GOLD', expiryType: 'current-weekly', strikeSelection: 'ATM', timeframe: '15m', strategy: 'rsi-sync' }),
    ).resolves.toMatchObject({ underlying: 'GOLD' });
  });
});
