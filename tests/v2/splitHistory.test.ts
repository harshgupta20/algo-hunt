/**
 * The split history (index / stock from Kite, every contract from Upstox) is safe by construction: each instrument
 * has exactly one source, a wrong-source instrument is an error (never quietly redirected), a failure is never
 * answered by the other source; and the Kite vs Upstox comparison joins on the exact candle time.
 */
import { describe, expect, it } from 'vitest';
import type { BacktestResult, PaperTrade, V2Instrument, V2Product } from '../../src/shared/v2';
import type { RawCandle } from '../../src/server/v2/engine/candles';
import type { ContractList, OptionsHistory } from '../../src/server/v2/data/OptionsHistory';
import { SplitHistory, compareCloses } from '../../src/server/v2/data/SplitHistory';
import { mergeBacktests } from '../../src/server/v2/paper/mergeBacktests';
import { upContract, upSpot } from '../helpers/optionsFakes';
import { opt, spot } from '../helpers/v2Fakes';

const P = 'NSE:NIFTY';
const product = { id: P, market: 'NSE', kind: 'INDEX', symbol: 'NIFTY', name: 'Nifty 50', hasSpot: true, hasFutures: true, hasOptions: true } as unknown as V2Product;
const kSpot = spot(P, 'NIFTY 50');
const uSpot = upSpot(P, 'NSE_INDEX|Nifty 50', 'NIFTY');
const uCall = upContract(P, '2026-11-10', 'CE', 25_000, 75);
const c = (time: number, close: number): RawCandle => ({ time, open: close, high: close, low: close, close, volume: 1 });

function fakes(o: { kiteList?: V2Instrument[]; upstoxFails?: boolean; contracts?: V2Instrument[] } = {}) {
  const calls: string[] = [];
  const upstox: OptionsHistory = {
    name: 'Upstox',
    async contracts(): Promise<ContractList> {
      return { spot: uSpot, contracts: o.contracts ?? [uCall], coveredFrom: '2026-01-01', gaps: [], notes: [] };
    },
    async candles(inst) {
      calls.push(`upstox:${inst.symbol}`);
      if (o.upstoxFails) throw new Error('Upstox: 503');
      return [c(1, 100)];
    },
  };
  const kite = {
    instruments: async () => o.kiteList ?? [kSpot, opt(P, '2026-11-10', 25_000, 'CE')],
    candles: async (q: { instrument: V2Instrument }) => (calls.push(`kite:${q.instrument.symbol}`), [c(1, 101)]),
  };
  return { split: new SplitHistory(upstox, kite), calls };
}

describe('split history', () => {
  it('the index / stock is Kite’s own instrument; the contracts are Upstox’s', async () => {
    const { split } = fakes();
    const list = await split.contracts(product, { from: '2026-11-01', to: '2026-11-05' }, { options: true, futures: false });
    expect(list.spot).toBe(kSpot);
    expect(list.contracts).toEqual([uCall]);
    expect(split.spotName).toBe('Kite');
  });

  it('each instrument is read from its one source; a wrong-source instrument is an error, not a redirect', async () => {
    const { split, calls } = fakes();
    expect(await split.candles(kSpot, '1m', '2026-11-03', '2026-11-03')).toEqual([c(1, 101)]);
    expect(await split.candles(uCall, '1m', '2026-11-03', '2026-11-03')).toEqual([c(1, 100)]);
    expect(calls).toEqual(['kite:NIFTY 50', `upstox:${uCall.symbol}`]);
    await expect(split.candles(uSpot, '1m', '2026-11-03', '2026-11-03')).rejects.toThrow(/index \/ stock price is read from Kite only/);
    await expect(split.candles(opt(P, '2026-11-10', 25_000, 'CE'), '1m', '2026-11-03', '2026-11-03')).rejects.toThrow(/contracts are read from Upstox only/);
  });

  it('no fallback: an Upstox failure stays a failure (Kite is never asked for the contract)', async () => {
    const { split, calls } = fakes({ upstoxFails: true });
    await expect(split.candles(uCall, '1m', '2026-11-03', '2026-11-03')).rejects.toThrow('Upstox: 503');
    expect(calls).toEqual([`upstox:${uCall.symbol}`]);
  });

  it('refuses a product Kite lists no index / stock for, and a contract that isn’t the product’s own', async () => {
    await expect(fakes({ kiteList: [] }).split.contracts(product, { from: '2026-11-01', to: '2026-11-05' }, { options: true, futures: false })).rejects.toThrow(/Kite lists no index \/ stock for NIFTY/);
    const other = upContract('NSE:BANKNIFTY', '2026-11-10', 'CE', 55_000, 30);
    await expect(fakes({ contracts: [other] }).split.contracts(product, { from: '2026-11-01', to: '2026-11-05' }, { options: true, futures: false })).rejects.toThrow(/isn’t one of NIFTY’s Upstox contracts/);
  });
});

