/**
 * Backtest: the strategy's past alerts (as Compare finds them) traded like paper trades with the plan — futures /
 * options in lots, no account limit — exits found on the contract's 1-minute candles (target, stop-loss, trailing
 * stop, trailing rules, square-off, end of test; with Trailing SL the target starts it instead of closing); nothing
 * alerts outside the watch window. Every trade carries its price path (its story).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PaperPlan, PaperRule, StrategyDefinition } from '../../src/shared/v2';
import { backtestRequestSchema, defaultPaperPlan, normalizePlan, tradeStory } from '../../src/shared/v2';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { RuntimeV2Store, createRuntimeState } from '../../src/server/v2/persistence/RuntimeV2Store';
import type { RawCandle } from '../../src/server/v2/engine/candles';
import { roundTripCharges } from '../../src/server/v2/paper/charges';
import { V2Service } from '../../src/server/v2/V2Service';
import { FixtureV2Provider, MemoryV2Store, NSE_SESSION, RecordingChannels, and, candlesAt, cond, field, fut, ind, ist, legSeries, num, spot, strategy, timesEndingAt } from '../helpers/v2Fakes';
import { indicatorValues } from '../../src/server/v2/engine/indicators';
import type { V2Store } from '../../src/server/v2/persistence/V2Store';

const D = '2026-10-07';
const niftySpot = spot('NSE:NIFTY', 'NIFTY 50');
const niftyFut = { ...fut('NSE:NIFTY', '2026-10-27'), lotSize: 75 };

/** Future's 15-min close crosses above 25,100 on the 09:45–10:00 candle. */
const S: StrategyDefinition = { ...strategy([{ id: 'A', kind: 'FUT' }], cond(field(legSeries('A')), 'CROSSED_ABOVE', num(25_100))), name: 'Future breaks 25,100' };

/** Minutes from 10:00: each closes 10 higher, opening at the previous close. */
function risingMinutes(count: number, start = 25_120, step = 10): RawCandle[] {
  return Array.from({ length: count }, (_, j) => {
    const open = start + step * j;
    const close = open + step;
    return { time: Math.floor((ist(D, '10:00') + j * 60_000) / 1000), open, high: Math.max(open, close) + 2, low: Math.min(open, close) - 2, close, volume: 10 };
  });
}

