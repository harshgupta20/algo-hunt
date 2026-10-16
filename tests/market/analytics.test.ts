import { describe, expect, it } from 'vitest';
import { deriveMovers, inUniverse, moveStep, oiBuildup, optionStats, pivotLevels, sectorStats, squarify } from '@/shared/market/analytics';
import { indexMeta } from '@/shared/market/indices';
import { marketStory, vixBand } from '@/shared/market/story';
import type { MapStock, MarketOverview, IndexQuote } from '@/shared/market/types';

const stock = (o: Partial<MapStock> & { symbol: string }): MapStock => ({
  name: o.symbol,
  sector: 'IT',
  ltp: 100,
  pct: 0,
  change: 0,
  open: 100,
  high: 101,
  low: 99,
  prevClose: 100,
  value: 1e7,
  volume: 1000,
  groups: [],
  fno: false,
  circuit: null,
  alerts: 0,
  ...o,
});

describe('pivots / CPR', () => {
  it('computes the classic levels from high, low and close', () => {
    const p = pivotLevels('NIFTY 50', 'Nifty 50', { date: '2026-10-15', high: 23056.4, low: 22637.4, close: 22997.35 }, 23100);
    // P = (H + L + C) / 3
    expect(p.pivot).toBeCloseTo((23056.4 + 22637.4 + 22997.35) / 3, 1);
    expect(p.r1).toBeCloseTo(2 * p.pivot - 22637.4, 1);
    expect(p.s1).toBeCloseTo(2 * p.pivot - 23056.4, 1);
    expect(p.r2).toBeCloseTo(p.pivot + (23056.4 - 22637.4), 1);
    expect(p.bc).toBeLessThanOrEqual(p.tc);
    expect(p.position).toBe('above');
    expect(p.cprWidthPct).toBeGreaterThan(0);
  });

  it('places the price against the central pivot range', () => {
    const basis = { date: 'd', high: 110, low: 90, close: 100 };
    expect(pivotLevels('X', 'X', basis, 100).position).toBe('inside');
    expect(pivotLevels('X', 'X', basis, 80).position).toBe('below');
    expect(pivotLevels('X', 'X', basis, null).position).toBeNull();
  });
});

describe('option chain', () => {
  const rows = [
    { strike: 100, callOi: 10, putOi: 500, callLtp: 22, putLtp: 1 },
    { strike: 110, callOi: 100, putOi: 300, callLtp: 13, putLtp: 3 },
    { strike: 120, callOi: 400, putOi: 200, callLtp: 6, putLtp: 6 },
    { strike: 130, callOi: 900, putOi: 50, callLtp: 2, putLtp: 12 },
  ];

  it('finds ATM, PCR, the OI walls and the straddle', () => {
    const s = optionStats(rows, 119);
    expect(s.atm).toBe(120);
    expect(s.pcr).toBeCloseTo(1050 / 1410, 2);
    expect(s.callWall).toEqual({ strike: 130, oi: 900 });
    expect(s.putWall).toEqual({ strike: 100, oi: 500 });
    expect(s.straddle).toEqual({ strike: 120, call: 6, put: 6, total: 12, movePct: 10.08 });
  });

  it('max pain is the strike where option writers pay the least', () => {
    // Brute force the payout at each strike.
    const pay = (at: number) => rows.reduce((a, r) => a + r.callOi * Math.max(0, at - r.strike) + r.putOi * Math.max(0, r.strike - at), 0);
    const best = rows.map((r) => r.strike).reduce((b, k) => (pay(k) < pay(b) ? k : b));
    expect(optionStats(rows, 119).maxPain).toBe(best);
  });

  it('copes with an empty chain', () => {
    expect(optionStats([], 100)).toEqual({ atm: 100, pcr: null, maxPain: null, callWall: null, putWall: null, straddle: null });
  });
});

describe('OI build-up', () => {
  it('names the four price × open-interest cases', () => {
    expect(oiBuildup(2, 5)).toBe('long');
    expect(oiBuildup(-2, 5)).toBe('short');
    expect(oiBuildup(2, -5)).toBe('covering');
    expect(oiBuildup(-2, -5)).toBe('unwinding');
  });
});

describe('stocks', () => {
  it('filters by universe', () => {
    const s = stock({ symbol: 'A', groups: ['N50'], fno: true });
    expect(inUniverse(s, 'nifty50')).toBe(true);
    expect(inUniverse(s, 'nifty100')).toBe(true);
    expect(inUniverse(s, 'midcap150')).toBe(false);
    expect(inUniverse(s, 'fno')).toBe(true);
    expect(inUniverse(stock({ symbol: 'B', groups: ['NN50'] }), 'nifty100')).toBe(true);
  });

  it('summarises sectors (equal-weighted move, breadth, value)', () => {
    const [it0] = sectorStats([stock({ symbol: 'A', pct: 2, value: 10 }), stock({ symbol: 'B', pct: -1, value: 30 }), stock({ symbol: 'C', pct: 0.5, value: 5 })]);
    expect(it0).toMatchObject({ sector: 'IT', count: 3, advances: 2, declines: 1, avgPct: 0.5, value: 45 });
    expect(it0!.best!.symbol).toBe('A');
    expect(it0!.worst!.symbol).toBe('B');
  });

  it('derives gainers, gaps and open = low / open = high setups', () => {
    const m = deriveMovers([
      stock({ symbol: 'UP', pct: 3, open: 100, low: 100, high: 104, ltp: 103, prevClose: 100 }),
      stock({ symbol: 'DOWN', pct: -2, open: 100, high: 100, low: 97, ltp: 98, prevClose: 100 }),
      stock({ symbol: 'GAP', pct: 2, open: 103, low: 101, high: 104, ltp: 102, prevClose: 100 }),
      stock({ symbol: 'UC', pct: 20, circuit: 'upper', ltp: 120 }),
    ]);
    expect(m.gainers.map((s) => s.symbol)).toEqual(['UC', 'UP', 'GAP']);
    expect(m.losers.map((s) => s.symbol)).toEqual(['DOWN']);
    expect(m.gapUp.map((s) => s.symbol)).toEqual(['GAP']);
    expect(m.openLow.map((s) => s.symbol)).toEqual(['UP']);
    expect(m.openHigh.map((s) => s.symbol)).toEqual(['DOWN']);
    expect(m.upperCircuit.map((s) => s.symbol)).toEqual(['UC']);
  });
});

