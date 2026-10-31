/**
 * Upstox contracts → V2 instruments, the daily instrument file, and UpstoxHistory: which expiries and contracts a
 * test reads, which days are covered, how candle requests are split / clamped / cached, and how 10-minute and
 * hourly candles are built (and rebuilt from 1-minute candles when Upstox's aren't on our boundaries).
 */
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { V2Product } from '../../src/shared/v2';
import type { ExpiredInterval, UpstoxApi, UpstoxContract } from '../../src/server/services/upstox/upstoxClient';
import type { RawCandle } from '../../src/server/v2/engine/candles';
import { contractInstrument, isExpiredKey, parseInstrumentFiles, productSpot, upstoxKey, upstoxToken } from '../../src/server/v2/upstox/instruments';
import { UpstoxHistory, chunks, expiryCoverage } from '../../src/server/v2/upstox/UpstoxHistory';
import { ist } from '../helpers/v2Fakes';

// The expired-option-contract docs sample.
const docsPut: UpstoxContract = {
  name: 'NIFTY',
  segment: 'NSE_FO',
  exchange: 'NSE',
  expiry: '2025-04-17',
  instrument_key: 'NSE_FO|47983|17-04-2025',
  trading_symbol: 'NIFTY 20400 PE 17 APR 25',
  tick_size: 5,
  lot_size: 75,
  instrument_type: 'PE',
  underlying_key: 'NSE_INDEX|Nifty 50',
  underlying_symbol: 'NIFTY',
  strike_price: 20400,
  weekly: true,
};

const nifty: V2Product = { id: 'NSE:NIFTY', market: 'NSE', kind: 'INDEX', symbol: 'NIFTY', name: 'Nifty 50', hasSpot: true, hasFutures: true, hasOptions: true, futureExpiries: [], optionExpiries: [], strikeStep: 50, lotSize: 65 };
const sensex: V2Product = { ...nifty, id: 'BSE:SENSEX', symbol: 'SENSEX', name: 'Sensex' };
const reliance: V2Product = { ...nifty, id: 'NSE:RELIANCE', symbol: 'RELIANCE', name: 'Reliance', kind: 'STOCK', lotSize: 500 };
const gold: V2Product = { ...nifty, id: 'MCX:GOLD', market: 'MCX', kind: 'COMMODITY', symbol: 'GOLD', name: 'Gold' };

/** Instrument-file rows in Upstox's shape (expiry: epoch ms of 23:59:59 IST). */
const eod = (date: string) => ist(date, '23:59') + 59_000;
const liveOpt = (key: string, expiry: string, strike: number, type: 'CE' | 'PE' | 'FUT', lot = 65) => ({
  segment: 'NSE_FO',
  instrument_type: type,
  instrument_key: key,
  trading_symbol: `NIFTY ${type === 'FUT' ? 'FUT' : `${strike} ${type}`} ${expiry}`,
  tick_size: type === 'FUT' ? 10 : 5,
  lot_size: lot,
  expiry: eod(expiry),
  strike_price: type === 'FUT' ? 0 : strike,
  underlying_key: 'NSE_INDEX|Nifty 50',
  underlying_symbol: 'NIFTY',
  weekly: type !== 'FUT',
});
const nseFile = [
  { segment: 'NSE_INDEX', instrument_type: 'INDEX', instrument_key: 'NSE_INDEX|Nifty 50', trading_symbol: 'NIFTY', exchange_token: '26000' },
  { segment: 'NSE_EQ', instrument_type: 'EQ', instrument_key: 'NSE_EQ|INE002A01018', trading_symbol: 'RELIANCE', tick_size: 10, lot_size: 1 },
  liveOpt('NSE_FO|50001', '2026-11-03', 25_000, 'CE'),
  liveOpt('NSE_FO|50002', '2026-11-03', 25_000, 'PE'),
  liveOpt('NSE_FO|50003', '2026-11-10', 25_000, 'CE'),
  liveOpt('NSE_FO|50004', '2026-11-24', 25_000, 'CE'),
  liveOpt('NSE_FO|50005', '2026-11-24', 0, 'FUT'),
  { ...liveOpt('NSE_FO|60001', '2026-11-24', 0, 'FUT', 500), trading_symbol: 'RELIANCE FUT', underlying_key: 'NSE_EQ|INE002A01018', underlying_symbol: 'RELIANCE', tick_size: 10 },
];
const bseFile = [
  { segment: 'BSE_INDEX', instrument_type: 'INDEX', instrument_key: 'BSE_INDEX|SENSEX', trading_symbol: 'SENSEX' },
  { segment: 'BSE_FO', instrument_type: 'CE', instrument_key: 'BSE_FO|1', trading_symbol: 'SENSEX 82000 CE', tick_size: 5, lot_size: 20, expiry: eod('2026-11-05'), strike_price: 82_000, underlying_key: 'BSE_INDEX|SENSEX', underlying_symbol: 'SENSEX' },
];
const files = () => [gzipSync(JSON.stringify(nseFile)), gzipSync(JSON.stringify(bseFile))];

