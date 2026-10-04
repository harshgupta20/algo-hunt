/**
 * Trader filters on alerts, signals and paper trades: strategy, product type, market, symbol search,
 * trigger timeframe, IST date range, the group that fired, candle source, delivery status, signal
 * outcome and Buy / Sell — plus the paper summary narrowed the same way.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { EvaluationSource, PaperTrade, Timeframe, UnitEvaluation, V2Alert } from '../../src/shared/v2';
import { filterParams, pageCursor } from '../../src/shared/v2';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { V2Service } from '../../src/server/v2/V2Service';
import { FixtureV2Provider, MemoryV2Store, RecordingChannels, fut, ist, ladder, spot } from '../helpers/v2Fakes';

const ALL = [spot('NSE:NIFTY', 'NIFTY 50'), fut('NSE:NIFTY', '2026-10-27'), ...ladder('NSE:NIFTY', '2026-10-13', 25_000, 25_000, 50), spot('NSE:RELIANCE', 'RELIANCE'), fut('MCX:GOLD', '2026-12-04', 'MCX')];

function evaluation(productId: string, fired: 'bull' | 'bear', source?: EvaluationSource): UnitEvaluation {
  return {
    strategyId: 's',
    version: 1,
    productId,
    unit: { key: 'k', productId, expiry: null, baseStrike: null, shift: 0, legs: {} },
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
        { id: 'g-bull', type: 'AND', label: 'Bullish', result: fired === 'bull' ? 'TRUE' : 'FALSE' },
        { id: 'g-bear', type: 'AND', label: 'Bearish', result: fired === 'bear' ? 'TRUE' : 'FALSE' },
      ],
    },
    prices: {},
    source,
  };
}

describe('trader filters', () => {
  const clock = { now: ist('2026-10-07', '11:00') };
  let store: MemoryV2Store;
  let svc: V2Service;

  async function alert(productId: string, o: { day: string; tf?: Timeframe; fired?: 'bull' | 'bear'; source?: EvaluationSource; status?: V2Alert['status']; strategyId?: string }) {
    clock.now = ist(o.day, '11:00');
    const e = evaluation(productId, o.fired ?? 'bull', o.source);
    const sig = await store.signals.insert({ identity: `${productId}|${o.day}|${o.tf}|${o.fired}|${Math.random()}`, connectionId: 'c', strategyId: o.strategyId ?? 's1', version: 1, unitKey: 'k', triggerTimeframe: o.tf ?? '15m', candleTime: 0, outcome: o.status === 'FAILED' ? 'SUPPRESSED_COOLDOWN' : 'ALERTED', evaluation: e });
    await store.alerts.insert({ signalId: sig!.id, connectionId: 'c', strategyId: o.strategyId ?? 's1', strategyName: 'S', version: 1, productId, status: o.status ?? 'SENT', unit: e.unit, triggerTimeframe: o.tf ?? '15m', candleTime: 0, evaluation: e });
  }

  beforeEach(async () => {
    store = new MemoryV2Store(() => clock.now);
    const provider = new FixtureV2Provider(ALL, { RELIANCE: 'RELIANCE INDUSTRIES' });
    svc = new V2Service({ store, provider, products: new ProductService(store, provider), channels: new RecordingChannels(), clock: () => clock.now });
    await svc.syncProducts();
    await alert('NSE:NIFTY', { day: '2026-10-05', fired: 'bull', source: 'LIVE_VERIFIED' });
    await alert('NSE:NIFTY', { day: '2026-10-06', fired: 'bear', tf: '5m' });
    await alert('NSE:RELIANCE', { day: '2026-10-06', fired: 'bull', status: 'FAILED' });
    await alert('MCX:GOLD', { day: '2026-10-07', fired: 'bear', strategyId: 's2' });
  });

  const products = (list: Array<{ productId: string }>) => list.map((a) => a.productId);

  it('alerts by type, market, symbol, timeframe, strategy and IST dates', async () => {
    expect(products(await svc.alerts({ kinds: ['INDEX'] }))).toEqual(['NSE:NIFTY', 'NSE:NIFTY']);
    expect(products(await svc.alerts({ kinds: ['STOCK', 'COMMODITY'] }))).toEqual(['MCX:GOLD', 'NSE:RELIANCE']);
    expect(products(await svc.alerts({ markets: ['MCX'] }))).toEqual(['MCX:GOLD']);
    expect(products(await svc.alerts({ search: 'rel' }))).toEqual(['NSE:RELIANCE']);
    expect(products(await svc.alerts({ timeframes: ['5m'] }))).toEqual(['NSE:NIFTY']);
    expect(products(await svc.alerts({ strategyId: 's2' }))).toEqual(['MCX:GOLD']);
    expect(products(await svc.alerts({ from: '2026-10-06', to: '2026-10-06' })).sort()).toEqual(['NSE:NIFTY', 'NSE:RELIANCE']); // same minute: either order
    expect(products(await svc.alerts({ from: '2026-10-07' }))).toEqual(['MCX:GOLD']);
  });

  it('alerts by the group that fired, candle source and delivery status', async () => {
    expect(products(await svc.alerts({ groups: ['g-bear'] }))).toEqual(['MCX:GOLD', 'NSE:NIFTY']);
    expect(products(await svc.alerts({ groups: ['g-bull'], kinds: ['INDEX'] }))).toEqual(['NSE:NIFTY']);
    expect(products(await svc.alerts({ sources: ['LIVE_VERIFIED'] }))).toEqual(['NSE:NIFTY']);
    expect((await svc.alerts({ sources: ['HISTORICAL'] })).length).toBe(3); // no source recorded = Kite candles
    expect(products(await svc.alerts({ statuses: ['FAILED'] }))).toEqual(['NSE:RELIANCE']);
  });

  it('signals by outcome and product filters', async () => {
    expect(products((await svc.signals({ outcomes: ['SUPPRESSED_COOLDOWN'] })).map((s) => s.evaluation))).toEqual(['NSE:RELIANCE']);
    expect(products((await svc.signals({ markets: ['NSE'], groups: ['g-bull'] })).map((s) => s.evaluation))).toEqual(['NSE:RELIANCE', 'NSE:NIFTY']);
  });

  it('paper trades and the paper summary follow the same filters (plus Buy / Sell)', async () => {
    const base = (productId: string, side: 'BUY' | 'SELL', entry: string, group: string, pnl: number): Omit<PaperTrade, 'id'> =>
      ({
        strategyId: 's1',
        connectionId: productId,
        productId,
        slot: `shift:${Math.random()}`,
        unitKey: 'k',
        alertId: null,
        group,
        leg: 'A',
        side,
        instrument: ALL.find((i) => i.productId === productId)!,
        lots: 1,
        lotSize: 1,
        quantity: 1,
        cashPerTrade: 10_000,
        capitalUsed: 1_000,
        marginEstimated: false,
        overBudget: false,
        entryAt: new Date(ist(entry, '10:00')).toISOString(),
        entryRef: 100,
        entryPrice: 100,
        targetPrice: null,
        stopPrice: null,
        terms: { targetPct: null, stopPct: null, squareOff: true, squareOffNse: '15:20', squareOffMcx: '23:20', exitOnOpposite: true, charges: false, slippagePct: 0 },
        status: 'CLOSED',
        lastPrice: 100,
        lastPriceAt: null,
        exitAt: new Date(ist(entry, '11:00')).toISOString(),
        exitPrice: 100 + pnl,
        exitReason: 'TARGET',
        grossPnl: pnl,
        charges: 0,
        netPnl: pnl,
      }) as Omit<PaperTrade, 'id'>;
    await store.paper.insertTrade(base('NSE:NIFTY', 'BUY', '2026-10-05', 'g-bull', 500));
    await store.paper.insertTrade(base('NSE:RELIANCE', 'SELL', '2026-10-06', 'g-bear', -200));
    await store.paper.insertTrade(base('MCX:GOLD', 'BUY', '2026-10-07', 'g-bull', 300));

    expect(products(await svc.paperTrades({ markets: ['NSE'] }))).toEqual(['NSE:RELIANCE', 'NSE:NIFTY']);
    expect(products(await svc.paperTrades({ sides: ['SELL'] }))).toEqual(['NSE:RELIANCE']);
    expect(products(await svc.paperTrades({ groups: ['g-bull'], to: '2026-10-06' }))).toEqual(['NSE:NIFTY']);
    const sum = await svc.paperSummary({ kinds: ['INDEX', 'COMMODITY'] });
    expect(sum.overall).toMatchObject({ trades: 2, netPnl: 800 });
    // Strategy chips: trades per strategy; several strategies at once.
    expect(await svc.paperCounts({ markets: ['NSE'] })).toEqual({ counts: { s1: 2 }, total: 2 });
    expect(products(await svc.paperTrades({ strategyIds: ['s1', 'nope'] })).length).toBe(3);
    expect((await svc.paperSummary({ strategyIds: ['other'] })).overall).toMatchObject({ trades: 0 });

    // Winners / losers, and the trade log a page at a time (the next page = entered before the last trade shown).
    expect(products(await svc.paperTrades({ status: 'CLOSED', result: 'win' }))).toEqual(['MCX:GOLD', 'NSE:NIFTY']);
    expect(products(await svc.paperTrades({ status: 'CLOSED', result: 'loss' }))).toEqual(['NSE:RELIANCE']);
    const first = await svc.paperTrades({ status: 'CLOSED', limit: 2 });
    const last = first.at(-1)!;
    const next = await svc.paperTrades({ status: 'CLOSED', limit: 2, before: pageCursor(last.entryAt, last.id) });
    expect([...products(first), ...products(next)]).toEqual(['MCX:GOLD', 'NSE:RELIANCE', 'NSE:NIFTY']);
    const wins = await svc.paperTrades({ status: 'CLOSED', result: 'win', limit: 1 });
    expect(products(await svc.paperTrades({ status: 'CLOSED', result: 'win', limit: 1, before: pageCursor(wins[0]!.entryAt, wins[0]!.id) }))).toEqual(['NSE:NIFTY']);
    await expect(svc.paperTrades({ before: 'not-a-cursor' })).rejects.toMatchObject({ status: 400 });
  });

  it('several strategies at once; per-strategy counts follow every filter except the strategy choice', async () => {
    expect(products(await svc.alerts({ strategyIds: ['s1', 's2'] })).length).toBe(4);
    expect(products(await svc.alerts({ strategyIds: ['s2'] }))).toEqual(['MCX:GOLD']);
    expect(products((await svc.signals({ strategyIds: ['s2'] })).map((s) => s.evaluation))).toEqual(['MCX:GOLD']);
    // Counts: the chosen strategies don't change them (each chip keeps its number) — the other filters do.
    expect(await svc.alertCounts({ strategyIds: ['s2'] })).toEqual({ counts: { s1: 3, s2: 1 }, total: 4 });
    expect(await svc.alertCounts({ markets: ['NSE'] })).toEqual({ counts: { s1: 3 }, total: 3 });
    expect(await svc.alertCounts({ from: '2026-10-07' })).toEqual({ counts: { s2: 1 }, total: 1 });
    expect(await svc.alertCounts({ statuses: ['FAILED'] })).toEqual({ counts: { s1: 1 }, total: 1 });
    expect((await svc.signalCounts({ outcomes: ['ALERTED'] })).counts).toEqual({ s1: 2, s2: 1 });
  });

  it('alerts a page at a time: the same rows in the same order as one long list, whatever the filters', async () => {
    const all = await svc.alerts({ limit: 100 });
    const pages: string[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await svc.alerts({ limit: 1, before });
      pages.push(...page.map((a) => a.id));
      if (page.length < 1) break;
      before = pageCursor(page[0]!.createdAt, page[0]!.id);
    }
    expect(pages).toEqual(all.map((a) => a.id));
    const nse = await svc.alerts({ markets: ['NSE'], limit: 2 });
    const rest = await svc.alerts({ markets: ['NSE'], limit: 2, before: pageCursor(nse[1]!.createdAt, nse[1]!.id) });
    expect([...nse, ...rest].map((a) => a.productId).sort()).toEqual(['NSE:NIFTY', 'NSE:NIFTY', 'NSE:RELIANCE']);
    expect(products((await svc.signals({ outcomes: ['ALERTED'], limit: 1, before: pageCursor(all[0]!.createdAt, 'ffffffff-ffff-ffff-ffff-ffffffffffff') })).map((s) => s.evaluation))).toHaveLength(1);
  });

  it('the client writes lists comma-separated and skips empty filters', () => {
    expect(filterParams({ kinds: ['INDEX', 'STOCK'], markets: [], search: '', active: true, from: '2026-10-01', strategyId: undefined }).toString()).toBe('kinds=INDEX%2CSTOCK&active=1&from=2026-10-01');
  });
});
