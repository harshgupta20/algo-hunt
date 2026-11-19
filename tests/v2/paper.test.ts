/**
 * Paper trading: alerts open simulated trades (on for every connection by default, ₹10,000 per trade,
 * each connection can change its own values),
 * sized in whole lots with slippage; they close at the target / stop-loss, when the other group fires,
 * at the intraday square-off or at expiry, net of charges — and the results roll up per connection
 * and strategy.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExprNode, PaperPlan, PaperTrade, StrategyDefinition, UnitEvaluation, V2Connection, V2Product, V2Strategy, V2Unit } from '../../src/shared/v2';
import { PAPER_DEFAULTS, candleStop, defaultPaperPlan, effectivePlan, exitConditions, exitLevelPrice, oppositeOf, exitText, normalizePaperSummary, normalizePlan, paperOverrideSchema, paperPlanSchema, resolveRules, stopNow, stopOf, targetOf } from '../../src/shared/v2';
import { calendars } from '../../src/server/v2/calendar/MarketCalendar';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { roundTripCharges } from '../../src/server/v2/paper/charges';
import { PaperTrader, paperHit } from '../../src/server/v2/paper/PaperTrader';
import { paperStats } from '../../src/server/v2/paper/summary';
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
  spot,
  strategy,
  timesEndingAt,
} from '../helpers/v2Fakes';

const D = '2026-10-07';
const NOW = ist(D, '11:00') + 30_000;

describe('paper trading — end to end through the scanner', () => {
  const niftySpot = spot('NSE:NIFTY', 'NIFTY 50');
  const niftyFut = { ...fut('NSE:NIFTY', '2026-10-27'), lotSize: 75 };
  const niftyOpts = ladder('NSE:NIFTY', '2026-10-13', 24_800, 25_200, 50).map((o) => ({ ...o, lotSize: 75 }));
  const atmCe = niftyOpts.find((o) => o.kind === 'CE' && o.strike === 25_000)!;
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

  function setup() {
    const clock = { now: NOW };
    const store = new MemoryV2Store(() => clock.now);
    const provider = new FixtureV2Provider([niftySpot, niftyFut, ...niftyOpts]);
    const nse15 = timesEndingAt(ist(D, '10:45'), 15, 65, NSE_SESSION);
    provider.set(niftySpot, '15m', candlesAt(nse15, Array.from({ length: 65 }, (_, i) => 25_000 + i * 0.1)));
    provider.set(niftyFut, '15m', candlesAt(nse15, Array.from({ length: 65 }, (_, i) => 25_100 + i * 0.5)));
    provider.set(atmCe, '15m', candlesAt(nse15, momentumCloses(14), { spread: 0.5 }));
    provider.ltp.set(niftySpot.token, 25_010);
    provider.ltp.set(atmCe.token, 100);
    const channels = new RecordingChannels();
    const svc = new V2Service({ store, provider, products: new ProductService(store, provider), channels, clock: () => clock.now });
    return { clock, store, provider, channels, svc };
  }

  let env: ReturnType<typeof setup>;
  beforeEach(async () => {
    env = setup();
    await env.svc.syncProducts();
  });

  async function connect(plan?: (p: PaperPlan) => PaperPlan) {
    env.clock.now = ist(D, '09:30');
    const s = await env.svc.createStrategy(S);
    const [c] = await env.svc.createConnections(s.id, ['NSE:NIFTY'], config());
    await env.svc.enableConnection(c!.id);
    if (plan) await env.svc.savePaperPlan(s.id, plan(await env.svc.paperPlan(s.id)));
    env.clock.now = NOW;
    return { s, c: c! };
  }

  it('is on for every connection by default: ₹10,000 per trade, +20 % / −10 %, square-off 15:20', async () => {
    const { s, c } = await connect();
    const plan = await env.svc.paperPlan(s.id);
    expect(plan).toMatchObject({ enabled: true, cashPerTrade: 10_000, targetPct: 20, stopPct: 10, squareOff: true, squareOffNse: '15:20', squareOffMcx: '23:20', exitOnOpposite: true, charges: true, slippagePct: 0.5 });
    expect(plan.rules).toEqual([{ group: null, leg: 'B', side: 'BUY' }]); // the option leg
    expect(env.store.data.paperPlans.size).toBe(0); // nothing saved — the defaults apply
    await env.svc.scan();
    expect(env.store.data.paperTrades).toHaveLength(1);
    expect(env.channels.sent[0]!.message.text).toMatch(/📄 Paper: BUY/);
    const settings = await env.svc.paperSettings();
    expect(settings.plans[s.id]).toMatchObject({ enabled: true, cashPerTrade: 10_000 });
    expect(settings.overrides[c.id]).toBeUndefined();
  });

  it('a connection can use its own values over the strategy’s — or switch paper trading off', async () => {
    const { c } = await connect();
    await env.svc.saveConnectionPaper(c.id, { lotsPerTrade: 2, stopPct: null });
    await env.svc.scan();
    expect(env.store.data.paperTrades[0]).toMatchObject({ lots: 2, quantity: 150, stopPrice: null, targetPrice: 120.6 });
    const sum = await env.svc.paperSummary();
    expect(sum.connections[0]!.paper).toEqual({
      enabled: true,
      lotsPerTrade: 2,
      cashPerTrade: 10_000,
      targetPct: 20,
      stopPct: null,
      targetUnit: 'PCT',
      targetPoints: null,
      stopUnit: 'PCT',
      stopPoints: null,
      trailing: false,
      squareOff: true,
      custom: true,
    });
    // Trailing SL on needs a trailing rule — this strategy has none.
    await expect(env.svc.saveConnectionPaper(c.id, { trailing: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/trailing rule/) });

    // Back to the strategy's values.
    expect(await env.svc.saveConnectionPaper(c.id, {})).toEqual({ override: null });
    expect((await env.svc.paperSummary()).connections[0]!.paper).toMatchObject({ lotsPerTrade: 1, custom: false });
    // A watch window that ends before it starts is refused.
    await expect(env.svc.saveConnectionPaper(c.id, { watch: true, watchNseFrom: '14:00', watchNseTo: '10:00' })).rejects.toMatchObject({ status: 400 });
  });

  it('watch window: a trigger candle outside it sends no alert and opens no trade (the strategy’s, or a connection’s own)', async () => {
    // The scan at 11:00:30 evaluates the 10:45–11:00 candle.
    const { c } = await connect((p) => ({ ...p, watch: true, watchNseFrom: '09:15', watchNseTo: '10:45' }));
    await env.svc.scan();
    expect(env.store.data.alerts).toHaveLength(0);
    expect(env.store.data.paperTrades).toHaveLength(0);
    // The connection's own window takes it in: the next candle that turns true alerts.
    await env.svc.saveConnectionPaper(c.id, { watchNseTo: '15:00' });
    const fresh = setup();
    await fresh.svc.syncProducts();
    env = fresh;
    const again = await connect((p) => ({ ...p, watch: true, watchNseFrom: '09:15', watchNseTo: '11:00' }));
    await env.svc.scan();
    expect(env.store.data.alerts).toHaveLength(1);
    expect(again.c.id).toBeTruthy();
  });

  it('switched off for one connection: the alert still goes out, no paper trade', async () => {
    const { c } = await connect();
    await env.svc.saveConnectionPaper(c.id, { enabled: false });
    await env.svc.scan();
    expect(env.store.data.alerts).toHaveLength(1);
    expect(env.store.data.paperTrades).toEqual([]);
    expect(env.channels.sent[0]!.message.text).not.toMatch(/Paper/);
    expect((await env.svc.paperSummary()).connections[0]!.paper).toMatchObject({ enabled: false, custom: true });
  });

  it('Trailing SL per connection: switched on for one connection, its trade runs past the target', async () => {
    const never = cond(field(legSeries('B')), 'LT', num(1));
    // The strategy keeps Trailing SL off but has a trailing rule; this connection switches it on.
    const { s, c } = await connect((p) => ({ ...p, enabled: true, rules: p.rules.map((r) => ({ ...r, stopWhen: never })) }));
    expect((await env.svc.paperPlan(s.id)).trailing).toBe(false);
    await env.svc.saveConnectionPaper(c.id, { trailing: true });
    await env.svc.scan();
    const [t] = env.store.data.paperTrades;
    expect(t).toMatchObject({ targetPrice: 120.6, stopPrice: 90.45, conditions: { stopWhen: never } });
    expect(env.channels.sent[0]!.message.text).toContain('target ₹120.6 starts trailing rules · stop ₹90.45');
    // Above the target: the next scan keeps it open — trailing has started.
    env.clock.now = NOW + 5 * 60_000;
    env.provider.ltp.set(atmCe.token, 121);
    await env.svc.scan();
    expect(env.store.data.paperTrades[0]).toMatchObject({ status: 'OPEN', peakPrice: 121, trailingAt: new Date(env.clock.now).toISOString() });
    // Below the old stop-loss: still open (it no longer applies).
    env.clock.now = NOW + 6 * 60_000;
    env.provider.ltp.set(atmCe.token, 80);
    await env.svc.scan();
    expect(env.store.data.paperTrades[0]!.status).toBe('OPEN');
    expect((await env.svc.paperSummary()).connections[0]!.paper).toMatchObject({ trailing: true, custom: true });
  });

  it('Trailing SL never runs without a target: refused for a connection, and a trade without one is a normal trade', async () => {
    const never = cond(field(legSeries('B')), 'LT', num(1));
    // The connection drops its target first (fine while Trailing SL is off) …
    const { s, c } = await connect((p) => ({ ...p, enabled: true, rules: p.rules.map((r) => ({ ...r, stopWhen: never })) }));
    await env.svc.saveConnectionPaper(c.id, { targetPct: null });
    // … then the strategy switches Trailing SL on: its trades trail, this connection's can't — a normal trade.
    await env.svc.savePaperPlan(s.id, { ...(await env.svc.paperPlan(s.id)), trailing: true });
    await env.svc.scan();
    const [t] = env.store.data.paperTrades;
    expect(t).toMatchObject({ targetPrice: null, stopPrice: 90.45 });
    expect(t!.conditions).toBeUndefined();
    expect(t!.terms.trailFromTarget).toBeUndefined();
    // Dropping the target while Trailing SL is on is refused.
    await expect(env.svc.saveConnectionPaper(c.id, { targetPct: null, lotsPerTrade: 2 })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/set a target/) });
  });

  it('an alert buys whole lots with the cash, and the target closes it net of charges', async () => {
    const { s, c } = await connect((p) => ({ ...p, enabled: true }));
    const { run } = await env.svc.scan();
    expect(run.errors).toEqual([]);
    const [t] = env.store.data.paperTrades;
    expect(t).toMatchObject({
      connectionId: c.id,
      slot: 'shift:0',
      leg: 'B',
      side: 'BUY',
      alertId: env.store.data.alerts[0]!.id,
      lots: 1, // one lot of 75 at ₹100.50 = ₹7,537.50 (two would be over ₹10,000)
      quantity: 75,
      entryRef: 100,
      entryPrice: 100.5, // +0.5 % slippage
      targetPrice: 120.6,
      stopPrice: 90.45,
      capitalUsed: 7537.5,
      overBudget: false,
      status: 'OPEN',
    });
    expect(t!.instrument.id).toBe(atmCe.id);
    expect(env.channels.sent[0]!.message.text).toContain('📄 Paper: BUY 1 lot (75) NIFTY2026101325000CE @ ₹100.5 · target ₹120.6 · stop ₹90.45');

    // Five minutes later the option trades above the target: the next scan closes it at the target price.
    env.clock.now = NOW + 5 * 60_000;
    env.provider.ltp.set(atmCe.token, 121);
    const next = await env.svc.scan();
    expect(next.run.notes.join(' ')).toMatch(/Paper trading: closed 1 trade/);
    const [closed] = await env.svc.paperTrades({ strategyId: s.id });
    const charges = roundTripCharges(atmCe, 75, 100.5, 120.6);
    expect(charges).toBeCloseTo(63.35, 1);
    expect(closed).toMatchObject({ status: 'CLOSED', exitReason: 'TARGET', exitPrice: 120.6, grossPnl: 1507.5, charges, netPnl: 1507.5 - charges });

    // Its story's path: Kite's 1-minute candles from the entry's minute (11:00) to the exit's (11:05), then 12 after.
    env.provider.set(atmCe, '1m', Array.from({ length: 30 }, (_, j) => ({ time: (ist(D, '10:55') + j * 60_000) / 1000, open: 100 + j, high: 101 + j, low: 99 + j, close: 100.5 + j, volume: 1 })));
    const path = await env.svc.paperTradePath(closed!.id);
    expect(path).toMatchObject({ step: 1, held: 6 });
    expect(path!.bars).toHaveLength(18);
    expect(path!.bars[0]![0]).toBe(ist(D, '11:00') / 1000);
    env.provider.set(atmCe, '1m', []); // Kite has none (an expired contract): no path, the timeline still shows
    expect(await env.svc.paperTradePath(closed!.id)).toBeNull();
    await expect(env.svc.paperTradePath('no-such-trade')).rejects.toMatchObject({ status: 404 });

    const sum = await env.svc.paperSummary();
    expect(sum.overall).toMatchObject({ trades: 1, open: 0, wins: 1, winRate: 100, capitalPeak: 7537.5, netPnl: 1507.5 - charges, profitFactor: null, avgWin: 1507.5 - charges, avgLoss: null, todayPnl: 1507.5 - charges });
    expect(sum.daily).toEqual([{ date: D, pnl: 1507.5 - charges, trades: 1, wins: 1 }]);
    expect(sum.reasons).toEqual([{ reason: 'TARGET', trades: 1, pnl: 1507.5 - charges }]);
    expect(sum.hours).toEqual([{ hour: 11, trades: 1, pnl: 1507.5 - charges, wins: 1 }]);
    expect(sum.connections[0]).toMatchObject({ strategyName: 'Future leads the call', switchedOn: true, spark: [1507.5 - charges] });
    // A period that starts after the trade shows the connection with no trades.
    const later = await env.svc.paperSummary({ from: '2026-10-08' });
    expect(later.overall.trades).toBe(0);
    expect(later.connections.map((x) => x.stats.trades)).toEqual([0]);
    expect(sum.overall.returnPct).toBeCloseTo(((1507.5 - charges) / 7537.5) * 100, 1);
    expect(sum.strategies).toEqual([expect.objectContaining({ strategyId: s.id, name: 'Future leads the call', enabled: true, cashPerTrade: 10_000 })]);
    expect(sum.connections).toEqual([expect.objectContaining({ connectionId: c.id, symbol: 'NIFTY' })]);
    expect(sum.equity).toEqual([{ at: new Date(NOW + 5 * 60_000).toISOString(), pnl: 1507.5 - charges }]);
  });

  it('target / stop-loss in points: price points from the fill, per strategy and per connection', async () => {
    const { s, c } = await connect((p) => ({ ...p, enabled: true, targetUnit: 'POINTS', targetPct: null, targetPoints: 15, stopUnit: 'POINTS', stopPct: null, stopPoints: 8 }));
    await env.svc.scan();
    const [t] = env.store.data.paperTrades;
    // Entry ₹100.50 (₹100 + 0.5 % slippage): target 100.5 + 15, stop 100.5 − 8.
    expect(t).toMatchObject({ entryPrice: 100.5, targetPrice: 115.5, stopPrice: 92.5 });
    expect(t!.terms).toMatchObject({ targetPct: null, targetPoints: 15, stopPct: null, stopPoints: 8 });
    env.clock.now = NOW + 5 * 60_000;
    env.provider.ltp.set(atmCe.token, 116);
    await env.svc.scan();
    const [closed] = await env.svc.paperTrades({ strategyId: s.id });
    expect(closed).toMatchObject({ status: 'CLOSED', exitReason: 'TARGET', exitPrice: 115.5, grossPnl: 15 * 75 });
    const brief = (await env.svc.paperSummary()).connections[0]!.paper;
    expect(brief).toMatchObject({ targetUnit: 'POINTS', targetPoints: 15, stopUnit: 'POINTS', stopPoints: 8 });

    // A connection's own target in %: its next trade uses it; the stop stays the strategy's points.
    await env.svc.saveConnectionPaper(c.id, { targetUnit: 'PCT', targetPct: 10, targetPoints: null });
    const eff = effectivePlan(await env.svc.paperPlan(s.id), (await env.svc.paperSettings()).overrides[c.id]);
    expect(targetOf(eff)).toEqual({ value: 10, unit: 'PCT' });
    expect(stopOf(eff)).toEqual({ value: 8, unit: 'POINTS' });
  });

  it('stop-loss at the signal candle: the traded contract’s own candle that fired the alert (Kite’s 1-minute candles)', async () => {
    // The alert fires on the 10:45–11:00 candle; the call's minutes in it dip to ₹97.20.
    env.provider.set(
      atmCe,
      '1m',
      Array.from({ length: 15 }, (_, j) => ({ time: Math.floor((ist(D, '10:45') + j * 60_000) / 1000), open: 99, high: 101, low: j === 9 ? 97.2 : 98.5, close: 100, volume: 5 })),
    );
    await connect((p) => ({ ...p, enabled: true, stopUnit: 'CANDLE', stopPct: null }));
    await env.svc.scan();
    const [t] = env.store.data.paperTrades;
    expect(t).toMatchObject({ entryPrice: 100.5, stopPrice: 97.2 });
    expect(t!.terms).toMatchObject({ stopCandle: true, stopPct: null });
    expect(env.channels.sent[0]!.message.text).toContain('stop ₹97.2 (signal candle low)');
  });

  it('closes by hand at the latest price, and a reset clears the strategy', async () => {
    const { s } = await connect((p) => ({ ...p, enabled: true, targetPct: null, stopPct: null }));
    await env.svc.scan();
    const [open] = await env.svc.paperTrades({ status: 'OPEN' });
    expect(open).toMatchObject({ targetPrice: null, stopPrice: null });
    env.provider.ltp.set(atmCe.token, 95);
    const closed = await env.svc.closePaperTrade(open!.id);
    expect(closed).toMatchObject({ exitReason: 'MANUAL', exitPrice: 94.5 }); // 95 − 0.5 % slippage = 94.525, a sell rounds down to the 0.05 tick
    await expect(env.svc.closePaperTrade(open!.id)).rejects.toThrow(/No open paper trade/);
    expect(await env.svc.resetPaper(s.id)).toEqual({ deleted: 1 });
    expect(await env.svc.paperTrades({})).toEqual([]);
  });
});

// ---- the trader on its own ---------------------------------------------------------------

const cals = calendars([]);
const spotI = spot('NSE:NIFTY', 'NIFTY 50');
const futI = { ...fut('NSE:NIFTY', '2026-10-27'), lotSize: 75 };
const ceI = { ...ladder('NSE:NIFTY', '2026-10-13', 25_000, 25_000, 50)[0]!, lotSize: 75 };
const peI = { ...ladder('NSE:NIFTY', '2026-10-13', 25_000, 25_000, 50)[1]!, lotSize: 75 };
const unit: V2Unit = { key: '2026-10-13|25000', productId: 'NSE:NIFTY', expiry: '2026-10-13', baseStrike: 25_000, shift: 0, legs: { A: futI, B: ceI, C: peI, D: spotI } };
const product = { id: 'NSE:NIFTY', market: 'NSE', kind: 'INDEX', symbol: 'NIFTY' } as V2Product;
const connection = { id: '00000000-0000-4000-8000-000000000001', strategyId: 's1', productId: 'NSE:NIFTY' } as V2Connection;

const bull: ExprNode = { ...and(cond(field(legSeries('B')), 'GT', num(1))), label: 'Bullish' } as ExprNode;
const bear: ExprNode = { ...and(cond(field(legSeries('C')), 'GT', num(1))), label: 'Bearish' } as ExprNode;
const grouped: StrategyDefinition = {
  ...strategy(
    [
      { id: 'A', kind: 'FUT' },
      { id: 'B', kind: 'CE', strikeOffset: 0 },
      { id: 'C', kind: 'PE', strikeOffset: 0 },
      { id: 'D', kind: 'SPOT' },
    ],
    { type: 'OR', id: 'root', children: [bull, bear] },
  ),
  name: 'Both ways',
};
const strat = { id: 's1', name: 'Both ways', version: 1, definition: grouped } as V2Strategy;

function evaluation(fired: 'bull' | 'bear'): UnitEvaluation {
  return {
    strategyId: 's1',
    version: 1,
    productId: 'NSE:NIFTY',
    unit,
    mode: 'COMPLETED_CANDLE',
    triggerTimeframe: '15m',
    triggerCandle: 0,
    evaluatedAt: 0,
    result: 'TRUE',
    trace: {
      id: 'root',
      type: 'OR',
      result: 'TRUE',
      children: [
        { id: bull.id, type: 'AND', result: fired === 'bull' ? 'TRUE' : 'FALSE' },
        { id: bear.id, type: 'AND', result: fired === 'bear' ? 'TRUE' : 'FALSE' },
      ],
    },
    prices: {},
  };
}

function trader(start = ist(D, '11:00'), provider?: FixtureV2Provider) {
  const clock = { now: start };
  const store = new MemoryV2Store(() => clock.now);
  const prices = new Map<number, number>([
    [ceI.token, 100],
    [peI.token, 80],
    [futI.token, 25_000],
    [spotI.token, 24_990],
  ]);
  const t = new PaperTrader({ store, now: () => clock.now, prices: async (list) => new Map(list.flatMap((i) => (prices.has(i.token) ? [[i.token, prices.get(i.token)!] as [number, number]] : []))), provider });
  const alert = (fired: 'bull' | 'bear') => t.onAlert({ connection, strategy: strat, product, unit, evaluation: evaluation(fired), alertId: null, cal: cals.NSE });
  return { clock, store, prices, t, alert };
}

describe('paper trader', () => {
  it('trailing rules: checked live on Kite’s candles once each candle after trailing started closes, on the legs the trade opened on', async () => {
    const provider = new FixtureV2Provider([spotI, futI, ceI, peI]);
    const times = timesEndingAt(ist(D, '11:00'), 15, 40, NSE_SESSION);
    const env = trader(ist(D, '11:00'), provider);
    // The call's 15-minute closes: 100 … then 94 on the 11:00–11:15 candle — not published yet.
    provider.set(ceI, '15m', candlesAt(times.slice(0, -1), times.slice(0, -1).map(() => 100)));
    const stopWhen = cond(field(legSeries('B')), 'LT', num(95));
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), trailing: true, targetPct: 10, stopPct: null, rules: [{ group: bull.id, leg: 'B', side: 'BUY', stopWhen }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    expect(await env.alert('bull')).toMatch(/· target ₹110\.55 starts trailing rules/);
    const [opened] = env.store.data.paperTrades;
    expect(opened!.conditions).toMatchObject({ stopWhen, legs: { B: ceI } });
    expect(opened!.terms.trailFromTarget).toBe(true);
    // 11:00: the price is past the target at once — trailing starts.
    env.prices.set(ceI.token, 111);
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    expect(env.store.data.paperTrades[0]!.trailingAt).toBe(new Date(ist(D, '11:00')).toISOString());

    // Before the candle closes: nothing to check. Just after, Kite hasn't published it: wait (not decided on old data).
    env.clock.now = ist(D, '11:14');
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    env.clock.now = ist(D, '11:15') + 5_000;
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    // Published: 94 < 95 → closed by the trailing rule at the market price.
    provider.set(ceI, '15m', candlesAt(times, [...times.slice(0, -1).map(() => 100), 94]));
    env.prices.set(ceI.token, 93.5);
    env.clock.now = ist(D, '11:15') + 20_000;
    const { closed } = await env.t.monitor(cals);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ exitReason: 'STOP_RULE', exitAt: new Date(env.clock.now).toISOString() });
    expect(closed[0]!.exitPrice).toBe(93); // 93.5 − 0.5 % slippage, ticked down
  });

  it('Trailing SL: the target doesn’t close the trade; past it the stop-loss no longer applies', async () => {
    const env = trader();
    const stopWhen = cond(field(legSeries('B')), 'LT', num(1));
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), trailing: true, targetPct: 10, stopPct: 10, rules: [{ group: bull.id, leg: 'B', side: 'BUY', stopWhen }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    // Entry 100.5: target 110.55, stop-loss 90.45.
    expect(await env.alert('bull')).toMatch(/target ₹110\.55 starts trailing rules · stop ₹90\.45/);
    const at = (price: number) => env.prices.set(ceI.token, price);
    const trade = () => env.store.data.paperTrades[0]!;
    at(105);
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    expect(paperHit(trade(), 90)).toBe('STOP'); // before the target the stop-loss counts
    at(112); // past the target: not closed — the trailing rules take over
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    expect(trade()).toMatchObject({ status: 'OPEN', peakPrice: 112, trailingAt: new Date(env.clock.now).toISOString() });
    expect(stopNow(trade())).toBeNull();
    at(85); // below the old stop-loss: still open — it no longer applies
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    expect(trade().status).toBe('OPEN');
    // Trailing SL off (a trade opened without it): the target closes the trade, as a normal trade.
    const { conditions: _c, ...plain } = trade();
    expect(paperHit({ ...plain, terms: { ...plain.terms, trailFromTarget: undefined }, peakPrice: 100.5, trailingAt: undefined }, 111)).toBe('TARGET');
  });

  it('Trailing SL on a sell: the target below the entry starts trailing; the stop-loss above counts only before it', async () => {
    const env = trader();
    const never = cond(field(legSeries('B')), 'GT', num(10_000));
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), trailing: true, targetPct: 10, stopPct: 10, rules: [{ group: bull.id, leg: 'B', side: 'SELL', stopWhen: never }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    // Sold at 100 − 0.5 % = 99.5: target 89.55 below, stop-loss 109.45 above.
    expect(await env.alert('bull')).toMatch(/SELL 1 lot \(75\) .* @ ₹99\.5 · target ₹89\.55 starts trailing rules · stop ₹109\.45/);
    const at = (price: number) => env.prices.set(ceI.token, price);
    const trade = () => env.store.data.paperTrades[0]!;
    at(95);
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    expect(paperHit(trade(), 110)).toBe('STOP');
    at(89); // past the target (below it, for a sell): trailing starts
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    expect(trade()).toMatchObject({ status: 'OPEN', peakPrice: 89, trailingAt: new Date(env.clock.now).toISOString() });
    at(115); // above the old stop-loss: it no longer applies
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    expect(trade().status).toBe('OPEN');
  });

  it('Trailing SL: a trade that is trailing still closes on the other group, the square-off or by hand', async () => {
    const never = cond(field(legSeries('B')), 'LT', num(1));
    const setup = async () => {
      const env = trader();
      await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), trailing: true, targetPct: 10, rules: [{ group: bull.id, leg: 'B', side: 'BUY', stopWhen: never }, { group: bear.id, leg: 'C', side: 'BUY' }] });
      await env.alert('bull');
      env.prices.set(ceI.token, 112); // past the 110.55 target
      await env.t.monitor(cals);
      expect(env.store.data.paperTrades[0]).toMatchObject({ status: 'OPEN', trailingAt: expect.any(String) });
      return env;
    };
    const opposite = await setup();
    await opposite.alert('bear');
    expect(opposite.store.data.paperTrades.map((t) => [t.leg, t.status, t.exitReason])).toEqual([
      ['B', 'CLOSED', 'OPPOSITE'],
      ['C', 'OPEN', null],
    ]);
    const squareOff = await setup();
    squareOff.clock.now = ist(D, '15:21');
    expect((await squareOff.t.monitor(cals)).closed[0]).toMatchObject({ exitReason: 'SQUARE_OFF' });
    const byHand = await setup();
    expect(await byHand.t.closeManual(byHand.store.data.paperTrades[0]!.id)).toMatchObject({ exitReason: 'MANUAL', status: 'CLOSED' });
  });

  it('trades opened before Trailing SL keep their rules: a trailing % from the entry, the target closes them', async () => {
    const env = trader();
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), targetPct: 20, stopPct: 10 });
    await env.alert('bull');
    // As opened on 3–4 Nov: a 5 % trailing stop, no Trailing SL marker.
    const old = { ...env.store.data.paperTrades[0]!, terms: { ...env.store.data.paperTrades[0]!.terms, trailPct: 5 } };
    expect(old.terms.trailFromTarget).toBeUndefined();
    expect(stopNow({ ...old, peakPrice: 110 })).toEqual({ price: 104.5, reason: 'TRAIL' }); // from the entry: 110 × 0.95, tighter than 90.45
    expect(paperHit({ ...old, peakPrice: 110 }, 121)).toBe('TARGET'); // 120.6: the target still closes it
    expect(paperHit({ ...old, peakPrice: 110 }, 104)).toBe('TRAIL');
  });

  it('trailing rules with a target: not before the price reaches it, then on the candles closing after it', async () => {
    const provider = new FixtureV2Provider([spotI, futI, ceI, peI]);
    const times = timesEndingAt(ist(D, '11:15'), 15, 40, NSE_SESSION);
    const env = trader(ist(D, '11:00'), provider);
    const stopWhen = cond(field(legSeries('B')), 'LT', num(95));
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), trailing: true, targetPct: 10, stopPct: null, rules: [{ group: bull.id, leg: 'B', side: 'BUY', stopWhen }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    expect(await env.alert('bull')).toMatch(/target ₹110\.55 starts trailing rules/);
    // The call's 15-minute candles close at 94 from 11:00 on: the rule is true, but the target isn't reached yet.
    provider.set(ceI, '15m', candlesAt(times, times.map((t) => (t >= ist(D, '11:00') ? 94 : 100))));
    env.prices.set(ceI.token, 99);
    env.clock.now = ist(D, '11:15') + 20_000;
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    // 11:20: the price reaches the target — not closed, trailing starts; the 11:15 close came before it.
    env.prices.set(ceI.token, 111);
    env.clock.now = ist(D, '11:20');
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    expect(env.store.data.paperTrades[0]).toMatchObject({ status: 'OPEN', peakPrice: 111, trailingAt: new Date(ist(D, '11:20')).toISOString() });
    // The 11:15–11:30 candle is the first to close after it: closed by the trailing rule.
    env.clock.now = ist(D, '11:30') + 20_000;
    const { closed } = await env.t.monitor(cals);
    expect(closed[0]).toMatchObject({ exitReason: 'STOP_RULE' });
  });

  it('exit condition ("Exit when…"): from the entry, at the first candle close it is true — Trailing SL or not', async () => {
    const provider = new FixtureV2Provider([spotI, futI, ceI, peI]);
    const times = timesEndingAt(ist(D, '11:15'), 15, 40, NSE_SESSION);
    const env = trader(ist(D, '11:00'), provider);
    const exitWhen = cond(field(legSeries('B')), 'LT', num(95));
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), targetUnit: 'POINTS', targetPct: null, targetPoints: 50, stopPct: null, rules: [{ group: bull.id, leg: 'B', side: 'BUY', exitWhen }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    const line = await env.alert('bull');
    expect(line).toMatch(/target ₹150\.5 · or when \[CE ATM\] \[15 min\] \[Normal\] Close < 95/);
    expect(env.store.data.paperTrades[0]!.conditions).toMatchObject({ exitWhen });
    expect(env.store.data.paperTrades[0]!.conditions?.stopWhen).toBeUndefined();
    // The 11:00–11:15 candle closes at 94: the exit condition is true at 11:15 — the target (₹150.50) wasn't reached.
    provider.set(ceI, '15m', candlesAt(times, times.map((t) => (t >= ist(D, '11:00') ? 94 : 100))));
    env.prices.set(ceI.token, 96);
    env.clock.now = ist(D, '11:15') + 20_000;
    const { closed } = await env.t.monitor(cals);
    expect(closed[0]).toMatchObject({ exitReason: 'TARGET_RULE', exitPrice: expect.any(Number) });
  });

  it('exit condition = the other group’s own entry: its alert closes the trade by the exit condition and opens the other — even with “exit on the other group” off', async () => {
    const env = trader();
    // The bear group's conditions under other ids (as "Opposite of its entry" or a hand-made copy would be).
    const copy = (n: ExprNode): ExprNode =>
      n.type === 'AND' || n.type === 'OR' ? { type: n.type, id: `${n.id}-x`, children: n.children.map(copy) } : n.type === 'NOT' ? { ...n, id: `${n.id}-x`, child: copy(n.child) } : { ...n, id: `${n.id}-x` };
    const exitWhen = copy(bear);
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), exitOnOpposite: false, rules: [{ group: bull.id, leg: 'B', side: 'BUY', exitWhen }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    await env.alert('bull');
    env.prices.set(ceI.token, 110);
    const line = await env.alert('bear');
    expect(line).toMatch(/closed BUY 1 lot \(75\) NIFTY2026101325000CE @ ₹109\.45 \(exit condition\)/);
    expect(line).toMatch(/\n📄 Paper: BUY 1 lot \(75\) NIFTY2026101325000PE/);
    expect(env.store.data.paperTrades.map((t) => [t.leg, t.status, t.exitReason ?? null])).toEqual([
      ['B', 'CLOSED', 'TARGET_RULE'],
      ['C', 'OPEN', null],
    ]);
  });

  it('exit condition: the target first when it comes first (whichever is earlier)', async () => {
    const provider = new FixtureV2Provider([spotI, futI, ceI, peI]);
    const env = trader(ist(D, '11:00'), provider);
    const exitWhen = cond(field(legSeries('B')), 'LT', num(95));
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), targetUnit: 'POINTS', targetPct: null, targetPoints: 5, stopPct: null, rules: [{ group: bull.id, leg: 'B', side: 'BUY', exitWhen }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    await env.alert('bull');
    env.prices.set(ceI.token, 106);
    env.clock.now = ist(D, '11:05');
    const { closed } = await env.t.monitor(cals);
    expect(closed[0]).toMatchObject({ exitReason: 'TARGET', exitPrice: 105.5 });
  });

  it('sizes futures / options in the plan’s lots, stocks in ₹ per trade', async () => {
    const env = trader();
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), lotsPerTrade: 3, cashPerTrade: 100_000 });
    expect(await env.alert('bull')).toMatch(/BUY 3 lots \(225\) NIFTY2026101325000CE/);
    expect(env.store.data.paperTrades[0]).toMatchObject({ lots: 3, quantity: 225, overBudget: false });
  });

  it('groups: each trades its own leg; the other group firing closes the open trade and opens its own', async () => {
    const env = trader();
    const plan = defaultPaperPlan(grouped, true);
    expect(plan.rules).toEqual([
      { group: bull.id, leg: 'B', side: 'BUY' },
      { group: bear.id, leg: 'C', side: 'BUY' },
    ]);
    await env.store.paper.savePlan('s1', plan);

    expect(await env.alert('bull')).toMatch(/^📄 Paper: BUY 1 lot \(75\) NIFTY2026101325000CE @ ₹100\.5/);
    expect(await env.alert('bull')).toMatch(/already in BUY 1 lot \(75\) NIFTY2026101325000CE — kept open/);
    env.prices.set(ceI.token, 110);
    const line = await env.alert('bear');
    expect(line).toMatch(/closed BUY 1 lot \(75\) NIFTY2026101325000CE @ ₹109\.45 \(the other group fired\) · P&L \+₹/);
    expect(line).toMatch(/\n📄 Paper: BUY 1 lot \(75\) NIFTY2026101325000PE @ ₹80\.4/);
    const trades = env.store.data.paperTrades;
    expect(trades.map((t) => [t.leg, t.groupLabel, t.status, t.exitReason])).toEqual([
      ['B', 'Bullish', 'CLOSED', 'OPPOSITE'],
      ['C', 'Bearish', 'OPEN', null],
    ]);
  });

  it('a group without a leg only exits; exits on the other group can be switched off', async () => {
    const env = trader();
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), rules: [{ group: bull.id, leg: 'B', side: 'BUY' }, { group: bear.id, leg: null, side: 'BUY' }] });
    await env.alert('bull');
    expect(await env.alert('bear')).toMatch(/closed BUY .*\n📄 Paper: no trade — Bearish doesn't trade/);

    const env2 = trader();
    await env2.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), exitOnOpposite: false });
    await env2.alert('bull');
    expect(await env2.alert('bear')).toMatch(/is still open — no new trade/);
    expect(env2.store.data.paperTrades).toHaveLength(1);
  });

  it('selling a future: the plan’s lots on an estimated margin (never over budget), stop above the entry (and the stop wins)', async () => {
    const env = trader();
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), rules: [{ group: bull.id, leg: 'A', side: 'SELL' }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    expect(await env.alert('bull')).toMatch(/SELL 1 lot \(75\) NIFTY20261027FUT @ ₹24,875 · target ₹19,900 · stop ₹27,362\.5$/);
    const [t] = env.store.data.paperTrades;
    expect(t).toMatchObject({ side: 'SELL', entryPrice: 24_875, marginEstimated: true, overBudget: false, capitalUsed: 223_875 });
    expect(paperHit(t!, 27_400)).toBe('STOP');
    expect(paperHit(t!, 19_800)).toBe('TARGET');
    expect(paperHit(t!, 25_000)).toBeNull();
    expect(paperHit({ ...t!, targetPrice: 27_000 }, 27_400)).toBe('STOP'); // both reached → the stop
  });

  it("doesn't trade an index, a closed market, or after the square-off", async () => {
    const env = trader();
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), rules: [{ group: bull.id, leg: 'D', side: 'BUY' }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    expect(await env.alert('bull')).toMatch(/no trade — an index can't be traded/);
    env.clock.now = ist(D, '15:21');
    expect(await env.alert('bear')).toMatch(/no trade — after the 15:20 square-off/);
    env.clock.now = ist('2026-10-10', '11:00'); // Saturday
    expect(await env.alert('bear')).toMatch(/no trade — market closed/);
    expect(env.store.data.paperTrades).toEqual([]);
  });

  it('squares off intraday trades at 15:20 — late checks use the last price seen, at 15:20', async () => {
    const env = trader();
    await env.store.paper.savePlan('s1', defaultPaperPlan(grouped, true));
    await env.alert('bull');
    env.clock.now = ist(D, '14:00');
    env.prices.set(ceI.token, 104);
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    expect(env.store.data.paperTrades[0]).toMatchObject({ lastPrice: 104, status: 'OPEN' });
    // Nothing checked again until the next morning.
    env.clock.now = ist('2026-10-08', '09:20');
    env.prices.set(ceI.token, 60);
    const { closed } = await env.t.monitor(cals);
    expect(closed[0]).toMatchObject({ exitReason: 'SQUARE_OFF', exitAt: new Date(ist(D, '15:20')).toISOString(), exitPrice: 103.45 }); // 104 − 0.5 % = 103.48 → 103.45
  });

  it('positional trades (no square-off) run to expiry', async () => {
    const env = trader();
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), squareOff: false, targetPct: null, stopPct: null });
    await env.alert('bull');
    env.clock.now = ist('2026-10-12', '15:00');
    expect((await env.t.monitor(cals)).closed).toEqual([]);
    env.clock.now = ist('2026-10-13', '15:31');
    env.prices.set(ceI.token, 5);
    const { closed } = await env.t.monitor(cals);
    expect(closed[0]).toMatchObject({ exitReason: 'EXPIRY', exitPrice: 4.95 }); // 5 − 0.5 % = 4.975 → 4.95
  });
});

describe('paper results and plan', () => {
  it('target / stop-loss in % or points: levels, text, schema, older plans', () => {
    const pct = { targetPct: 20, stopPct: 10 };
    expect(targetOf(pct)).toEqual({ value: 20, unit: 'PCT' }); // a plan saved before points
    expect(targetOf({ ...pct, targetUnit: 'POINTS', targetPoints: null })).toBeNull();
    expect(stopOf({ ...pct, stopUnit: 'POINTS', stopPoints: 12.5 })).toEqual({ value: 12.5, unit: 'POINTS' });
    expect(exitText({ value: 20, unit: 'PCT' })).toBe('20%');
    expect(exitText({ value: 15, unit: 'POINTS' })).toBe('15 pts');
    expect(exitLevelPrice(150, { value: 20, unit: 'POINTS' }, true)).toBe(170);
    expect(exitLevelPrice(150, { value: 20, unit: 'POINTS' }, false)).toBe(130);
    expect(exitLevelPrice(150, { value: 20, unit: 'PCT' }, true)).toBeCloseTo(180, 9);
    expect(exitLevelPrice(150, { value: 200, unit: 'POINTS' }, false)).toBeNull(); // at or below 0: never reached
    expect(exitLevelPrice(150, null, true)).toBeNull();

    const plan = defaultPaperPlan(strategy([{ id: 'A', kind: 'FUT' }], cond(ind(legSeries('A'), 'RSI', { period: 14 }), 'GT', num(60))), true);
    expect(plan).toMatchObject({ targetUnit: 'PCT', targetPoints: null, stopUnit: 'PCT', stopPoints: null });
    // An older client sends no units: % with no points.
    const { targetUnit: _a, targetPoints: _b, stopUnit: _c, stopPoints: _d, ...old } = plan;
    expect(paperPlanSchema.parse(old)).toMatchObject({ targetUnit: 'PCT', targetPoints: null, stopUnit: 'PCT', stopPoints: null });
    expect(normalizePlan(old as PaperPlan)).toMatchObject({ targetUnit: 'PCT', targetPoints: null });
    expect(paperPlanSchema.safeParse({ ...plan, targetUnit: 'POINTS', targetPct: null, targetPoints: 25 }).success).toBe(true);
    expect(paperPlanSchema.safeParse({ ...plan, targetUnit: 'POINTS', targetPoints: 0 }).success).toBe(false);
    expect(paperPlanSchema.safeParse({ ...plan, stopUnit: 'TICKS' }).success).toBe(false);
    // Trailing SL needs a target — in points too.
    expect(paperPlanSchema.safeParse({ ...plan, trailing: true, targetUnit: 'POINTS', targetPct: null, targetPoints: null }).success).toBe(false);
    expect(paperOverrideSchema.safeParse({ targetUnit: 'POINTS', targetPoints: 40, targetPct: null }).success).toBe(true);
  });

  it('the opposite of an entry: crossed above ↔ below, > ↔ <, ≥ ↔ ≤ — what "Opposite of its entry" fills in', () => {
    const A = legSeries('A', '5m');
    const rsi = ind(A, 'RSI', { period: 14 });
    const rsiMa = { ...rsi, ma: { type: 'SMA' as const, period: 9 } } as typeof rsi;
    let n = 0;
    const entry = and(cond(rsi, 'CROSSED_ABOVE', rsiMa), cond(field(A), 'GTE', ind(A, 'EMA', { period: 20 })));
    const exit = oppositeOf(entry, () => `x${n++}`);
    expect(exit).toMatchObject({ type: 'AND', children: [{ operator: 'CROSSED_BELOW', left: rsi, right: rsiMa }, { operator: 'LTE' }] });
    expect(exit.id).not.toBe(entry.id);
    expect(oppositeOf(cond(rsi, 'CROSSED_BELOW', rsiMa), () => 'y')).toMatchObject({ type: 'CONDITION', operator: 'CROSSED_ABOVE' });
    // Rules that trade, with an exit condition, are what the engines check.
    const rules = [
      { group: 'g1', leg: 'A' as const, side: 'BUY' as const, exitWhen: exit },
      { group: 'g2', leg: null, side: 'BUY' as const, exitWhen: exit },
      { group: 'g3', leg: 'A' as const, side: 'SELL' as const, exitWhen: { type: 'OR' as const, id: 'e', children: [] } },
    ];
    expect(exitConditions(rules)).toEqual([{ key: 'g1|EXIT', group: 'g1', when: exit }]);
    const plan = defaultPaperPlan(strategy([{ id: 'A', kind: 'FUT' }], cond(rsi, 'CROSSED_ABOVE', rsiMa)), true);
    expect(paperPlanSchema.safeParse({ ...plan, rules: [{ ...plan.rules[0]!, exitWhen: exit }] }).success).toBe(true);
  });

  it('stop-loss at the signal candle: the low for a buy, the high for a sell — only beyond the entry', () => {
    expect(stopOf({ targetPct: 20, stopPct: null, stopUnit: 'CANDLE' })).toEqual({ unit: 'CANDLE' });
    expect(exitText({ unit: 'CANDLE' }, 'BUY')).toBe('signal candle low');
    expect(exitText({ unit: 'CANDLE' }, 'SELL')).toBe('signal candle high');
    const candle = { high: 152, low: 142.5 };
    expect(candleStop('BUY', 148, candle)).toBe(142.5);
    expect(candleStop('SELL', 148, candle)).toBe(152);
    expect(candleStop('BUY', 142, candle)).toBeNull(); // the low is above a buy's entry: no stop
    expect(candleStop('SELL', 153, candle)).toBeNull();
    expect(candleStop('BUY', 148, null)).toBeNull();
    const plan = defaultPaperPlan(strategy([{ id: 'A', kind: 'FUT' }], cond(ind(legSeries('A'), 'RSI', { period: 14 }), 'GT', num(60))), true);
    expect(paperPlanSchema.safeParse({ ...plan, stopUnit: 'CANDLE', stopPct: null }).success).toBe(true);
    expect(paperOverrideSchema.safeParse({ stopUnit: 'CANDLE', stopPct: null }).success).toBe(true);
    expect(paperPlanSchema.safeParse({ ...plan, targetUnit: 'CANDLE' }).success).toBe(false); // a target can't be a candle
  });

  const trade = (p: Partial<PaperTrade>): PaperTrade => ({ status: 'CLOSED', capitalUsed: 10_000, overBudget: false, grossPnl: 0, charges: 0, netPnl: 0, entryAt: '', exitAt: '', lastPrice: null, ...p }) as PaperTrade;

  it('win rate, the money needed at once, return on it, and the deepest drawdown', () => {
    const t = (h: number) => new Date(ist(D, `${String(h).padStart(2, '0')}:00`)).toISOString();
    const stats = paperStats(
      [
        trade({ entryAt: t(9), exitAt: t(11), netPnl: 1000 }),
        trade({ entryAt: t(10), exitAt: t(12), netPnl: -1500 }), // overlaps the first: ₹20,000 in use
        trade({ entryAt: t(12), exitAt: t(13), netPnl: -200 }), // opens as the second closes
        trade({ entryAt: t(13), exitAt: t(14), netPnl: 2000 }),
      ],
      ist(D, '15:00'),
    );
    expect(stats).toMatchObject({ trades: 4, wins: 2, losses: 2, winRate: 50, netPnl: 1300, capitalPeak: 20_000, returnPct: 6.5, maxDrawdown: -1700, best: 2000, worst: -1500, avgPnl: 325, profitFactor: 1.76, avgWin: 1500, avgLoss: -850 });
  });

  it('fills in what an older server left out of a summary (no crash on missing figures)', () => {
    const old = normalizePaperSummary({ overall: { trades: 2, netPnl: 50 } as never, connections: [{ connectionId: 'c', strategyId: 's', productId: 'NSE:NIFTY', symbol: 'NIFTY', stats: { trades: 1 } } as never] });
    expect(old.overall).toMatchObject({ trades: 2, netPnl: 50, profitFactor: null, avgWin: null, todayPnl: 0 });
    expect(old.connections[0]).toMatchObject({ spark: [], switchedOn: true, paper: { cashPerTrade: 10_000, custom: false }, stats: { trades: 1, profitFactor: null } });
    expect(old).toMatchObject({ daily: [], reasons: [], hours: [], equity: [], strategies: [] });
  });

  it('keeps rules in step with the strategy and validates the plan', () => {
    const plan = defaultPaperPlan(grouped, true);
    // A group removed from the strategy drops its rule; one kept keeps its settings.
    const oneGroup = { ...grouped, expression: { type: 'OR', id: 'root', children: [bear, cond(field(legSeries('A')), 'GT', num(1))] } } as StrategyDefinition;
    const rules = resolveRules(oneGroup, [...plan.rules.map((r) => ({ ...r, side: 'SELL' as const }))]);
    expect(rules[0]).toEqual({ group: bear.id, leg: 'C', side: 'SELL' });
    expect(rules[1]).toMatchObject({ leg: 'A', side: 'BUY' });
    expect(paperPlanSchema.safeParse(plan).success).toBe(true);
    expect(paperPlanSchema.safeParse({ ...plan, squareOffNse: '3:20pm' }).success).toBe(false);
    expect(paperPlanSchema.safeParse({ ...plan, cashPerTrade: 50 }).success).toBe(false);
    expect(PAPER_DEFAULTS.cashPerTrade).toBe(10_000);
    // Trailing SL: off by default; on needs a target and a trailing % or rule.
    expect(plan.trailing).toBe(false);
    const withRule = { ...plan, trailing: true, rules: plan.rules.map((r) => ({ ...r, stopWhen: cond(field(legSeries('B')), 'LT', num(95)) })) };
    expect(paperPlanSchema.safeParse(withRule).success).toBe(true);
    expect(paperPlanSchema.safeParse({ ...withRule, targetPct: null }).success).toBe(false);
    expect(paperPlanSchema.safeParse({ ...plan, trailing: true }).success).toBe(false); // no trailing rule
  });

  it('plans saved before the Trailing SL switch: trailing rules switch it on; the removed trailing % is dropped', () => {
    const { trailing: _t, ...old } = defaultPaperPlan(grouped, true);
    const withPct = normalizePlan({ ...old, trailPct: 10 } as unknown as PaperPlan);
    expect(withPct.trailing).toBe(false);
    expect('trailPct' in withPct).toBe(false);
    expect(normalizePlan({ ...old, rules: [{ group: bull.id, leg: 'B', side: 'BUY', stopWhen: cond(field(legSeries('B')), 'LT', num(95)) }] } as PaperPlan).trailing).toBe(true);
    expect(normalizePlan(old as PaperPlan).trailing).toBe(false);
    // Rules but no target: Trailing SL can't run — it stays off (the rules are kept).
    expect(normalizePlan({ ...old, targetPct: null, rules: [{ group: bull.id, leg: 'B', side: 'BUY', stopWhen: cond(field(legSeries('B')), 'LT', num(95)) }] } as PaperPlan).trailing).toBe(false);
    // A client that leaves the switch out gets the same answer through the API as a saved plan.
    const parsed = paperPlanSchema.parse({ ...old, rules: [{ group: bull.id, leg: 'B', side: 'BUY', stopWhen: cond(field(legSeries('B')), 'LT', num(95)) }] });
    expect(parsed.trailing).toBeUndefined();
    expect(normalizePlan(parsed).trailing).toBe(true);
    // An explicit switch wins: off keeps the rules in the plan but trades without them.
    expect(normalizePlan({ ...old, trailing: false, rules: [{ group: bull.id, leg: 'B', side: 'BUY', stopWhen: cond(field(legSeries('B')), 'LT', num(95)) }] }).trailing).toBe(false);
  });
});
