/**
 * Paper trades in the one-process app are kept on this computer during the day — in memory and in a local file,
 * written at every change — and go to the database once, after each market's close (one row per trade, however
 * often it changed). A restart carries on from the file; a close missed while the app was off is caught up.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalendarEntry, PaperTrade, StrategyDefinition } from '../../src/shared/v2';
import { calendars } from '../../src/server/v2/calendar/MarketCalendar';
import { lastPaperSyncPoint, nextPaperSyncPoint } from '../../src/server/v2/paper/paperSync';
import { RuntimeV2Store, createRuntimeState } from '../../src/server/v2/persistence/RuntimeV2Store';
import type { V2Store } from '../../src/server/v2/persistence/V2Store';
import { MemoryV2Store, cond, config, field, fut, ist, legSeries, num, strategy } from '../helpers/v2Fakes';

const D = '2026-10-26'; // a Monday
const DEF: StrategyDefinition = { ...strategy([{ id: 'A', kind: 'FUT' }], cond(field(legSeries('A')), 'GT', num(1))), name: 'Book' };

/** Counts the calls that reach the database; `down` makes them fail like an unreachable Neon. */
function counted(inner: V2Store) {
  const state = { down: false, calls: new Map<string, number>() };
  const wrap = <T extends object>(obj: T, ns: string): T =>
    new Proxy(obj, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v === 'function') {
          return (...args: unknown[]) => {
            const k = `${ns}${String(prop)}`;
            state.calls.set(k, (state.calls.get(k) ?? 0) + 1);
            if (state.down) return Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return v && typeof v === 'object' && !Array.isArray(v) && ns === '' && typeof prop === 'string' && prop !== 'data' ? wrap(v as object, `${prop}.`) : v;
      },
    });
  return {
    store: wrap(inner, '') as V2Store,
    state,
    paperCalls: () =>
      [...state.calls].filter(([k]) => k.startsWith('paper.') && !/^paper\.(getPlan|listPlans|getOverride|listOverrides|listOpen|listTrades)$/.test(k)),
  };
}

async function setup() {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'algo-hunt-book-')), 'paper-book.json');
  const clock = { now: ist(D, '09:30') };
  const inner = new MemoryV2Store(() => clock.now);
  const db = counted(inner);
  /** A start of the app: its own memory, the same database and book file. */
  const open = (rt = createRuntimeState()) => new RuntimeV2Store(db.store, () => clock.now, rt, { paperBookFile: file, retryMs: () => 1 });
  const rt = createRuntimeState();
  const store = open(rt);
  const s = await store.strategies.create(DEF);
  const nifty = await store.connections.create(s.id, 'NSE:NIFTY', config());
  const gold = await store.connections.create(s.id, 'MCX:GOLD', config());
  const iso = () => new Date(clock.now).toISOString();
  const draft = (connectionId: string, slot = 'shift:0', instrument = fut('NSE:NIFTY', '2026-10-27')) =>
    ({
      strategyId: s.id,
      connectionId,
      productId: instrument.productId,
      slot,
      unitKey: 'k',
      alertId: null,
      status: 'OPEN',
      entryAt: iso(),
      entryRef: 100,
      entryPrice: 100,
      lastPrice: 100,
      lastPriceAt: iso(),
      instrument,
      terms: { squareOff: false },
    }) as unknown as Omit<PaperTrade, 'id'>;
  const close = (store: RuntimeV2Store, id: string, price: number, reason: 'TARGET' | 'STOP' = 'TARGET') =>
    store.paper.closeTrade(id, {
      exitAt: iso(),
      exitPrice: price,
      exitReason: reason,
      grossPnl: price - 100,
      charges: 0,
      netPnl: price - 100,
      lastPrice: price,
      lastPriceAt: iso(),
    });
  return { file, clock, inner, db, open, rt, store, s, nifty, gold, draft, close, iso };
}