describe('upstox instruments', () => {
  it('maps a contract: exchange, kind, strike, lot, tick in rupees, expiry, a stable token far from Kite’s', () => {
    const i = contractInstrument(docsPut, 'NSE:NIFTY')!;
    expect(i).toMatchObject({ id: 'U:NSE_FO|47983|17-04-2025', exchange: 'NFO', productId: 'NSE:NIFTY', kind: 'PE', symbol: 'NIFTY 20400 PE 17 APR 25', expiry: '2025-04-17', strike: 20_400, lotSize: 75, tickSize: 0.05 });
    expect(i.token).toBe(upstoxToken('NSE_FO|47983|17-04-2025'));
    expect(i.token).toBeGreaterThanOrEqual(2 ** 52);
    expect(Number.isSafeInteger(i.token)).toBe(true);
    // The live key of the same exchange token is another contract.
    expect(upstoxToken('NSE_FO|47983')).not.toBe(i.token);
    expect(upstoxKey(i)).toBe('NSE_FO|47983|17-04-2025');
    expect(isExpiredKey('NSE_FO|47983|17-04-2025')).toBe(true);
    expect(isExpiredKey('NSE_FO|47983')).toBe(false);
    expect(isExpiredKey('NSE_INDEX|Nifty 50')).toBe(false);
    const f = contractInstrument({ ...docsPut, instrument_type: 'FUT', strike_price: 0, segment: 'BSE_FO', tick_size: 10 }, 'BSE:SENSEX')!;
    expect(f).toMatchObject({ kind: 'FUT', strike: null, exchange: 'BFO', tickSize: 0.1 });
  });

  it('skips what isn’t an NSE / BSE option or future; refuses a contract without a lot or tick', () => {
    expect(contractInstrument({ ...docsPut, segment: 'MCX_FO' }, 'MCX:GOLD')).toBeNull();
    expect(contractInstrument({ ...docsPut, instrument_type: 'EQ' }, 'NSE:NIFTY')).toBeNull();
    expect(() => contractInstrument({ ...docsPut, lot_size: 0 }, 'NSE:NIFTY')).toThrow(/without a usable lot size/);
    expect(() => contractInstrument({ ...docsPut, tick_size: Number.NaN }, 'NSE:NIFTY')).toThrow(/without a usable/);
    expect(() => contractInstrument({ ...docsPut, expiry: '17-04-2025' }, 'NSE:NIFTY')).toThrow(/Unreadable Upstox expiry/);
  });

  it('reads the instrument files: our products → Upstox underlyings and spots, live contracts with IST expiry dates', () => {
    const file = parseInstrumentFiles(files(), '2026-10-31');
    expect(productSpot(file, nifty)).toMatchObject({ key: 'NSE_INDEX|Nifty 50', spot: { id: 'U:NSE_INDEX|Nifty 50', kind: 'SPOT', exchange: 'NSE', symbol: 'NIFTY', productId: 'NSE:NIFTY', lotSize: 1 } });
    expect(productSpot(file, sensex)).toMatchObject({ key: 'BSE_INDEX|SENSEX', spot: { exchange: 'BSE' } });
    expect(productSpot(file, reliance)).toMatchObject({ key: 'NSE_EQ|INE002A01018', spot: { exchange: 'NSE', tickSize: 0.1 } });
    expect(productSpot(file, gold)).toBeNull();
    expect(productSpot(file, { ...nifty, id: 'NSE:NOFNO', symbol: 'NOFNO' })).toBeNull();
    const live = file.live.get('NSE_INDEX|Nifty 50')!;
    expect(live).toHaveLength(5);
    expect(contractInstrument(live[0]!, 'NSE:NIFTY')).toMatchObject({ expiry: '2026-11-03', strike: 25_000, kind: 'CE', lotSize: 65 });
  });
});

