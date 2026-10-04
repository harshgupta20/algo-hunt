/**
 * Backtest: the strategy's past alerts (as Compare finds them) traded like paper trades with the chosen
 * money — exits found on the contract's 1-minute candles (target, stop-loss, square-off, end of test),
 * trades skipped when the capital can't cover them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PaperPlan, StrategyDefinition } from '../../src/shared/v2';
import { defaultPaperPlan } from '../../src/shared/v2';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { RuntimeV2Store, createRuntimeState } from '../../src/server/v2/persistence/RuntimeV2Store';
import type { RawCandle } from '../../src/server/v2/engine/candles';
import { roundTripCharges } from '../../src/server/v2/paper/charges';
import { V2Service } from '../../src/server/v2/V2Service';
import { FixtureV2Provider, MemoryV2Store, NSE_SESSION, RecordingChannels, candlesAt, cond, field, fut, ist, legSeries, num, spot, strategy, timesEndingAt } from '../helpers/v2Fakes';
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
  const run = (p: Partial<PaperPlan>, capital: number | null = 500_000) => svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: D, plan: plan(p), capital });

  it('enters at the alert candle’s close and exits at the target found in 1-minute candles', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    const r = await run({});
    expect(r.products[0]).toMatchObject({ productId: 'NSE:NIFTY', alerts: 1, trades: 1, skipped: 0 });
    const [t] = r.trades;
    // 1 lot of 75 (estimated margin ₹2,26,080 > ₹10,000 per trade → over budget), target +1 %, stop −0.5 %.
    expect(t).toMatchObject({ side: 'BUY', lots: 1, quantity: 75, entryPrice: 25_120, targetPrice: 25_371.2, stopPrice: 24_994.4, overBudget: true, marginEstimated: true, capitalUsed: 226_080 });
    expect(t!.entryAt).toBe(new Date(ist(D, '10:00')).toISOString());
    // The 10:24 minute's high (25,372) reaches the target.
    expect(t).toMatchObject({ exitReason: 'TARGET', exitPrice: 25_371.2, exitAt: new Date(ist(D, '10:25')).toISOString(), grossPnl: 18_840 });
    const charges = roundTripCharges(niftyFut, 75, 25_120, 25_371.2);
    expect(t!.netPnl).toBeCloseTo(18_840 - charges, 2);
    expect(r).toMatchObject({ capital: 500_000, finalCapital: Math.round((500_000 + 18_840 - charges) * 100) / 100 });
    expect(r.returnOnCapitalPct).toBeCloseTo(((18_840 - charges) / 500_000) * 100, 2);
    expect(r.summary.overall).toMatchObject({ trades: 1, wins: 1 });
    expect(r.summary.reasons).toEqual([{ reason: 'TARGET', trades: 1, pnl: t!.netPnl }]);
  });

  it('a stop-loss in the same minute as the target wins; a gap through the stop fills at the open', async () => {
    const m = risingMinutes(3);
    m[1] = { ...m[1]!, open: 24_900, high: 25_500, low: 24_850, close: 25_000 }; // gaps below the stop, spikes above the target
    provider.set(niftyFut, '1m', m);
    const [t] = (await run({})).trades;
    expect(t).toMatchObject({ exitReason: 'STOP', exitPrice: 24_900 });
  });

  it('skips a trade the money can’t cover', async () => {
    provider.set(niftyFut, '1m', risingMinutes(40));
    const r = await run({}, 100_000);
    expect(r.trades).toEqual([]);
    expect(r.skipped).toEqual([{ productId: 'NSE:NIFTY', at: new Date(ist(D, '10:00')).toISOString(), reason: 'Not enough money: needs ₹2,26,080 margin (est.), ₹1,00,000 free' }]);
    expect(r).toMatchObject({ finalCapital: 100_000, returnOnCapitalPct: 0 });
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
    const intraday = await svc.backtest({ strategyId: id, products: ['NSE:NIFTY'], from: '2026-10-02', to: '2026-10-07', plan: p, capital: null });
    expect(intraday.trades).toEqual([]);
    expect(intraday.skipped[0]?.reason).toMatch(/After the 15:20 square-off — switch “Square off daily” off/);
    expect(intraday.notes[0]).toMatch(/Daily \/ weekly candles close after the day’s square-off time/);
    const positional = await svc.backtest({ strategyId: id, products: ['NSE:NIFTY'], from: '2026-10-02', to: '2026-10-07', plan: { ...p, squareOff: false }, capital: null });
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
    const r = await app.backtest({ strategyId: id, products: ['NSE:NIFTY'], from: D, to: D, plan: plan({}), capital: 500_000 });
    expect(r.trades[0]).toMatchObject({ exitReason: 'TARGET', exitPrice: 25_371.2, grossPnl: 18_840 });
  });

  it('refuses a missing strategy or a reversed period', async () => {
    await expect(svc.backtest({ strategyId: 'nope', products: ['NSE:NIFTY'], from: D, to: D, plan: plan({}), capital: null })).rejects.toThrow(/not found/i);
    await expect(svc.backtest({ strategyId, products: ['NSE:NIFTY'], from: D, to: '2026-10-01', plan: plan({}), capital: null })).rejects.toThrow(/on or before/);
  });
});