describe('paper trades between end-of-day syncs', () => {
  it('stay on this computer all day (file at every change), survive a restart, then go to the database once per trade', async () => {
    const { file, clock, inner, db, open, rt, store, nifty, gold, draft, close } = await setup();
    clock.now = ist(D, '10:00');
    const a = (await store.paper.insertTrade(draft(nifty.id)))!;
    clock.now = ist(D, '11:00');
    await close(store, a.id, 120);
    clock.now = ist(D, '12:00');
    const b = (await store.paper.insertTrade(draft(nifty.id)))!; // the slot is free again
    clock.now = ist(D, '14:00');
    const m = (await store.paper.insertTrade(draft(gold.id, 'shift:0', fut('MCX:GOLD', '2026-12-04', 'MCX'))))!;
    await store.paper.updateMarks([{ id: b.id, lastPrice: 104.5, at: new Date(ist(D, '15:29')).toISOString() }]);
    await store.flushWrites();
    expect(db.paperCalls()).toEqual([]); // nothing went to the database
    expect(inner.data.paperTrades).toEqual([]);
    expect(JSON.parse(readFileSync(file, 'utf8')).entries).toHaveLength(3); // but every change is in the file

    // The app restarts before the close (the latest prices are written within 30 s — here: at shutdown).
    rt.paperBook!.flush();
    const again = open();
    expect((await again.paper.listTrades({})).map((t) => [t.id, t.status])).toEqual([
      [m.id, 'OPEN'],
      [b.id, 'OPEN'],
      [a.id, 'CLOSED'],
    ]);
    expect((await again.paper.openFor(nifty.id, 'shift:0'))?.lastPrice).toBe(104.5); // carries on from the real last price
    expect(again.paperBook()).toMatchObject({ waiting: 3 });

    // 15:36, after NSE's close: one write with the three trades — the closed one, and both open ones at their latest price.
    clock.now = ist(D, '15:36');
    expect(await again.syncPaper()).toMatchObject({ saved: 3, skipped: 0 });
    expect(db.paperCalls()).toEqual([['paper.saveTrades', 1]]);
    expect(inner.data.paperTrades.map((t) => [t.id, t.status, t.lastPrice])).toEqual(
      expect.arrayContaining([
        [a.id, 'CLOSED', 120],
        [b.id, 'OPEN', 104.5],
        [m.id, 'OPEN', 100],
      ]),
    );
    expect(again.paperBook()).toMatchObject({ waiting: 0, pricesWaiting: 0, lastSyncAt: new Date(ist(D, '15:36')).toISOString() });

    // Evening: gold moves and closes; the NIFTY position (unchanged) isn't written again.
    clock.now = ist(D, '20:00');
    await again.paper.updateMarks([{ id: m.id, lastPrice: 103, at: new Date(clock.now).toISOString() }]);
    clock.now = ist(D, '21:00');
    await close(again, m.id, 110);
    clock.now = ist(D, '23:36');
    expect(await again.syncPaper()).toMatchObject({ saved: 1 });
    expect(inner.data.paperTrades.find((t) => t.id === m.id)).toMatchObject({ status: 'CLOSED', netPnl: 10 });
    expect(inner.data.paperTrades).toHaveLength(3);
  });

  it('closes a slot’s old trade before its new one opens, and leaves out trades of a connection deleted meanwhile', async () => {
    const { clock, inner, store, nifty, gold, draft, close } = await setup();
    clock.now = ist(D, '10:00');
    const old = (await store.paper.insertTrade(draft(nifty.id)))!;
    await store.paper.insertTrade(draft(gold.id, 'shift:0', fut('MCX:GOLD', '2026-12-04', 'MCX')));
    clock.now = ist(D, '15:36');
    await store.syncPaper(); // both saved open
    clock.now = ist(D, '16:00');
    await close(store, old.id, 95, 'STOP');
    const fresh = (await store.paper.insertTrade(draft(nifty.id)))!; // same slot
    inner.data.connections.delete(gold.id); // gold's connection goes (e.g. from another copy of the app)
    const goldTrade = (await store.paper.listOpen()).find((t) => t.connectionId === gold.id)!;
    await store.paper.updateMarks([{ id: goldTrade.id, lastPrice: 101, at: new Date(clock.now).toISOString() }]);
    clock.now = ist(D, '23:36');
    expect(await store.syncPaper()).toMatchObject({ saved: 2, skipped: 1 });
    expect(inner.data.paperTrades.filter((t) => t.connectionId === nifty.id).map((t) => [t.id, t.status])).toEqual([
      [old.id, 'CLOSED'],
      [fresh.id, 'OPEN'],
    ]);
    expect(store.paperBook()).toMatchObject({ waiting: 0 });
  });

  it('reset and the history clean-up count the trades only this computer had', async () => {
    const { clock, store, s, nifty, draft, close } = await setup();
    clock.now = ist(D, '10:00');
    const t = (await store.paper.insertTrade(draft(nifty.id)))!;
    await close(store, t.id, 110);
    await store.paper.insertTrade(draft(nifty.id));
    expect(await store.paper.reset(s.id)).toBe(2);
    expect(store.paperBook()).toMatchObject({ waiting: 0 });
    expect(await store.paper.listTrades({})).toEqual([]);

    const old = (await store.paper.insertTrade(draft(nifty.id)))!;
    await close(store, old.id, 110);
    clock.now += 40 * 86_400_000;
    expect(await store.maintenance.prune(new Date(clock.now - 30 * 86_400_000).toISOString())).toMatchObject({ paperTrades: 1 });
    expect(store.paperBook()).toMatchObject({ waiting: 0 });
  });

  it('a database that is down at the close keeps everything for the next try', async () => {
    const { clock, inner, db, store, nifty, draft } = await setup();
    clock.now = ist(D, '10:00');
    await store.paper.insertTrade(draft(nifty.id));
    clock.now = ist(D, '15:36');
    db.state.down = true;
    await expect(store.syncPaper()).rejects.toThrow('ECONNREFUSED');
    expect(store.paperBook()).toMatchObject({ waiting: 1, lastError: expect.stringContaining('ECONNREFUSED'), lastSyncAt: null });
    db.state.down = false;
    expect(await store.syncPaper()).toMatchObject({ saved: 1 });
    expect(inner.data.paperTrades).toHaveLength(1);
  });

  it('a book file that can’t be read is moved aside, never overwritten', async () => {
    const { file, open } = await setup();
    writeFileSync(file, '{ half a book');
    const store = open();
    expect(store.paperBook()).toMatchObject({ waiting: 0 });
    expect(readdirSync(path.dirname(file)).some((f) => f.startsWith('paper-book.json.unreadable-'))).toBe(true);
    expect(existsSync(file)).toBe(false);
  });
});

