/**
 * Paper trading: alerts open simulated trades (on for every connection by default, ₹10,000 per trade,
 * each connection can change its own values),
 * sized in whole lots with slippage; they close at the target / stop-loss, when the other group fires,
 * at the intraday square-off or at expiry, net of charges — and the results roll up per connection
 * and strategy.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExprNode, PaperPlan, PaperTrade, StrategyDefinition, UnitEvaluation, V2Connection, V2Product, V2Strategy, V2Unit } from '../../src/shared/v2';
import { PAPER_DEFAULTS, defaultPaperPlan, normalizePaperSummary, paperPlanSchema, resolveRules } from '../../src/shared/v2';
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
    await env.svc.saveConnectionPaper(c.id, { cashPerTrade: 20_000, stopPct: null });
    await env.svc.scan();
    expect(env.store.data.paperTrades[0]).toMatchObject({ lots: 2, quantity: 150, cashPerTrade: 20_000, stopPrice: null, targetPrice: 120.6 });
    const sum = await env.svc.paperSummary();
    expect(sum.connections[0]!.paper).toEqual({ enabled: true, cashPerTrade: 20_000, targetPct: 20, stopPct: null, squareOff: true, custom: true });

    // Back to the strategy's values.
    expect(await env.svc.saveConnectionPaper(c.id, {})).toEqual({ override: null });
    expect((await env.svc.paperSummary()).connections[0]!.paper).toMatchObject({ cashPerTrade: 10_000, custom: false });
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

function trader(start = ist(D, '11:00')) {
  const clock = { now: start };
  const store = new MemoryV2Store(() => clock.now);
  const prices = new Map<number, number>([
    [ceI.token, 100],
    [peI.token, 80],
    [futI.token, 25_000],
    [spotI.token, 24_990],
  ]);
  const t = new PaperTrader({ store, now: () => clock.now, prices: async (list) => new Map(list.flatMap((i) => (prices.has(i.token) ? [[i.token, prices.get(i.token)!] as [number, number]] : []))) });
  const alert = (fired: 'bull' | 'bear') => t.onAlert({ connection, strategy: strat, product, unit, evaluation: evaluation(fired), alertId: null, cal: cals.NSE });
  return { clock, store, prices, t, alert };
}

describe('paper trader', () => {
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

  it('selling a future: estimated margin, flagged over budget, stop above the entry (and the stop wins)', async () => {
    const env = trader();
    await env.store.paper.savePlan('s1', { ...defaultPaperPlan(grouped, true), rules: [{ group: bull.id, leg: 'A', side: 'SELL' }, { group: bear.id, leg: 'C', side: 'BUY' }] });
    expect(await env.alert('bull')).toMatch(/SELL 1 lot \(75\) NIFTY20261027FUT @ ₹24,875 · target ₹19,900 · stop ₹27,362\.5 · 1 lot needs ₹2,23,875 margin \(est\.\)/);
    const [t] = env.store.data.paperTrades;
    expect(t).toMatchObject({ side: 'SELL', entryPrice: 24_875, marginEstimated: true, overBudget: true, capitalUsed: 223_875 });
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
  });
});