describe('treemap', () => {
  it('fills the box exactly, one tile per value, areas proportional', () => {
    const values = [60, 30, 25, 10, 5, 0];
    const box = { x: 0, y: 0, w: 300, h: 200 };
    const rects = squarify(values, box);
    expect(rects).toHaveLength(values.length);
    const total = values.reduce((a, v) => a + v, 0);
    rects.forEach((r, i) => {
      expect(r.w * r.h).toBeCloseTo((values[i]! / total) * 300 * 200, 3);
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(300 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(200 + 1e-6);
    });
    // Tiles don't overlap.
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 1e-6 && oy > 1e-6).toBe(false);
      }
  });

  it('handles nothing to draw', () => {
    expect(squarify([0, 0], { x: 0, y: 0, w: 10, h: 10 })).toEqual([
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ]);
  });

  it('steps colour intensity by the size of the move', () => {
    expect([0.1, -0.5, 1.5, -2.5, 4, -9].map(moveStep)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('index names', () => {
  it('groups NSE indices', () => {
    expect(indexMeta('NIFTY IT')).toEqual({ group: 'sector', name: 'IT' });
    expect(indexMeta('NIFTY IND DEFENCE')).toEqual({ group: 'theme', name: 'Defence' });
    expect(indexMeta('NIFTY200MOMENTM30')).toEqual({ group: 'style', name: 'Momentum' });
    expect(indexMeta('NIFTY 50').group).toBe('broad');
    expect(indexMeta('NIFTY GS 10YR').group).toBe('other');
  });
});

describe('market story', () => {
  const q = (symbol: string, o: Partial<IndexQuote>): IndexQuote => ({ symbol, ...indexMeta(symbol), last: 100, change: 0, pct: 0, open: null, high: null, low: null, prevClose: null, yearHigh: null, yearLow: null, advances: null, declines: null, unchanged: null, pe: null, pb: null, dy: null, pct1w: null, pct1m: null, pct1y: null, ...o });
  const overview = (indices: IndexQuote[]): MarketOverview => ({
    at: '',
    status: { session: 'closed', label: '', tradeDate: '2026-10-15' },
    headline: [],
    indices,
    highsLows: { highs: 69, lows: 12 },
    flows: { latest: { date: '2026-10-15', fii: { buy: 1, sell: 2, net: -5285.37 }, dii: { buy: 2, sell: 1, net: 3319.39 } }, history: [] },
    participants: [],
    pivots: [],
    futures: [],
    sources: [],
  });

  it('tells a narrow, large-cap-led rise apart from a broad one', () => {
    const narrow = marketStory({ overview: overview([q('NIFTY 50', { last: 23000, pct: 1.2 }), q('NIFTY 500', { advances: 150, declines: 340, unchanged: 10 })]) });
    expect(narrow.find((l) => l.topic === 'breadth')!.text).toMatch(/Narrow move/);
    const broad = marketStory({ overview: overview([q('NIFTY 50', { pct: 1.2 }), q('NIFTY 500', { advances: 400, declines: 90, unchanged: 10 })]) });
    expect(broad.find((l) => l.topic === 'breadth')!.text).toMatch(/Broad buying: 400 of 500/);
  });

  it('names the leading and lagging sectors and the money flows', () => {
    const lines = marketStory({
      overview: overview([q('NIFTY IT', { pct: 3.2 }), q('NIFTY AUTO', { pct: 1.7 }), q('NIFTY REALTY', { pct: -0.8 }), q('NIFTY MEDIA', { pct: -0.5 }), q('NIFTY FMCG', { pct: 0.2 })]),
    });
    expect(lines.find((l) => l.topic === 'sectors')!.text).toBe('3 of 5 sectors up; IT (+3.20%) and Auto (+1.70%) lead, Realty (−0.80%) and Media (−0.50%) lag.');
    expect(lines.find((l) => l.topic === 'flows')!.text).toMatch(/FIIs net sold ₹5,285 Cr, DIIs net bought ₹3,319 Cr/);
    expect(lines.find((l) => l.topic === 'extremes')!.text).toBe('69 stocks hit a 52-week high today, 12 a 52-week low.');
  });

  it('describes India VIX in bands', () => {
    expect(vixBand(11)).toMatch(/very low/);
    expect(vixBand(22)).toMatch(/elevated/);
  });
});