describe('Kite vs Upstox comparison', () => {
  it('joins on the exact candle time: median and largest gap, share within a tick', () => {
    const kite = Array.from({ length: 12 }, (_, i) => c(i * 60, 100));
    // Upstox: one minute missing (not matched), one 0.05 apart (a tick), one 1.0 apart.
    const up = kite.filter((k) => k.time !== 0).map((k) => (k.time === 60 ? c(k.time, 100.05) : k.time === 120 ? c(k.time, 101) : k));
    expect(compareCloses(kite, up, 0.05)).toEqual({ matched: 11, medianDiffPct: 0, maxDiffPct: 1, withinTickPct: 90.9091, ok: true });
  });

  it('flags a median gap over 0.25 % or fewer than 80 % within a tick; too few candles can’t decide', () => {
    const kite = Array.from({ length: 10 }, (_, i) => c(i * 60, 100));
    expect(compareCloses(kite, kite.map((k) => c(k.time, 100.5)), 0.05)).toMatchObject({ medianDiffPct: 0.5, ok: false });
    expect(compareCloses(kite, kite.map((k, i) => c(k.time, i < 3 ? 100.1 : 100)), 0.05)).toMatchObject({ withinTickPct: 70, ok: false });
    expect(compareCloses(kite.slice(0, 5), kite.slice(0, 5), 0.05)).toMatchObject({ matched: 5, ok: null });
    expect(compareCloses(kite, [], 0.05)).toEqual({ matched: 0, medianDiffPct: null, maxDiffPct: null, withinTickPct: null, ok: null });
  });

  it('check(): a contract both list is compared on its own minutes; when every one used has expired it says so', async () => {
    const { split } = fakes();
    await split.contracts(product, { from: '2026-11-01', to: '2026-11-05' }, { options: true, futures: false });
    const rows = await split.check({ product, days: ['2026-11-04', '2026-11-05'], interval: '15m', used: [uCall], traded: [uCall] });
    expect(rows.map((r) => [r.what, r.matched])).toEqual([
      ['NIFTY 50 (index / stock), 15-minute closes', 1],
      [`${opt(P, '2026-11-10', 25_000, 'CE').symbol} (contract), 1-minute closes`, 1],
    ]);
    const expired = upContract(P, '2026-10-27', 'CE', 25_000, 75);
    const none = await split.check({ product, days: ['2026-11-04'], interval: '15m', used: [expired], traded: [] });
    expect(none[1]).toMatchObject({ ok: null, note: expect.stringMatching(/Every contract this run used has expired/) });
  });
});

describe('merging the routed parts', () => {
  const trade = (productId: string, net: number, at: string): PaperTrade =>
    ({ id: `${productId}-${at}`, productId, status: 'CLOSED', entryAt: at, exitAt: at, netPnl: net, grossPnl: net, charges: 0, capitalUsed: 1000, exitReason: 'TARGET' }) as unknown as PaperTrade;
  const part = (source: 'SPLIT' | 'KITE', productId: string, trades: PaperTrade[]): BacktestResult =>
    ({ strategyId: 's', strategyName: 'S', from: '2026-11-03', to: '2026-11-04', triggerTimeframe: '15m', summary: {} as never, products: [{ productId, data: source, stats: { netPnl: trades.reduce((a, t) => a + (t.netPnl ?? 0), 0) } }], trades, skipped: [], requests: 2, source, notes: [`${source} note`] }) as unknown as BacktestResult;

  it('totals are recomputed over every trade; each product keeps its source', () => {
    const r = mergeBacktests([part('SPLIT', 'NSE:NIFTY', [trade('NSE:NIFTY', 500, '2026-11-03T05:00:00.000Z')]), part('KITE', 'MCX:GOLD', [trade('MCX:GOLD', -200, '2026-11-04T05:00:00.000Z')])], Date.parse('2026-11-05T00:00:00Z'));
    expect(r.source).toBe('MIXED');
    expect(r.summary.overall).toMatchObject({ trades: 2, netPnl: 300, wins: 1, losses: 1 });
    expect(r.products.map((p) => [p.productId, p.data])).toEqual([
      ['NSE:NIFTY', 'SPLIT'],
      ['MCX:GOLD', 'KITE'],
    ]);
    expect(r.requests).toBe(4);
    expect(r.notes).toEqual(['SPLIT note', 'KITE note']);
  });
});
