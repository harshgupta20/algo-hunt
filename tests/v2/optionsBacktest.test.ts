/**
 * The re-picking backtest (what Futures & Options → Backtest runs for NSE / BSE contracts): contracts as they were
 * listed (expired ones included), re-picked at every trigger candle the way the live scanner picks them — the expiry
 * of that day, the strike nearest the index's close, each contract's own lot size — then traded by the same
 * simulator as the Kite-only backtest. Routed through the service: the index from Kite, every contract from Upstox,
 * MCX and no-Upstox on Kite alone, Kite vs Upstox checked.
 *
 * Fixture week (NIFTY, weekly expiries on Tuesdays): E0 6 Oct, E1 13 Oct, E2 20 Oct, E3 27 Oct; lots 75 (E0, E1)
 * and 65 (E2, E3). The strategy: spot's 15-minute close crosses above 25,000 → buy the ATM call. Each test day the
 * spot sits below 25,000 until 10:00 and the 10:00–10:15 candle closes above it, at a different level per day.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { BacktestRequest, OptionsSourceStatus, PaperPlan, PaperTrade, StrategyDefinition, V2Instrument, V2Strategy } from '../../src/shared/v2';
import { backtestRequestSchema, defaultPaperPlan } from '../../src/shared/v2';
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
    runOptionsBacktest({ store, history, now: () => clock.now }, def, { strategyId: def.id, products: [P], from: D1, to: D3, plan: plan(), ...req });
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
    expect(r.source).toBe('SPLIT');
    expect(r.products[0]).toMatchObject({ productId: P, data: 'SPLIT', alerts: 3, trades: 3, skipped: 0, errors: [] });
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
    expect(r.products[0]!.contracts).toContain('A · SPOT: NIFTY');
    // Every contract a candle read: also the mornings' ATM (E1 25,000 on 13 Oct, E2 25,000 on 14 Oct, before 10:00).
    expect(r.products[0]!.contracts.find((c) => c.startsWith('B ·'))).toMatch(/^B · CE ATM: 4 contracts over 2 expiries \(NIFTY 25000 CE 2026-10-13 … NIFTY 25050 CE 2026-10-20\)$/);
  });

  it('gives the same trades as the Backtest when the contract it picks is the one the Backtest fixes', async () => {
    // Today 13 Oct: the Backtest's contracts are today's (E1 still listed); the Options backtest's last day is 12 Oct.
    const { run, s, kite, kSpot, store, clock } = await setup({ date: D2, time: '09:00' }, history);
    // Kite alone: a service without Upstox runs every product on Kite's contracts.
    const svc = new V2Service({ store, provider: kite, products: new ProductService(store, kite), clock: () => clock.now });
    const kCall = kite.instruments.find((i) => i.kind === 'CE' && i.expiry === E1 && i.strike === 25_000)!;
    kite.set(kSpot, '15m', aggregate(spotDay(D1, 24_990, 25_015), '15m', calendars([]).NSE));
    kite.set(kCall, '1m', risingAfterEntry(D1));
    const sizes: PaperPlan[] = [
      plan(),
      plan({ charges: true, slippagePct: 0.5 }),
      plan({ targetPct: null, stopPct: null }),
      plan({ targetPct: null, stopPct: null, squareOff: false }),
      plan({ charges: true, lotsPerTrade: 4 }),
      plan({ trailing: true, rules: [{ group: null, leg: 'B', side: 'BUY', stopWhen: cond(field(legSeries('B')), 'LT', num(1)) }] }),
    ];
    for (const p of sizes) {
      const req: BacktestRequest = { strategyId: s.id, products: [P], from: D1, to: D1, plan: p };
      const [k, u] = await Promise.all([svc.backtest(req), run(req)]);
      expect(k.trades).toHaveLength(1);
      expect(u.trades.map(money)).toEqual(k.trades.map(money));
      expect(u.summary.overall).toEqual(k.summary.overall);
    }
  });

  it('sizes every trade in the plan’s lots, at its own contract’s lot size — no account limit', async () => {
    const { run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    const r = await run({ plan: plan({ lotsPerTrade: 3, cashPerTrade: 100 }) });
    const trades = [...r.trades].sort((a, b) => a.entryAt.localeCompare(b.entryAt));
    // 3 lots: 225 of each E1 call (lot 75), 195 of the E2 call (lot 65); entry 100, target 110.
    expect(trades.map((t) => [t.lots, t.lotSize, t.quantity, t.capitalUsed, t.grossPnl, t.overBudget])).toEqual([
      [3, 75, 225, 22_500, 2_250, false],
      [3, 75, 225, 22_500, 2_250, false],
      [3, 65, 195, 19_500, 1_950, false],
    ]);
    expect(r.notes).toContain('Futures and options: 3 lots per trade, at each contract’s own lot size.');
    expect(r.skipped).toEqual([]);
    // The default plan: 1 lot.
    expect((await run({})).trades.every((t) => t.lots === 1)).toBe(true);
    // Whole lots only, 1–1,000; a plan saved before lots existed gets 1.
    const base = { strategyId: 'x', products: [P], from: D1, to: D3, plan: plan() };
    expect(backtestRequestSchema.safeParse({ ...base, plan: plan({ lotsPerTrade: 2 }) }).success).toBe(true);
    for (const bad of [0, 1.5, -1, 1_001]) expect(backtestRequestSchema.safeParse({ ...base, plan: plan({ lotsPerTrade: bad }) }).success).toBe(false);
    const { lotsPerTrade: _l, ...old } = plan();
    const parsed = backtestRequestSchema.safeParse({ ...base, plan: old });
    expect(parsed.success && parsed.data.plan.lotsPerTrade).toBe(1);
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

  it('trailing rules read the legs the trade was opened with, not the ATM of later candles', async () => {
    // The spot climbs after entry (ATM moves to 25,100); the held 25,000 call reaches its target (101) at 10:30 —
    // trailing starts — and falls below 99 at 11:00; the 25,100 call doesn't.
    const after = (t: string) => (t < '10:00' ? 24_990 : t < '10:14' ? 24_995 : t < '10:30' ? 25_015 : 25_110);
    history = new FixtureHistory(uSpot, contracts, { lastDay: '2026-10-15' }).add(uSpot, dayMinutes(D1, after));
    history.add(call(E1, 25_000), dayMinutes(D1, (t) => (t < '10:30' ? 100 : t < '11:00' ? 102 : 98))).add(call(E1, 25_100), flat(D1, 100));
    const { run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    const rules = [{ group: null, leg: 'B' as const, side: 'BUY' as const, stopWhen: cond(field(legSeries('B')), 'LT', num(99)) }];
    const r = await run({ from: D1, to: D1, plan: plan({ trailing: true, targetPct: 1, stopPct: null, rules }) });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ exitReason: 'STOP_RULE', exitAt: new Date(ist(D1, '11:15')).toISOString(), exitPrice: 98 });
    expect(r.trades[0]!.instrument.strike).toBe(25_000);
    expect(r.notes.some((n) => /^Trailing rules: .*on the legs the trade was opened with/.test(n))).toBe(true);
  });

  it('watch window: an alert candle outside it opens nothing', async () => {
    const { run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    // The alerts are on the 10:00–10:15 candles: a window from 10:15 misses them all.
    const r = await run({ plan: plan({ watch: true, watchNseFrom: '10:15', watchNseTo: '15:00' }) });
    expect(r.products[0]).toMatchObject({ alerts: 0, trades: 0 });
    expect(r.notes).toContain('Watched only 10:15–15:00: trigger candles outside it sent no alert and opened no trade.');
    expect((await run({ plan: plan({ watch: true, watchNseFrom: '09:15', watchNseTo: '10:15' }) })).products[0]).toMatchObject({ alerts: 3 });
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

  /** The Kite side of a routed run: Kite's index candles (minutes + the 15-minute trigger) for the test days. */
  const kiteSpotDays = (kite: FixtureV2Provider, kSpot: V2Instrument, days: Array<ReturnType<typeof spotDay>>) => {
    const minutes = days.flat();
    kite.set(kSpot, '1m', minutes).set(kSpot, '15m', aggregate(minutes, '15m', calendars([]).NSE));
  };

  it('routed: the index from Kite, every contract from Upstox — the same trades, labelled per product, checked', async () => {
    const { svc, s, kite, kSpot, run } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    kiteSpotDays(kite, kSpot, [spotDay(D1, 24_990, 25_015), spotDay(D2, 24_980, 25_110), spotDay(D3, 24_980, 25_060)]);
    // A contract both list (E2 25,050 CE, traded on D3): Kite's minutes equal Upstox's.
    const kCall = kite.instruments.find((i) => i.kind === 'CE' && i.expiry === E2 && i.strike === 25_050)!;
    kite.set(kCall, '1m', risingAfterEntry(D3));
    const req: BacktestRequest = { strategyId: s.id, products: [P], from: D1, to: D3, plan: plan() };
    const job = await svc.startBacktest(req);
    for (let i = 0; i < 200 && svc.backtestJob(job.id).status === 'RUNNING'; i++) await new Promise((r) => setTimeout(r, 5));
    const r = svc.backtestJob(job.id).result!;
    expect(r.source).toBe('SPLIT');
    expect(r.products[0]).toMatchObject({ productId: P, data: 'SPLIT', trades: 3 });
    expect(r.trades.map(money)).toEqual((await run({})).trades.map(money));
    expect(r.notes.join(' ')).toContain('The index / stock from Kite; every contract from Upstox');
    // ATM and the spot leg read Kite's candles; Upstox's index is read only to check it against Kite's.
    expect(r.products[0]!.contracts).toContain('A · SPOT: NIFTY 50');
    expect(r.checks).toEqual([
      expect.objectContaining({ productId: P, what: 'NIFTY 50 (index / stock), 15-minute closes', from: D1, to: D3, matched: 75, medianDiffPct: 0, withinTickPct: 100, ok: true }),
      expect.objectContaining({ productId: P, what: `${kCall.symbol} (contract), 1-minute closes`, matched: 375, ok: true }),
    ]);
  });

  it('routed: the strike is decided on Kite’s index price, and a gap between the sources is flagged', async () => {
    const { svc, s, kite, kSpot } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    // D1: Kite’s index closes the 10:00 candle at 25,060 (Upstox’s at 25,015) → ATM 25,050, not 25,000.
    kiteSpotDays(kite, kSpot, [spotDay(D1, 24_990, 25_060), spotDay(D2, 24_980, 25_110), spotDay(D3, 24_980, 25_060)]);
    history.add(call(E1, 25_050), risingAfterEntry(D1));
    const r = await svc.backtest({ strategyId: s.id, products: [P], from: D1, to: D3, plan: plan() });
    const first = [...r.trades].sort((a, b) => a.entryAt.localeCompare(b.entryAt))[0]!;
    expect([first.instrument.expiry, first.instrument.strike, first.instrument.id.startsWith('U:')]).toEqual([E1, 25_050, true]);
    expect(r.checks![0]).toMatchObject({ what: 'NIFTY 50 (index / stock), 15-minute closes', ok: false });
    expect(r.notes.join(' ')).toContain('Kite and Upstox disagree on some candles');
  });

  it('routed: a missing Kite candle stays a gap — never filled from Upstox', async () => {
    const { svc, s, kite, kSpot } = await setup({ date: '2026-10-16', time: '09:00' }, history);
    // Kite has only D2 and D3: D1's trigger candle has no Kite price → no ATM that day (Upstox's index isn't used).
    kiteSpotDays(kite, kSpot, [spotDay(D2, 24_980, 25_110), spotDay(D3, 24_980, 25_060)]);
    const r = await svc.backtest({ strategyId: s.id, products: [P], from: D1, to: D3, plan: plan() });
    expect(r.trades.map((t) => t.entryAt.slice(0, 10)).sort()).toEqual([D2, D3]);
    expect(r.products[0]!.notes.join(' ')).toMatch(/candle\(s\) not evaluated: No NIFTY 50 candle for the trigger candle itself — ATM unknown/);
  });

  it('routed: MCX runs on Kite in the same backtest; without an Upstox login NSE does too — and both say so', async () => {
    const clock = { now: ist('2026-10-16', '09:00') };
    const store = new MemoryV2Store(() => clock.now);
    const kSpot = spot(P, 'NIFTY 50');
    const gold = fut('MCX:GOLD', '2026-12-04', 'MCX');
    const kite = new FixtureV2Provider([kSpot, gold, ...ladder(P, E2, 24_800, 25_300, 50).map((i) => ({ ...i, lotSize: 65 }))]);
    const connection: OptionsSourceStatus = { source: 'UPSTOX', configured: true, connected: true };
    const svc = new V2Service({ store, provider: kite, products: new ProductService(store, kite), clock: () => clock.now, options: { history, status: async () => ({ ...connection }), logout: async () => undefined } });
    await svc.syncProducts();
    const sGold = await svc.createStrategy({ ...strategy([{ id: 'A', kind: 'SPOT' }, { id: 'B', kind: 'FUT' }], cond(field(legSeries('A')), 'CROSSED_ABOVE', num(25_000))), name: 'Futures' });
    kiteSpotDays(kite, kSpot, [spotDay(D1, 24_990, 25_015)]);

    const route = await svc.backtestRoute(sGold, [P, 'MCX:GOLD']);
    expect(route).toMatchObject({ split: [P], kite: ['MCX:GOLD'] });
    expect(route.notes[0]).toMatch(/^GOLD: Kite only — Upstox has no MCX contracts/);
    const r = await svc.backtest({ strategyId: sGold.id, products: [P, 'MCX:GOLD'], from: D1, to: D1, plan: plan({ rules: [{ group: null, leg: 'B', side: 'BUY' }] }) });
    expect(r.source).toBe('MIXED');
    expect(Object.fromEntries(r.products.map((p) => [p.productId, p.data]))).toEqual({ [P]: 'SPLIT', 'MCX:GOLD': 'KITE' });

    connection.connected = false;
    connection.lastError = 'Upstox session expired';
    const off = await svc.backtestRoute(sGold, [P]);
    expect(off).toMatchObject({ split: [], kite: [P] });
    expect(off.notes[0]).toMatch(/^NIFTY: Kite only — Upstox isn’t logged in \(Upstox session expired\)\. So today’s contracts/);

    const bare = new V2Service({ store, provider: kite, products: new ProductService(store, kite), clock: () => clock.now });
    expect((await bare.backtestRoute(sGold, [P])).notes[0]).toMatch(/Upstox isn’t set up on this server/);
    expect(await bare.optionsStatus()).toMatchObject({ configured: false, connected: false });
    await expect(bare.optionsLogout()).resolves.toEqual({ ok: true });

    // A strategy reading no contracts never asks Upstox.
    const spotOnly = await svc.createStrategy({ ...strategy([{ id: 'A', kind: 'SPOT' }], cond(field(legSeries('A')), 'GT', num(1))), name: 'Spot only' });
    expect(await svc.backtestRoute(spotOnly, [P, 'MCX:GOLD'])).toMatchObject({ split: [], kite: [P, 'MCX:GOLD'], notes: [] });
  });
});