describe('when the sync is due', () => {
  const cals = calendars([]);
  const at = (date: string, time: string) => new Date(ist(date, time)).toISOString();
  const point = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  it('a few minutes after each market’s close: NSE, then MCX; a missed close counts until the next one', () => {
    expect(point(lastPaperSyncPoint(cals, ist(D, '15:30')))).toBe(at('2026-10-23', '23:36')); // Friday's MCX close
    expect(point(nextPaperSyncPoint(cals, ist(D, '15:30')))).toBe(at(D, '15:36'));
    expect(point(lastPaperSyncPoint(cals, ist(D, '16:00')))).toBe(at(D, '15:36'));
    expect(point(nextPaperSyncPoint(cals, ist(D, '16:00')))).toBe(at(D, '23:36')); // MCX closes at 23:30 while the US is on summer time
    expect(point(lastPaperSyncPoint(cals, ist('2026-10-31', '11:00')))).toBe(at('2026-10-30', '23:36')); // Saturday: Friday's close
  });

  it('holidays have no close', () => {
    const entries: CalendarEntry[] = [
      { market: 'NSE', date: D, kind: 'HOLIDAY', note: 'Diwali' },
      { market: 'MCX', date: D, kind: 'HOLIDAY', note: 'Diwali' },
    ];
    const holiday = calendars(entries);
    expect(point(nextPaperSyncPoint(holiday, ist(D, '09:00')))).toBe(at('2026-10-27', '15:36'));
  });
});
