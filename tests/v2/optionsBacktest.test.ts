/**
 * Options backtest: contracts as they were listed (expired ones included), re-picked at every trigger candle the
 * way the live scanner picks them — the expiry of that day, the strike nearest the index's close, each contract's
 * own lot size — then traded by the same simulator as the Backtest.
 *
 * Fixture week (NIFTY, weekly expiries on Tuesdays): E0 6 Oct, E1 13 Oct, E2 20 Oct, E3 27 Oct; lots 75 (E0, E1)
 * and 65 (E2, E3). The strategy: spot's 15-minute close crosses above 25,000 → buy the ATM call. Each test day the
 * spot sits below 25,000 until 10:00 and the 10:00–10:15 candle closes above it, at a different level per day.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { BacktestRequest, OptionsSourceStatus, PaperPlan, PaperTrade, StrategyDefinition, V2Instrument, V2Strategy } from '../../src/shared/v2';
import { defaultPaperPlan } from '../../src/shared/v2';
import { calendars } from '../../src/server/v2/calendar/MarketCalendar';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { aggregate } from '../../src/server/v2/engine/candles';
import { roundTripCharges } from '../../src/server/v2/paper/charges';
import { runOptionsBacktest } from '../../src/server/v2/paper/optionsBacktest';
import { V2Service } from '../../src/server/v2/V2Service';
import { FixtureHistory, dayMinutes, since, upLadder, upSpot } from '../helpers/optionsFakes';
import { FixtureV2Provider, MemoryV2Store, RecordingChannels, cond, field, fut, ist, ladder, legSeries, num, spot, strategy } from '../helpers/v2Fakes';

const P = 'NSE:NIFTY';
const [D1, D2, D3] = ['2026-10-12', '2026-10-13', '2026-10-14'];
const [E0, E1, E2, E3] = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];

/** Spot 15-minute close crosses above 25,000 → buy leg B (the ATM call). */
const S: StrategyDefinition = {
  ...strategy(
    [
      { id: 'A', kind: 'SPOT' },
      { id: 'B', kind: 'CE', strikeOffset: 0 },
    ],
    cond(field(legSeries('A')), 'CROSSED_ABOVE', num(25_000)),
  ),
  name: 'Spot crosses 25,000 → ATM call',
};

/** Below 25,000 until 10:00, then `level` from the 10:14 minute (the 10:00–10:15 candle closes there). */
const spotDay = (date: string, below: number, level: number) => dayMinutes(date, (t) => (t < '10:00' ? below : t < '10:14' ? below + 5 : level));
/** 100 until the 10:15 entry, then +0.5 a minute: 110 (the +10 % target) on the 10:34 minute. */
const risingAfterEntry = (date: string) => dayMinutes(date, (t) => (t < '10:15' ? 100 : 100 + 0.5 * (since(t, '10:15') + 1)));
const flat = (date: string, price = 100) => dayMinutes(date, () => price);

const contracts = [...upLadder(P, E0, 24_800, 25_300, 50, 75), ...upLadder(P, E1, 24_800, 25_300, 50, 75), ...upLadder(P, E2, 24_800, 25_300, 50, 65), ...upLadder(P, E3, 24_800, 25_300, 50, 65)];
const call = (expiry: string, strike: number): V2Instrument => contracts.find((c) => c.kind === 'CE' && c.expiry === expiry && c.strike === strike)!;
const uSpot = upSpot(P, 'NSE_INDEX|Nifty 50', 'NIFTY');

const plan = (patch: Partial<PaperPlan> = {}): PaperPlan => ({ ...defaultPaperPlan(S), slippagePct: 0, charges: false, targetPct: 10, stopPct: 5, rules: [{ group: null, leg: 'B', side: 'BUY' }], ...patch });

