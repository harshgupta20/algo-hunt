/**
 * The equity service end to end on fake Kite data: the stock list (equity series only, presets), strategies
 * checked before saving, watchlists, backtests and screens as jobs (progress, candle cache, cancel), and the
 * data rules (warm-up history, only finished sessions).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EqBacktestJob, EqScreenJob, EqStrategyDefinition } from '../../src/shared/equity';
import { EQ_TEMPLATES, all, cond, defaultDefinition, ind, num, price } from '../../src/shared/equity';
import { CandleCache, lastFinishedSession, type DailySource } from '../../src/server/equity/data/candles';
import { Universe, stocksFromKite } from '../../src/server/equity/data/universe';
import { EquityService, warmupDays } from '../../src/server/equity/EquityService';
import { MemoryEquityStore } from '../../src/server/equity/store/MemoryEquityStore';

const ist = (date: string, hhmm = '09:00') => Date.parse(`${date}T${hhmm}:00+05:30`);

const KITE_ROWS = [
  { instrument_token: 1, tradingsymbol: 'AAA', name: 'AAA LTD', segment: 'NSE', instrument_type: 'EQ' },
  { instrument_token: 2, tradingsymbol: 'BBB', name: 'BBB LTD', segment: 'NSE', instrument_type: 'EQ' },
  { instrument_token: 3, tradingsymbol: 'BAJAJ-AUTO', name: 'BAJAJ AUTO', segment: 'NSE', instrument_type: 'EQ' },
  { instrument_token: 4, tradingsymbol: 'XYZ-BE', name: 'XYZ', segment: 'NSE', instrument_type: 'EQ' },
  { instrument_token: 5, tradingsymbol: '736GS2027-GS', name: 'GOI', segment: 'NSE', instrument_type: 'EQ' },
  { instrument_token: 99, tradingsymbol: 'NIFTY 50', name: 'NIFTY 50', segment: 'INDICES', instrument_type: 'EQ' },
];

/** Weekday closes from `start`: a slow rise, so SMA(5) crosses above SMA(10) after a dip. */
function candles(start: string, closes: number[]) {
  const out = [];
  let d = Date.parse(`${start}T00:00:00Z`);
  for (const c of closes) {
    while ([0, 6].includes(new Date(d).getUTCDay())) d += 86_400_000;
    const date = new Date(d).toISOString().slice(0, 10);
    out.push({ time: Date.parse(`${date}T00:00:00+05:30`) / 1000, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 });
    d += 86_400_000;
  }
  return out;
}

class FakeKite implements DailySource {
  calls: Array<{ token: number; from: string; to: string }> = [];
  data = new Map<number, ReturnType<typeof candles>>();
  delayMs = 0;
  async getCandles(q: { token: number; from: string; to: string }) {
    this.calls.push(q);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return (this.data.get(q.token) ?? []).filter((c) => {
      const date = new Date(c.time * 1000 + 5.5 * 3600_000).toISOString().slice(0, 10);
      return date >= q.from && date <= q.to;
    });
  }
}

const CLOSES = [...Array(15).fill(100), 99, 98, 97, 96, 95, 96, 98, 101, 104, 107, 110, 113, 116, 119, 122, 125, 123, 120, 116, 112, 108, 104];
const cross: EqStrategyDefinition = {
  ...defaultDefinition(),
  name: 'SMA 5 / 10',
  entry: { when: all('e', cond('e1', ind('SMA', { period: 5 }), 'CROSSES_ABOVE', ind('SMA', { period: 10 }))), trigger: 'WHEN_TRUE' },
  exit: { targetPct: null, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: all('x', cond('x1', ind('SMA', { period: 5 }), 'CROSSES_BELOW', ind('SMA', { period: 10 }))), maxBars: null },
  sizing: { mode: 'QUANTITY', value: 10 },
  costs: { charges: false, slippagePct: 0 },
};

async function settle<T extends { status: string }>(get: () => T): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const j = get();
    if (j.status !== 'RUNNING') return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job did not finish');
}