describe('backtest', () => {
  let svc: V2Service;
  let provider: FixtureV2Provider;
  let strategyId: string;

  beforeEach(async () => {
    const clock = { now: ist('2026-10-08', '09:00') };
    const store = new MemoryV2Store(() => clock.now);
    provider = new FixtureV2Provider([niftySpot, niftyFut]);
    const times = timesEndingAt(ist(D, '15:15'), 15, 60, NSE_SESSION);
    const cross = times.indexOf(ist(D, '09:45'));
    provider.set(niftyFut, '15m', candlesAt(times, times.map((_, i) => (i < cross ? 25_080 : 25_120 + (i - cross)))));
    svc = new V2Service({ store, provider, products: new ProductService(store, provider), channels: new RecordingChannels(), clock: () => clock.now });
    await svc.syncProducts();
    strategyId = (await svc.createStrategy(S)).id;
  });

  const plan = (patch: Partial<PaperPlan>): PaperPlan => ({ ...defaultPaperPlan(S), slippagePct: 0, targetPct: 1, stopPct: 0.5, ...patch });
  const run = (p: Partial<PaperPlan>) => svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: plan(p) });
  /** The whole strategy's rule with trailing rules (Trailing SL on). */
  const withConditions = (c: Pick<PaperRule, 'stopWhen'>, p: Partial<PaperPlan> = {}): PaperPlan => plan({ trailing: true, ...p, rules: [{ group: null, leg: 'A', side: 'BUY', ...c }] });

  it('enters at the alert candle’s close and exits at the target found in 1-minute candles', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    const r = await run({});
    expect(r.products[0]).toMatchObject({ productId: 'NSE:NIFTY', alerts: 1, trades: 1, skipped: 0 });
    const [t] = r.trades;
    // The plan's 1 lot of 75 (futures are sized in lots — never over budget; estimated margin ₹2,26,080), target +1 %, stop −0.5 %.
    expect(t).toMatchObject({ side: 'BUY', lots: 1, quantity: 75, entryPrice: 25_120, targetPrice: 25_371.2, stopPrice: 24_994.4, overBudget: false, marginEstimated: true, capitalUsed: 226_080 });
    expect(t!.entryAt).toBe(new Date(ist(D, '10:00')).toISOString());
    // The 10:24 minute's high (25,372) reaches the target.
    expect(t).toMatchObject({ exitReason: 'TARGET', exitPrice: 25_371.2, exitAt: new Date(ist(D, '10:25')).toISOString(), grossPnl: 18_840 });
    const charges = roundTripCharges(niftyFut, 75, 25_120, 25_371.2);
    expect(t!.netPnl).toBeCloseTo(18_840 - charges, 2);
    // Return on the money the trades needed (no starting capital, like paper trading).
    expect(r.summary.overall).toMatchObject({ trades: 1, wins: 1, capitalPeak: 226_080 });
    expect(r.summary.overall.returnPct).toBeCloseTo(((18_840 - charges) / 226_080) * 100, 1);
    expect(r).not.toHaveProperty('capital');
    expect(r.summary.reasons).toEqual([{ reason: 'TARGET', trades: 1, pnl: t!.netPnl }]);
  });

  it('a stop-loss in the same minute as the target wins; a gap through the stop fills at the open', async () => {
    const m = risingMinutes(3);
    m[1] = { ...m[1]!, open: 24_900, high: 25_500, low: 24_850, close: 25_000 }; // gaps below the stop, spikes above the target
    provider.set(niftyFut, '1m', m);
    const [t] = (await run({})).trades;
    expect(t).toMatchObject({ exitReason: 'STOP', exitPrice: 24_900 });
  });

  it('futures trade the plan’s lots per trade, whatever they cost (no account limit)', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    const r = await run({ lotsPerTrade: 2, cashPerTrade: 100 });
    expect(r.skipped).toEqual([]);
    expect(r.trades[0]).toMatchObject({ lots: 2, quantity: 150, capitalUsed: 452_160, overBudget: false, exitReason: 'TARGET', grossPnl: 37_680 });
    expect(r.notes).toContain('Futures and options: 2 lots per trade, at each contract’s own lot size.');
  });

  it('Trailing SL: the target doesn’t close the trade; from there the stop-loss no longer applies', async () => {
    // Up through the target (25,371.2, in the 10:24 minute) to a high of 25,422, then a fall to 24,950 at 10:30 —
    // below the 0.5 % stop-loss (24,994.4), which no longer applies; the trailing rule never comes true here.
    const fall = { time: Math.floor(ist(D, '10:30') / 1000), open: 25_420, high: 25_425, low: 24_950, close: 24_960, volume: 10 };
    provider.set(niftyFut, '1m', [...risingMinutes(30), fall]);
    const never = cond(field(legSeries('A')), 'LT', num(20_000));
    const r = await svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: withConditions({ stopWhen: never }) });
    expect(r.trades[0]).toMatchObject({ exitReason: 'SQUARE_OFF', exitPrice: 24_960, trailingAt: new Date(ist(D, '10:24')).toISOString() });
    // Trailing SL off: a normal trade — closed at the target.
    expect((await run({ trailing: false })).trades[0]).toMatchObject({ exitReason: 'TARGET', exitAt: new Date(ist(D, '10:25')).toISOString() });
  });

  it('Trailing SL needs a target to start at and a trailing rule to trail by', async () => {
    provider.set(niftyFut, '1m', risingMinutes(10));
    const rule = cond(field(legSeries('A')), 'LT', num(20_000));
    await expect(svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: withConditions({ stopWhen: rule }, { targetPct: null }) })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/set a target/) });
    await expect(run({ trailing: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/needs at least one trailing rule/) });
    await expect(svc.savePaperPlan(strategyId, plan({ trailing: true }))).rejects.toMatchObject({ status: 400 });
  });

  it('every trade carries its price path: the story shows the target starting the trailing rules', async () => {
    provider.set(niftyFut, '1m', risingMinutes(60));
    // The target is reached at 10:24; the rule (15-minute close above 25,122) first comes true at the 10:45 close.
    const above = cond(field(legSeries('A')), 'GT', num(25_122));
    const [t] = (await svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: withConditions({ stopWhen: above }) })).trades;
    expect(t).toMatchObject({ exitReason: 'STOP_RULE', exitAt: new Date(ist(D, '10:45')).toISOString() });
    // 45 minutes held (10:00–10:44) in 1-minute bars, then 12 bars after the exit.
    expect(t!.path).toMatchObject({ step: 1, held: 45 });
    expect(t!.path!.bars).toHaveLength(57);
    expect(t!.path!.bars[0]).toEqual([ist(D, '10:00') / 1000, 25_120, 25_132, 25_118, 25_130]);
    const story = tradeStory(t!, t!.path!);
    expect(story.trailingFrom).toEqual({ at: ist(D, '10:24'), bar: 24 });
    // The stop-loss until the target; none after it — the trailing rule closes the trade.
    expect(story.bars[24]!.stop).toEqual({ price: 24_994.4, reason: 'STOP' });
    expect(story.bars[25]!.stop).toBeNull();
    expect(story.finalStop).toBeNull();
    expect(story.best).toMatchObject({ price: 25_572, at: ist(D, '10:44') });
    expect(story.after).toMatchObject({ minutes: 12, high: 25_692, low: 25_568 });
  });

  it('watch window: a trigger candle that doesn’t lie inside sends no alert and opens no trade', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    // The 09:45–10:00 candle crosses: it closes after 09:45, so a window ending 09:45 misses it.
    const out = await run({ watch: true, watchNseFrom: '09:15', watchNseTo: '09:45' });
    expect(out.products[0]).toMatchObject({ alerts: 0, trades: 0 });
    expect(out.notes).toContain('Watched only 09:15–09:45: trigger candles outside it sent no alert and opened no trade.');
    const inside = await run({ watch: true, watchNseFrom: '09:45', watchNseTo: '10:00' });
    expect(inside.products[0]).toMatchObject({ alerts: 1, trades: 1 });
    // An ON_TRANSITION cross outside the window isn't alerted later just because the window opens.
    const late = await run({ watch: true, watchNseFrom: '10:00', watchNseTo: '15:00' });
    expect(late.products[0]).toMatchObject({ alerts: 0 });
    await expect(run({ watch: true, watchNseFrom: '15:00', watchNseTo: '10:00' })).rejects.toThrow();
  });

  it('squares off at 15:20 at the last price; positional trades run to the end of the test', async () => {
    provider.set(niftyFut, '1m', risingMinutes(10, 25_120, 1)); // drifts to 25,130 by 10:10
    const intraday = (await run({ targetPct: null, stopPct: null })).trades[0];
    expect(intraday).toMatchObject({ exitReason: 'SQUARE_OFF', exitPrice: 25_130, exitAt: new Date(ist(D, '15:20')).toISOString(), grossPnl: 750 });
    const positional = (await run({ targetPct: null, stopPct: null, squareOff: false })).trades[0];
    expect(positional).toMatchObject({ exitReason: 'END', exitPrice: 25_130, exitAt: new Date(ist(D, '10:10')).toISOString() });
  });

  it('needs a Kite login — says so instead of an empty result (Compare too)', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    provider.connected = false;
    await expect(run({})).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Kite isn’t logged in.*Log in to Kite/) });
    await expect(svc.compare({ strategyId, products: ['NSE:NIFTY'], from: D, to: D })).rejects.toMatchObject({ status: 409 });
  });

  it('daily candles close after the square-off: says why nothing traded; positional settings trade', async () => {
    const daily: StrategyDefinition = { ...strategy([{ id: 'A', kind: 'FUT' }], cond(field(legSeries('A', '1d')), 'CROSSED_ABOVE', num(25_100))), name: 'Daily close above 25,100' };
    daily.evaluation = { mode: 'COMPLETED_CANDLE', triggerTimeframe: '1d' };
    const id = (await svc.createStrategy(daily)).id;
    // Closes above 25,100 on Tuesday 6 Oct; Wednesday morning's minutes rise through the target.
    const dayTimes = ['2026-10-02', '2026-10-05', '2026-10-06'].map((d) => ist(d, '00:00'));
    provider.set(niftyFut, '1d', candlesAt(dayTimes, [25_050, 25_080, 25_150]));
    provider.set(niftyFut, '1m', risingMinutes(40));
    const p = { ...defaultPaperPlan(daily), slippagePct: 0, targetPct: 1, stopPct: 0.5 };
    const intraday = await svc.backtest({ strategyId: id, products: ['NSE:NIFTY'], from: '2026-10-02', to: '2026-10-07', plan: p });
    expect(intraday.trades).toEqual([]);
    expect(intraday.skipped[0]?.reason).toMatch(/After the 15:20 square-off — switch “Square off daily” off/);
    expect(intraday.notes[0]).toMatch(/Daily \/ weekly candles close after the day’s square-off time/);
    const positional = await svc.backtest({ strategyId: id, products: ['NSE:NIFTY'], from: '2026-10-02', to: '2026-10-07', plan: { ...p, squareOff: false } });
    expect(positional.trades).toHaveLength(1);
    expect(positional.trades[0]).toMatchObject({ entryPrice: 25_150, exitReason: 'TARGET' }); // held overnight, the target met the next morning
    expect(positional.notes.join(' ')).not.toMatch(/square-off time/);
  });

  it('runs the same through the app’s memory layer (as in the running app)', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    const clock = { now: ist('2026-10-08', '09:00') };
    const store: V2Store = new RuntimeV2Store(new MemoryV2Store(() => clock.now), () => clock.now, createRuntimeState());
    const app = new V2Service({ store, provider, products: new ProductService(store, provider), channels: new RecordingChannels(), clock: () => clock.now });
    await app.syncProducts();
    const id = (await app.createStrategy(S)).id;
    const r = await app.backtest({ strategyId: id, products: ['NSE:NIFTY'], from: D, to: D, plan: plan({}) });
    expect(r.trades[0]).toMatchObject({ exitReason: 'TARGET', exitPrice: 25_371.2, grossPnl: 18_840 });
  });

  it('trailing rules: after the target, at the first candle close where they are true', async () => {
    provider.set(niftyFut, '1m', risingMinutes(60));
    // Entered at 10:00 (close 25,120), the target reached at 10:24; 15-minute closes rise by 1 → above 25,122 first on the 10:30–10:45 candle.
    const above = cond(field(legSeries('A')), 'GT', num(25_122));
    const bt = (p: PaperPlan) => svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: p });
    const r = await bt(withConditions({ stopWhen: above }, { stopPct: null }));
    expect(r.trades[0]).toMatchObject({ exitReason: 'STOP_RULE', exitAt: new Date(ist(D, '10:45')).toISOString(), exitPrice: 25_570 }); // the 10:44 minute's close
    expect(r.notes.some((n) => /^Trailing rules: .*checked from the target on, at each 15m candle close/.test(n))).toBe(true);
    // Several conditions: AND needs both — never true here, so the trade runs to the square-off.
    const r2 = await bt(withConditions({ stopWhen: and(above, cond(field(legSeries('A')), 'LT', num(25_000))) }, { stopPct: null }));
    expect(r2.trades[0]).toMatchObject({ exitReason: 'SQUARE_OFF' });
  });

  it('with a target, trailing rules start there: the target doesn’t close the trade, earlier closes are ignored', async () => {
    provider.set(niftyFut, '1m', risingMinutes(60));
    // True from the 10:00–10:15 close (25,121) on; the target 25,371.2 is reached in the 10:24 minute.
    const early = cond(field(legSeries('A')), 'GT', num(25_120));
    const bt = (p: PaperPlan) => svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: p });
    // Trailing SL off: the rules are kept in the plan but ignored — the target closes the trade.
    expect((await bt(withConditions({ stopWhen: early }, { trailing: false }))).trades[0]).toMatchObject({ exitReason: 'TARGET', exitAt: new Date(ist(D, '10:25')).toISOString() });
    const r = await bt(withConditions({ stopWhen: early }));
    // The 10:15 close came before the target; the 10:30 close is the first after it — at the 10:29 minute's close.
    expect(r.trades[0]).toMatchObject({ exitReason: 'STOP_RULE', exitAt: new Date(ist(D, '10:30')).toISOString(), exitPrice: 25_420, trailingAt: new Date(ist(D, '10:24')).toISOString() });
    expect(r.notes).toContain('Trailing SL on: trades don’t close at the target — reaching it starts the trailing rules, and from there the stop-loss and target no longer apply.');
  });

  it('target conditions were removed: an old plan’s are dropped, its target closes the trade again', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    const old = { ...plan({}), rules: [{ group: null, leg: 'A', side: 'BUY', targetWhen: cond(field(legSeries('A')), 'GT', num(25_120)) } as PaperRule] };
    expect(normalizePlan(old).rules[0]).toEqual({ group: null, leg: 'A', side: 'BUY' });
    const r = await svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: old });
    expect(r.trades[0]).toMatchObject({ exitReason: 'TARGET', exitAt: new Date(ist(D, '10:25')).toISOString() });
  });

  it('trailing rules are checked like the strategy’s own conditions (backtest and saving the plan)', async () => {
    const bad = withConditions({ stopWhen: cond(field(legSeries('D')), 'GT', num(1)) });
    await expect(svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: bad })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^Trailing rules: /) });
    await expect(svc.savePaperPlan(strategyId, bad)).rejects.toMatchObject({ status: 400 });
  });

  it('N-candle low / high: the previous N candles, not the current one', () => {
    const c = (low: number, high: number) => ({ time: 0, open: low, high, low, close: low, volume: 0 });
    const candles = [c(10, 20), c(8, 22), c(9, 19), c(7, 25), c(12, 18)];
    const range = (output: 'low' | 'high') => indicatorValues(candles as never, { ...(ind(legSeries('A'), 'RANGE', { period: 3 }) as Parameters<typeof indicatorValues>[1]), output });
    expect(range('low')).toEqual([undefined, undefined, undefined, 8, 7]);
    expect(range('high')).toEqual([undefined, undefined, undefined, 22, 25]);
  });

  /** Poll a backtest job until it stops running. */
  const settled = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const job = svc.backtestJob(id);
      if (job.status !== 'RUNNING') return job;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('backtest job did not finish');
  };
  const jobRequest = () => ({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: plan({}) });

  it('runs as a background job: progress, the same result, and a re-run answered from memory', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    const job = await svc.startBacktest(jobRequest());
    expect(job).toMatchObject({ status: 'RUNNING', total: 1, strategyName: 'Future breaks 25,100' });
    const done = await settled(job.id);
    expect(done).toMatchObject({ status: 'DONE', phase: 'TRADES', done: 1, total: 1, cached: 0, error: null });
    expect(done.result!.trades[0]).toMatchObject({ exitReason: 'TARGET', grossPnl: 18_840 });
    expect(done.result!.requests).toBe(done.fetched);
    expect(svc.latestBacktestJob()?.id).toBe(job.id);
    // Another target on the same candles: nothing asked of Kite.
    const before = provider.calls.historical;
    const again = await settled((await svc.startBacktest({ ...jobRequest(), plan: plan({ targetPct: 2 }) })).id);
    expect(provider.calls.historical).toBe(before);
    expect(again).toMatchObject({ status: 'DONE', fetched: 0 });
    expect(again.cached).toBe(done.fetched);
    expect(again.result!.requests).toBe(0);
  });

  it('a job can be cancelled, and starting another cancels the one running', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    const fetch = provider.getHistoricalCandles.bind(provider);
    provider.getHistoricalCandles = async (q) => (await new Promise((r) => setTimeout(r, 20)), fetch(q));
    const first = await svc.startBacktest(jobRequest());
    const second = await svc.startBacktest(jobRequest());
    expect(await settled(first.id)).toMatchObject({ status: 'CANCELLED', result: undefined });
    expect(await settled(second.id)).toMatchObject({ status: 'DONE' });
    const third = await svc.startBacktest(jobRequest());
    svc.cancelBacktest(third.id);
    expect(await settled(third.id)).toMatchObject({ status: 'CANCELLED' });
    expect(() => svc.backtestJob('nope')).toThrow(/no longer in memory/);
  });

  it('fetches 1-minute candles only for contracts that alerted, from the first alert', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    const asked: string[] = [];
    const fetch = provider.getHistoricalCandles.bind(provider);
    provider.getHistoricalCandles = async (q) => (asked.push(`${q.interval} ${q.from}`), fetch(q));
    const quiet = (await svc.createStrategy({ ...S, name: 'Never', expression: cond(field(legSeries('A')), 'GT', num(99_999)) })).id;
    await svc.backtest({ ...jobRequest(), strategyId: quiet, from: '2026-10-01' });
    expect(asked.filter((a) => a.startsWith('1m'))).toEqual([]);
    await svc.backtest({ ...jobRequest(), from: '2026-10-01' });
    expect(asked.filter((a) => a.startsWith('1m'))).toEqual([`1m ${D}`]);
  });

  it('any number of products and any period; notes where a contract’s candles start', async () => {
    expect(backtestRequestSchema.safeParse({ ...jobRequest(), products: Array.from({ length: 250 }, (_, i) => `NSE:S${i}`) }).success).toBe(true);
    provider.set(niftyFut, '1m', risingMinutes(40));
    const r = await svc.backtest({ ...jobRequest(), from: '2026-07-01' });
    expect(r.trades).toHaveLength(1);
    expect(r.products[0]!.notes.join(' ')).toMatch(/^A · .*: Kite has candles for \S+ only from 2026-10-0\d — the days before can’t alert/);
  });

  it('refuses a missing strategy or a reversed period', async () => {
    await expect(svc.backtest({ strategyId: 'nope', products: ['NSE:NIFTY'], from: D, to: D, plan: plan({}) })).rejects.toThrow(/not found/i);
    await expect(svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: '2026-10-01', plan: plan({}) })).rejects.toThrow(/on or before/);
  });
});