/** The parts of a trade that must match between two engines (ids, contract naming and unit keys differ). */
const money = (t: PaperTrade) => ({
  side: t.side,
  lots: t.lots,
  lotSize: t.lotSize,
  quantity: t.quantity,
  entryAt: t.entryAt,
  entryRef: t.entryRef,
  entryPrice: t.entryPrice,
  targetPrice: t.targetPrice,
  stopPrice: t.stopPrice,
  capitalUsed: t.capitalUsed,
  exitAt: t.exitAt,
  exitPrice: t.exitPrice,
  exitReason: t.exitReason,
  grossPnl: t.grossPnl,
  charges: t.charges,
  netPnl: t.netPnl,
  strike: t.instrument.strike,
  expiry: t.instrument.expiry,
});

async function setup(nowIso: { date: string; time: string }, history: FixtureHistory) {
  const clock = { now: ist(nowIso.date, nowIso.time) };
  const store = new MemoryV2Store(() => clock.now);
  const kSpot = spot(P, 'NIFTY 50');
  const kite = new FixtureV2Provider([kSpot, fut(P, E3), ...ladder(P, E1, 24_800, 25_300, 50).map((i) => ({ ...i, lotSize: 75 })), ...ladder(P, E2, 24_800, 25_300, 50).map((i) => ({ ...i, lotSize: 65 }))]);
  const connection: OptionsSourceStatus = { source: 'UPSTOX', configured: true, connected: true, userName: 'Trader', expiresAt: new Date(ist('2026-10-17', '03:30')).toISOString() };
  const logouts: number[] = [];
  const options = { history, status: async () => ({ ...connection }), logout: async () => void logouts.push(1) };
  const svc = new V2Service({ store, provider: kite, products: new ProductService(store, kite), channels: new RecordingChannels(), clock: () => clock.now, options });
  await svc.syncProducts();
  const s: V2Strategy = await svc.createStrategy(S);
  const run = (req: Partial<BacktestRequest>, def: V2Strategy = s) =>
    runOptionsBacktest({ store, history, now: () => clock.now }, def, { strategyId: def.id, products: [P], from: D1, to: D3, plan: plan(), capital: 500_000, ...req });
  return { clock, store, kite, kSpot, svc, s, run, connection, logouts };
}