describe('request pieces and coverage', () => {
  it('splits a span on fixed boundaries, clamped to the last allowed day', () => {
    const a = chunks('2026-10-01', '2026-11-15', 28, '2026-11-10');
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a[0]!.from <= '2026-10-01' && a.at(-1)!.to === '2026-11-10').toBe(true);
    for (let i = 1; i < a.length; i++) expect(Date.parse(a[i]!.from) - Date.parse(a[i - 1]!.to)).toBe(86_400_000); // contiguous
    for (const p of a.slice(0, -1)) expect((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 + 1).toBe(28);
    // The same day always falls in the same piece, whatever span it is asked within.
    const b = chunks('2026-10-20', '2026-10-21', 28, '2026-12-31');
    expect(b).toHaveLength(1);
    expect(a.some((p) => p.from === b[0]!.from && p.to === b[0]!.to)).toBe(true);
    expect(chunks('2026-11-11', '2026-11-15', 28, '2026-11-10')).toEqual([]);
  });

  it('covers days after the first known expiry; flags a spacing far over the usual one (a missing expiry)', () => {
    const weekly = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'];
    expect(expiryCoverage(weekly, '2026-10-31')).toEqual({ coveredFrom: '2026-09-02', gaps: [] });
    // Holiday shifts (6 / 8 days) are normal.
    expect(expiryCoverage(['2026-09-01', '2026-09-07', '2026-09-15', '2026-09-22', '2026-09-29'], '2026-10-31').gaps).toEqual([]);
    // 22 Sep missing → 16 Sep … 29 Sep can't be told apart.
    expect(expiryCoverage(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-29', '2026-10-06', '2026-10-13'], '2026-10-31').gaps).toEqual([{ from: '2026-09-16', to: '2026-09-29' }]);
    // Monthly products: ~4–5 weeks apart is usual; a skipped month is a gap.
    const monthly = ['2026-05-26', '2026-06-30', '2026-07-28', '2026-08-25', '2026-09-29', '2026-11-24'];
    expect(expiryCoverage(monthly, '2026-10-31').gaps).toEqual([{ from: '2026-09-30', to: '2026-11-24' }]);
    expect(expiryCoverage([], '2026-10-31')).toEqual({ coveredFrom: null, gaps: [] });
  });
});

/** A fake Upstox API: expired expiries / contracts / candles from tables, recording calls. */
function fakeApi(o: { expiries?: string[]; options?: Record<string, UpstoxContract[]>; futures?: Record<string, UpstoxContract[]>; candles?: (key: string, interval: string, from: string, to: string) => RawCandle[] }) {
  const calls: string[] = [];
  const api = {
    expiries: async (key: string) => (calls.push(`expiries ${key}`), o.expiries ?? []),
    expiredOptions: async (key: string, e: string) => (calls.push(`options ${e}`), o.options?.[e] ?? []),
    expiredFutures: async (key: string, e: string) => (calls.push(`futures ${e}`), o.futures?.[e] ?? []),
    expiredCandles: async (key: string, interval: ExpiredInterval, from: string, to: string) => (calls.push(`expired ${key} ${interval} ${from} ${to}`), o.candles?.(key, interval, from, to) ?? []),
    historicalCandles: async (key: string, unit: string, n: number, from: string, to: string) => (calls.push(`v3 ${key} ${unit}/${n} ${from} ${to}`), o.candles?.(key, `${unit}/${n}`, from, to) ?? []),
  } as unknown as UpstoxApi;
  return { api, calls };
}

const expiredOpt = (expiry: string, strike: number, type: 'CE' | 'PE', lot = 75, weekly = true): UpstoxContract => ({
  ...docsPut,
  expiry,
  strike_price: strike,
  instrument_type: type,
  lot_size: lot,
  weekly,
  instrument_key: `NSE_FO|${strike}${type === 'CE' ? 1 : 2}|${expiry.slice(8, 10)}-${expiry.slice(5, 7)}-${expiry.slice(0, 4)}`,
  trading_symbol: `NIFTY ${strike} ${type} ${expiry}`,
});
const expiredFut = (expiry: string): UpstoxContract => ({ ...docsPut, expiry, instrument_type: 'FUT', strike_price: 0, tick_size: 10, instrument_key: `NSE_FO|9${expiry.replace(/-/g, '')}|${expiry.slice(8, 10)}-${expiry.slice(5, 7)}-${expiry.slice(0, 4)}`, trading_symbol: `NIFTY FUT ${expiry}` });

describe('UpstoxHistory.contracts', () => {
  const past = ['2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
  const options = Object.fromEntries(past.map((e) => [e, [expiredOpt(e, 25_000, 'CE', e < '2026-10-01' ? 75 : 65, e !== '2026-09-29' && e !== '2026-10-27'), expiredOpt(e, 25_000, 'PE')]]));
  const futures = { '2026-09-29': [expiredFut('2026-09-29')], '2026-10-27': [expiredFut('2026-10-27')] };
  const history = (now = ist('2026-10-31', '10:00')) => {
    const f = fakeApi({ expiries: past, options, futures });
    return { ...f, h: new UpstoxHistory({ api: () => f.api, calendar: async () => [], now: () => now, instrumentFiles: async () => files() }) };
  };

  it('options of the expiries from `from` through `to` and the next three (expired and live), with each one’s own lot', async () => {
    const { h, calls } = history();
    const stats = { fetched: 0, cached: 0 };
    const r = await h.contracts(nifty, { from: '2026-10-07', to: '2026-10-14' }, { options: true, futures: false }, stats);
    expect(r.spot.id).toBe('U:NSE_INDEX|Nifty 50');
    // 13 Oct (in the period), then 20 Oct, 27 Oct and 3 Nov (live) after it.
    expect([...new Set(r.contracts.map((c) => c.expiry))]).toEqual(['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']);
    expect(r.contracts.every((c) => c.kind !== 'FUT')).toBe(true);
    expect(r.contracts.find((c) => c.expiry === '2026-11-03' && c.kind === 'CE')).toMatchObject({ lotSize: 65, id: 'U:NSE_FO|50001' });
    expect(calls).toEqual(['expiries NSE_INDEX|Nifty 50', 'options 2026-10-13', 'options 2026-10-20', 'options 2026-10-27']);
    expect(stats).toEqual({ fetched: 4, cached: 0 });
    expect(r.coveredFrom).toBe('2026-09-30');
    expect(r.gaps).toEqual([]);
    // A re-run asks only the contracts it doesn't hold (the expiry list is kept for an hour).
    const again = await h.contracts(nifty, { from: '2026-10-07', to: '2026-10-14' }, { options: true, futures: false }, stats);
    expect(again.contracts).toHaveLength(r.contracts.length);
    expect(calls).toHaveLength(4);
    expect(stats).toEqual({ fetched: 4, cached: 3 });
  });

  it('futures from the monthly expiries only (the last of each month), expired and live', async () => {
    const { h, calls } = history();
    const r = await h.contracts(nifty, { from: '2026-09-01', to: '2026-10-14' }, { options: false, futures: true });
    expect(r.contracts.map((c) => [c.kind, c.expiry])).toEqual([
      ['FUT', '2026-09-29'],
      ['FUT', '2026-10-27'],
      ['FUT', '2026-11-24'],
    ]);
    expect(calls.filter((c) => c.startsWith('options'))).toEqual([]);
    expect(calls.filter((c) => c.startsWith('futures'))).toEqual(['futures 2026-09-29', 'futures 2026-10-27']);
  });

  it('just the spot when the strategy reads no contracts; MCX and products without F&O are refused', async () => {
    const { h, calls } = history();
    expect(await h.contracts(nifty, { from: '2026-10-07', to: '2026-10-14' }, { options: false, futures: false })).toMatchObject({ contracts: [], coveredFrom: '2026-10-07', gaps: [] });
    expect(calls).toEqual([]);
    await expect(h.contracts(gold, { from: '2026-10-07', to: '2026-10-14' }, { options: true, futures: false })).rejects.toThrow(/no expired MCX contracts/);
    await expect(h.contracts({ ...nifty, id: 'NSE:NOFNO', symbol: 'NOFNO' }, { from: '2026-10-07', to: '2026-10-14' }, { options: true, futures: false })).rejects.toThrow(/lists no futures & options for NOFNO/);
  });

  it('flags a hole between the expired and live lists (a recently expired contract missing)', async () => {
    const f = fakeApi({ expiries: past.slice(0, 3), options, futures });
    const h = new UpstoxHistory({ api: () => f.api, calendar: async () => [], now: () => ist('2026-10-31', '10:00'), instrumentFiles: async () => files() });
    const r = await h.contracts(nifty, { from: '2026-10-07', to: '2026-10-30' }, { options: true, futures: false });
    expect(r.gaps).toEqual([{ from: '2026-10-14', to: '2026-11-03' }]);
    expect(r.notes.some((n) => /no expiry between 2026-10-13 and 2026-11-03/.test(n))).toBe(true);
  });
});

describe('UpstoxHistory.candles', () => {
  const minute = (date: string, hhmm: string, close: number): RawCandle => ({ time: ist(date, hhmm) / 1000, open: close, high: close + 1, low: close - 1, close, volume: 10 });
  /** Upstox candles for a session (open times on the interval's boundaries from 09:15), plus a pre-open minute. */
  const session = (date: string, every: number, offset = 0): RawCandle[] => {
    const out: RawCandle[] = [];
    for (let m = 9 * 60 + 15 + offset; m < 15 * 60 + 30; m += every) out.push(minute(date, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, m));
    return out;
  };
  const setup = (candles: (key: string, interval: string, from: string, to: string) => RawCandle[], now = ist('2026-10-16', '10:00')) => {
    const f = fakeApi({ candles });
    return { ...f, h: new UpstoxHistory({ api: () => f.api, calendar: async () => [], now: () => now, instrumentFiles: async () => files() }) };
  };
  const expiredCall = contractInstrument(expiredOpt('2026-10-13', 25_000, 'CE'), 'NSE:NIFTY')!;
  const spot = productSpot(parseInstrumentFiles(files(), '2026-10-16'), nifty)!.spot;

  it('expired contracts from the expired API, clamped to their expiry; the spot from v3, clamped to the last complete day', async () => {
    const { h, calls } = setup(() => []);
    await h.candles(expiredCall, '1m', '2026-10-01', '2026-10-20');
    await h.candles(spot, '15m', '2026-10-01', '2026-10-16');
    await h.candles(spot, '1d', '2026-01-01', '2026-10-16');
    expect(calls).toEqual([
      // Pieces on fixed 28-day boundaries, the last ending at the expiry.
      ...chunks('2026-10-01', '2026-10-13', 28, '2026-10-13').map((p) => `expired NSE_FO|250001|13-10-2026 1minute ${p.from} ${p.to}`),
      // Today (16 Oct) isn't complete: the last day is 15 Oct.
      ...chunks('2026-10-01', '2026-10-15', 28, '2026-10-15').map((p) => `v3 NSE_INDEX|Nifty 50 minutes/15 ${p.from} ${p.to}`),
      ...chunks('2026-01-01', '2026-10-15', 3650, '2026-10-15').map((p) => `v3 NSE_INDEX|Nifty 50 days/1 ${p.from} ${p.to}`),
    ]);
    // Nothing to ask once the period starts after the expiry.
    expect(await h.candles(expiredCall, '1m', '2026-10-14', '2026-10-20')).toEqual([]);
  });

  it('only the asked days, inside the session (pre-open minutes dropped); a re-run comes from memory', async () => {
    const { h, calls } = setup((key, interval) => (interval === 'minutes/1' ? [minute('2026-10-14', '09:08', 1), ...session('2026-10-14', 1), ...session('2026-10-15', 1)] : []));
    const stats = { fetched: 0, cached: 0 };
    const rows = await h.candles(spot, '1m', '2026-10-15', '2026-10-15', stats);
    expect(rows).toHaveLength(375);
    expect(rows[0]!.time).toBe(ist('2026-10-15', '09:15') / 1000);
    const day14 = await h.candles(spot, '1m', '2026-10-14', '2026-10-14', stats);
    expect(day14[0]!.time).toBe(ist('2026-10-14', '09:15') / 1000); // the 09:08 pre-open minute is gone
    expect(calls).toHaveLength(1);
    expect(stats).toEqual({ fetched: 1, cached: 1 });
  });

  it('10 minutes from 5, 1 hour from 30 — on the session’s boundaries (09:15, 10:15 … 15:15)', async () => {
    const { h, calls } = setup((key, interval) => (interval === 'minutes/5' ? session('2026-10-15', 5) : interval === 'minutes/30' ? session('2026-10-15', 30) : []));
    const ten = await h.candles(spot, '10m', '2026-10-15', '2026-10-15');
    expect(ten).toHaveLength(38); // 375 minutes → 37 full + the 15:25 stub
    expect(ten[0]).toMatchObject({ time: ist('2026-10-15', '09:15') / 1000, volume: 20 });
    expect(ten.at(-1)).toMatchObject({ time: ist('2026-10-15', '15:25') / 1000, volume: 10 });
    const hour = await h.candles(spot, '1h', '2026-10-15', '2026-10-15');
    expect(hour.map((c) => new Date(c.time * 1000 + 330 * 60_000).toISOString().slice(11, 16))).toEqual(['09:15', '10:15', '11:15', '12:15', '13:15', '14:15', '15:15']);
    expect(hour[0]).toMatchObject({ open: 9 * 60 + 15, close: 9 * 60 + 45, high: 9 * 60 + 46, low: 9 * 60 + 14, volume: 20 });
    expect(calls.map((c) => c.match(/minutes\/\d+/)?.[0])).toEqual(['minutes/5', 'minutes/30']);
  });

  it('Upstox candles off our boundaries → that interval is built from 1-minute candles instead', async () => {
    // 15-minute candles at 09:20, 09:35… (not on 09:15 boundaries): wrong for us.
    const { h, calls } = setup((key, interval) => (interval === 'minutes/15' ? session('2026-10-15', 15, 5) : interval === 'minutes/1' ? session('2026-10-15', 1) : []));
    const rows = await h.candles(spot, '15m', '2026-10-15', '2026-10-15');
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({ time: ist('2026-10-15', '09:15') / 1000, open: 555, close: 569, volume: 150 });
    const asked = () => calls.map((c) => c.match(/minutes\/\d+/)?.[0]);
    expect(asked()).toEqual(['minutes/15', 'minutes/1']);
    // Remembered: the next 15-minute request (another piece of time) goes straight to 1-minute candles.
    await h.candles(spot, '15m', '2026-09-01', '2026-09-01');
    expect(asked()).toEqual(['minutes/15', 'minutes/1', 'minutes/1']);
  });

  it('refuses an instrument that isn’t Upstox’s', async () => {
    const { h } = setup(() => []);
    await expect(h.candles({ ...spot, id: 'K:256265' }, '1m', '2026-10-15', '2026-10-15')).rejects.toThrow(/isn’t an Upstox instrument/);
  });
});