describe('equity service', () => {
  let kite: FakeKite;
  let svc: EquityService;
  let connected: boolean;
  const clock = { now: ist('2025-04-01', '18:00') };

  beforeEach(() => {
    kite = new FakeKite();
    connected = true;
    kite.data.set(1, candles('2025-01-01', CLOSES));
    kite.data.set(2, candles('2025-01-01', CLOSES.map((c) => c * 2)));
    kite.data.set(99, candles('2025-01-01', CLOSES.map((c) => c * 200)));
    const universe = new Universe({
      kite: async (fn) => fn({ getInstruments: async () => KITE_ROWS }),
      lists: async () => [{ symbol: 'AAA', sector: 'Banks', groups: ['N50'] }],
      fno: async () => ['BBB'],
      file: join(mkdtempSync(join(tmpdir(), 'eq-')), 'equity-instruments.json'),
      now: () => clock.now,
    });
    svc = new EquityService({ store: new MemoryEquityStore(() => clock.now), universe, candles: new CandleCache(kite, () => clock.now), kiteConnected: async () => connected, now: () => clock.now });
  });

  it('the stock list keeps NSE equity series only (BAJAJ-AUTO yes, -BE / bonds no) with presets and sectors', async () => {
    expect(stocksFromKite(KITE_ROWS as never).map((s) => s.symbol)).toEqual(['AAA', 'BAJAJ-AUTO', 'BBB']);
    const { stocks } = await svc.stocks({});
    expect(stocks.find((s) => s.symbol === 'AAA')).toMatchObject({ sector: 'Banks', presets: ['ALL', 'NIFTY500', 'NIFTY50', 'NIFTY100'] });
    expect(stocks.find((s) => s.symbol === 'BBB')!.presets).toEqual(['ALL', 'FNO']);
    expect((await svc.stocks({ preset: 'FNO' })).stocks.map((s) => s.symbol)).toEqual(['BBB']);
    expect((await svc.stocks({ search: 'baj' })).stocks.map((s) => s.symbol)).toEqual(['BAJAJ-AUTO']);
    const presets = await svc.presets();
    expect(presets.find((p) => p.preset === 'NIFTY50')).toMatchObject({ count: 1 });
    expect(presets.find((p) => p.preset === 'ALL')).toMatchObject({ count: 3 });
  });

  it('strategies are checked before saving; every template is valid', async () => {
    for (const t of EQ_TEMPLATES) expect(svc.validate(t.definition).filter((i) => i.severity === 'error'), t.key).toEqual([]);
    await expect(svc.createStrategy({ ...cross, name: ' ' })).rejects.toMatchObject({ status: 400, message: 'Give the strategy a name' });
    const bad = { ...cross, entry: { ...cross.entry, when: all('e', cond('e1', ind('RSI', { period: 14 }), 'GT', price('close'))) } };
    await expect(svc.createStrategy(bad)).rejects.toMatchObject({ status: 400, message: 'RSI(14) > Close: compares a 0–100 oscillator with a price' });
    const s = await svc.createStrategy(cross);
    expect(s.version).toBe(1);
    expect((await svc.updateStrategy(s.id, { ...cross, name: 'Renamed' })).version).toBe(2);
    expect((await svc.duplicateStrategy(s.id)).name).toBe('Renamed (copy)');
    expect(await svc.listStrategies()).toHaveLength(2);
  });

  it('watchlists keep known NSE symbols (cleaned) and refuse unknown ones', async () => {
    const w = await svc.createWatchlist({ name: ' Swing ', symbols: ['aaa', 'BBB', 'AAA'] });
    expect(w).toMatchObject({ name: 'Swing', symbols: ['AAA', 'BBB'] });
    await expect(svc.createWatchlist({ name: 'x', symbols: ['NOPE'] })).rejects.toMatchObject({ status: 400, message: 'Not NSE stocks: NOPE' });
  });

  it('a backtest runs as a job: warm-up history, progress, the result; a re-run comes from memory', async () => {
    const req = { definition: cross, symbols: ['AAA', 'BBB', 'NOPE'], from: '2025-01-20', to: '2025-03-31', capital: 1_000_000, maxPositions: null };
    const job = await svc.startBacktest(req);
    expect(job).toMatchObject({ status: 'RUNNING', kind: 'BACKTEST', total: 2, strategyName: 'SMA 5 / 10' });
    const done = (await settle(() => svc.backtestJob(job.id))) as EqBacktestJob;
    expect(done.status).toBe('DONE');
    const r = done.result!;
    expect(r.trades.map((t) => t.symbol).sort()).toEqual(['AAA', 'BBB']);
    expect(r.notes[0]).toBe('Not NSE stocks (skipped): NOPE');
    expect(r.benchmark?.name).toBe('NIFTY 50');
    // Warm-up: candles fetched from before the period (SMA 10 needs history); NIFTY 50 for the period itself.
    const aaa = kite.calls.find((c) => c.token === 1)!;
    expect(aaa.from < '2025-01-20').toBe(true);
    expect(aaa.from).toBe(new Date(Date.parse('2025-01-20') - warmupDays(cross) * 86_400_000).toISOString().slice(0, 10));
    expect(r.requests).toBe(3);
    expect(svc.latestBacktest()!.id).toBe(job.id);
  });

  it('a re-run asks Kite for nothing; cancelling stops a running job', async () => {
    const req = { definition: cross, symbols: ['AAA', 'BBB'], from: '2025-01-20', to: '2025-03-31', capital: 1_000_000, maxPositions: null };
    const firstJob = await svc.startBacktest(req);
    const first = (await settle(() => svc.backtestJob(firstJob.id))) as EqBacktestJob;
    const calls = kite.calls.length;
    const rerunJob = await svc.startBacktest(req);
    const rerun = (await settle(() => svc.backtestJob(rerunJob.id))) as EqBacktestJob;
    expect(kite.calls.length).toBe(calls);
    expect(rerun).toMatchObject({ status: 'DONE', fetched: 0, cached: 3 });
    expect(rerun.result!.netPnl).toBe(first.result!.netPnl);
    kite.delayMs = 20;
    const slow = await svc.startBacktest({ ...req, from: '2025-01-21' });
    svc.cancelBacktest(slow.id);
    expect((await settle(() => svc.backtestJob(slow.id))).status).toBe('CANCELLED');
  });

  it('refuses without Kite, a reversed period, or % sizing without capital', async () => {
    const req = { definition: cross, symbols: ['AAA'], from: '2025-01-20', to: '2025-03-31', capital: 1_000_000, maxPositions: null };
    await expect(svc.startBacktest({ ...req, to: '2025-01-01' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.startBacktest({ ...req, capital: null, definition: { ...cross, sizing: { mode: 'PERCENT', value: 10 } } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/needs a starting capital/) });
    connected = false;
    await expect(svc.startBacktest(req)).rejects.toMatchObject({ status: 409 });
  });

  it('only finished sessions: today’s candle counts after 15:40 IST on a weekday', () => {
    expect(lastFinishedSession(ist('2025-04-01', '15:00'))).toBe('2025-03-31'); // Tue during the session → Mon
    expect(lastFinishedSession(ist('2025-04-01', '15:45'))).toBe('2025-04-01');
    expect(lastFinishedSession(ist('2025-04-05', '12:00'))).toBe('2025-04-04'); // Saturday → Friday
    expect(lastFinishedSession(ist('2025-04-07', '08:00'))).toBe('2025-04-04'); // Monday morning → Friday
  });

  it('the screener lists fresh signals first, with each condition’s values', async () => {
    // Close crosses above 105 at the 2025-02-04 close (107, after 104): a fresh signal for AAA; BBB (×2) was already above.
    const def = { ...cross, entry: { when: all('e', cond('e1', price('close'), 'GT', num(105))), trigger: 'WHEN_TRUE' as const } };
    clock.now = ist('2025-02-04', '18:00');
    const job = await svc.startScreen({ definition: def, symbols: ['BBB', 'AAA'] });
    const done = (await settle(() => svc.screenJob(job.id))) as EqScreenJob;
    expect(done.status).toBe('DONE');
    const [a, b] = done.result!.rows;
    expect(a).toMatchObject({ symbol: 'AAA', asOf: '2025-02-04', close: 107, changePct: 2.88, entry: true, fresh: true });
    expect(a!.leaves[0]).toEqual({ text: 'Close > 105', value: true, left: 107, right: 105 });
    expect(b).toMatchObject({ symbol: 'BBB', entry: true, fresh: false });
  });
});