describe('options backtest', () => {
  let history: FixtureHistory;

  beforeEach(() => {
    history = new FixtureHistory(uSpot, contracts, { lastDay: '2026-10-15' });
    history.add(uSpot, spotDay(D1, 24_990, 25_015)).add(uSpot, spotDay(D2, 24_980, 25_110)).add(uSpot, spotDay(D3, 24_980, 25_060));
    history.add(call(E1, 25_000), risingAfterEntry(D1)).add(call(E1, 25_100), risingAfterEntry(D2)).add(call(E2, 25_050), risingAfterEntry(D3));
  });

  it('re-picks each alert’s contract like the live scanner: that day’s expiry, the strike nearest the close, its own lot', async () => {
    const { run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    const r = await run({});
    expect(r.source).toBe('UPSTOX');
    expect(r.products[0]).toMatchObject({ productId: P, alerts: 3, trades: 3, skipped: 0, errors: [] });
    const trades = [...r.trades].sort((a, b) => a.entryAt.localeCompare(b.entryAt));
    // D1 25,015 → ATM 25,000 of E1 · D2 (E1's expiry day: still current) 25,110 → 25,100 of E1 · D3 25,060 → 25,050 of E2.
    expect(trades.map((t) => [t.instrument.expiry, t.instrument.strike, t.instrument.kind, t.lotSize])).toEqual([
      [E1, 25_000, 'CE', 75],
      [E1, 25_100, 'CE', 75],
      [E2, 25_050, 'CE', 65],
    ]);
    // Entry at the 10:15 close (the 10:14 minute's 100), target +10 % = 110 reached on the 10:34 minute.
    for (const [t, date, qty] of [
      [trades[0]!, D1, 75],
      [trades[1]!, D2, 75],
      [trades[2]!, D3, 65],
    ] as const) {
      expect(t).toMatchObject({ entryAt: new Date(ist(date, '10:15')).toISOString(), entryPrice: 100, targetPrice: 110, stopPrice: 95, exitReason: 'TARGET', exitPrice: 110, exitAt: new Date(ist(date, '10:35')).toISOString(), quantity: qty, lots: 1, grossPnl: 10 * qty, netPnl: 10 * qty, charges: 0 });
    }
    expect(r.summary.overall).toMatchObject({ trades: 3, wins: 3, netPnl: 750 + 750 + 650 });
    expect(r).toMatchObject({ finalCapital: 502_150, returnOnCapitalPct: 0.43 });
    expect(r.products[0]!.contracts).toContain('A · SPOT: NIFTY');
    // Every contract a candle read: also the mornings' ATM (E1 25,000 on 13 Oct, E2 25,000 on 14 Oct, before 10:00).
    expect(r.products[0]!.contracts.find((c) => c.startsWith('B ·'))).toMatch(/^B · CE ATM: 4 contracts over 2 expiries \(NIFTY 25000 CE 2026-10-13 … NIFTY 25050 CE 2026-10-20\)$/);
  });

  it('gives the same trades as the Backtest when the contract it picks is the one the Backtest fixes', async () => {
    // Today 13 Oct: the Backtest's contracts are today's (E1 still listed); the Options backtest's last day is 12 Oct.
    const { run, svc, s, kite, kSpot } = await setup({ date: D2, time: '09:00' }, history);
    const kCall = kite.instruments.find((i) => i.kind === 'CE' && i.expiry === E1 && i.strike === 25_000)!;
    kite.set(kSpot, '15m', aggregate(spotDay(D1, 24_990, 25_015), '15m', calendars([]).NSE));
    kite.set(kCall, '1m', risingAfterEntry(D1));
    for (const p of [plan(), plan({ charges: true, slippagePct: 0.5 }), plan({ targetPct: null, stopPct: null }), plan({ targetPct: null, stopPct: null, squareOff: false })]) {
      const req: BacktestRequest = { strategyId: s.id, products: [P], from: D1, to: D1, plan: p, capital: 500_000 };
      const [k, u] = await Promise.all([svc.backtest(req), run(req)]);
      expect(k.trades).toHaveLength(1);
      expect(u.trades.map(money)).toEqual(k.trades.map(money));
      expect({ final: u.finalCapital, ret: u.returnOnCapitalPct, low: u.lowestCapital, overall: u.summary.overall }).toEqual({ final: k.finalCapital, ret: k.returnOnCapitalPct, low: k.lowestCapital, overall: k.summary.overall });
    }
  });

  it('charges come from the contract (NFO option rates) and slippage moves both fills', async () => {
    const { run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    const r = await run({ from: D1, to: D1, plan: plan({ charges: true, slippagePct: 1, targetPct: null, stopPct: null }) });
    const [t] = r.trades;
    // Entry 100 + 1 % = 101 (ticks up); square-off at 15:20 at the last price 100 + 0.5 × 305 = 252.5 − 1 % = 249.975 → 249.95 (ticks down).
    expect(t).toMatchObject({ entryPrice: 101, exitReason: 'SQUARE_OFF', exitAt: new Date(ist(D1, '15:20')).toISOString(), exitPrice: 249.95, quantity: 75 });
    expect(t!.grossPnl).toBe(Math.round((249.95 - 101) * 75 * 100) / 100);
    const charges = roundTripCharges(call(E1, 25_000), 75, 101, 249.95);
    expect(charges).toBeGreaterThan(0);
    expect(t!.charges).toBe(charges);
    expect(t!.netPnl).toBe(Math.round((t!.grossPnl! - charges) * 100) / 100);
  });

  it('a positional trade runs to its contract’s expiry close, and the next day trades the next expiry', async () => {
    const { run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    history.add(call(E1, 25_000), dayMinutes(D2, (t) => (t < '12:00' ? 120 : 90))); // the held call on expiry day
    const r = await run({ plan: plan({ targetPct: null, stopPct: null, squareOff: false }) });
    const trades = [...r.trades].sort((a, b) => a.entryAt.localeCompare(b.entryAt));
    // D1's E1 call is held through D2 (its alert keeps the open position), closed at E1's close at its last price.
    expect(trades[0]).toMatchObject({ exitReason: 'EXPIRY', exitAt: new Date(ist(E1, '15:30')).toISOString(), exitPrice: 90, quantity: 75 });
    expect(trades[0]!.instrument.strike).toBe(25_000);
    expect(trades).toHaveLength(2);
    // D3: E2's 25,050 call, still open at the end of the test (14 Oct) → closed at its last price.
    expect(trades[1]).toMatchObject({ exitReason: 'END', exitPrice: 100 + 0.5 * (since('15:29', '10:15') + 1), quantity: 65 });
    expect(trades[1]!.instrument.expiry).toBe(E2);
  });

  it('a unit met for the first time takes its previous result from that unit, like the scanner (no alert while it stays true)', async () => {
    // One day: above 25,000 from 10:00 and climbing 10 an hour-quarter, so ATM walks up through several strikes.
    const climb = (t: string) => (t < '10:00' ? 24_990 : t < '10:14' ? 24_995 : 25_015 + 10 * Math.floor(Math.max(0, since(t, '10:14')) / 15));
    history = new FixtureHistory(uSpot, contracts, { lastDay: '2026-10-15' }).add(uSpot, dayMinutes(D1, climb));
    for (const c of contracts.filter((c) => c.expiry === E1 && c.kind === 'CE')) history.add(c, flat(D1));
    const { run, s, svc } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    const gt = await svc.createStrategy({ ...S, name: 'Spot above 25,000', expression: cond(field(legSeries('A')), 'GT', num(25_000)) });
    const onTransition = await run({ from: D1, to: D1 }, gt);
    expect(onTransition.products[0]!.alerts).toBe(1);
    const whileTrue = await run({ from: D1, to: D1, trigger: 'WHILE_TRUE', plan: plan({ targetPct: null, stopPct: null }) }, gt);
    // Every 15-minute close from 10:15 to 15:30 → 22 alerts, on calls walking from 25,000 up to 25,200 (25,015 → 25,225;
    // a close exactly between two strikes keeps the lower one, as the scanner's resolver does).
    expect(whileTrue.products[0]!.alerts).toBe(22);
    expect(whileTrue.products[0]!.contracts.find((c) => c.startsWith('B ·'))).toMatch(/^B · CE ATM: 5 contracts over 1 expiry \(NIFTY 25000 CE .* … NIFTY 25200 CE /);
    expect(s.id).not.toBe(gt.id);
  });

  it('exit rules read the legs the trade was opened with, not the ATM of later candles', async () => {
    // The spot climbs after entry (ATM moves to 25,100); the held 25,000 call falls below 99 at 11:00, the 25,100 call doesn't.
    const after = (t: string) => (t < '10:00' ? 24_990 : t < '10:14' ? 24_995 : t < '10:30' ? 25_015 : 25_110);
    history = new FixtureHistory(uSpot, contracts, { lastDay: '2026-10-15' }).add(uSpot, dayMinutes(D1, after));
    history.add(call(E1, 25_000), dayMinutes(D1, (t) => (t < '11:00' ? 100 : 98))).add(call(E1, 25_100), flat(D1, 100));
    const { run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    const exits = [{ group: null, when: cond(field(legSeries('B')), 'LT', num(99)) }];
    const r = await run({ from: D1, to: D1, plan: plan({ targetPct: null, stopPct: null }), exits });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ exitReason: 'EXIT_RULE', exitAt: new Date(ist(D1, '11:15')).toISOString(), exitPrice: 98 });
    expect(r.trades[0]!.instrument.strike).toBe(25_000);
    expect(r.notes.some((n) => /^Exit rule: .*on the legs the trade was opened with/.test(n))).toBe(true);
  });

  it('never tests days whose expiry schedule isn’t fully known (before the first known expiry, or a hole in the list)', async () => {
    const { run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    // A crossing on 6 Oct (E0's day — its predecessor is unknown) is not tested.
    history.add(uSpot, spotDay('2026-10-06', 24_990, 25_015));
    const r = await run({ from: '2026-10-05', to: D1 });
    expect(r.products[0]!.alerts).toBe(1); // D1 only
    expect(r.products[0]!.notes).toContain(`2 day(s) not tested (2026-10-05 … 2026-10-06): Upstox’s contract history is complete from 2026-10-07`);
    history.opts.gaps = [{ from: D2, to: D2 }];
    const gap = await run({});
    expect(gap.trades.map((t) => t.entryAt.slice(0, 10))).toEqual([D3, D1]);
  });

  it('ends on the last complete day and says so; no complete day at all is an error', async () => {
    const { run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    const r = await run({ to: '2026-10-16' });
    expect(r.to).toBe('2026-10-15');
    expect(r.notes[0]).toBe('Upstox serves complete past days only — the test ends on 2026-10-15.');
    await expect(run({ from: '2026-10-16', to: '2026-10-16' })).rejects.toThrow(/no complete day between 2026-10-16 and 2026-10-16/);
  });

  it('runs as a job through the service; refuses MCX, a missing setup and a missing login', async () => {
    const { svc, s, connection, logouts, store, kite, clock } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    expect(await svc.optionsStatus()).toMatchObject({ source: 'UPSTOX', configured: true, connected: true, userName: 'Trader' });
    const req: BacktestRequest = { strategyId: s.id, products: [P], from: D1, to: D3, plan: plan(), capital: 500_000 };
    const job = await svc.startOptionsBacktest(req);
    for (let i = 0; i < 100 && svc.optionsBacktestJob(job.id).status === 'RUNNING'; i++) await new Promise((r) => setTimeout(r, 5));
    const done = svc.optionsBacktestJob(job.id);
    expect(done.status).toBe('DONE');
    expect(done.result?.trades).toHaveLength(3);
    expect(svc.latestOptionsBacktestJob()?.id).toBe(job.id);
    expect(svc.latestBacktestJob()).toBeNull(); // the Kite backtest's jobs are separate

    connection.connected = false;
    connection.lastError = 'Upstox session expired (Upstox ends every login at 3:30 AM IST).';
    await expect(svc.startOptionsBacktest(req)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Upstox isn’t logged in.*3:30 AM IST\)\. Use “Connect Upstox”/) });

    await svc.optionsLogout();
    expect(logouts).toHaveLength(1);

    const bare = new V2Service({ store, provider: kite, products: new ProductService(store, kite), clock: () => clock.now });
    await expect(bare.startOptionsBacktest(req)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/UPSTOX_API_KEY/) });
    expect(await bare.optionsStatus()).toMatchObject({ configured: false, connected: false });
    await expect(bare.optionsLogout()).resolves.toEqual({ ok: true });
  });

  it('refuses MCX products (Upstox has no expired MCX contracts)', async () => {
    const clock = { now: ist('2026-10-16', '09:00') };
    const store = new MemoryV2Store(() => clock.now);
    const gold = fut('MCX:GOLD', '2026-12-04', 'MCX');
    const kite = new FixtureV2Provider([spot(P, 'NIFTY 50'), gold]);
    const svc = new V2Service({ store, provider: kite, products: new ProductService(store, kite), clock: () => clock.now, options: { history, status: async () => ({ source: 'UPSTOX' as const, configured: true, connected: true }), logout: async () => undefined } });
    await svc.syncProducts();
    const s = await svc.createStrategy(S);
    await expect(svc.startOptionsBacktest({ strategyId: s.id, products: ['MCX:GOLD'], from: D1, to: D3, plan: plan(), capital: null })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/no expired MCX contracts — remove GOLD/) });
  });
});
