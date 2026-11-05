/**
 * Returns: the lookback dates (a week back, calendar months clamped to the month's end), the close each move is
 * measured from (the trading day on or before that date — a holiday falls back), and "no number" for a stock
 * listed after the lookback starts.
 */
import { describe, expect, it } from 'vitest';
import type { EqReturnPeriodInfo } from '../../src/shared/equity';
import { EQ_RETURN_PERIODS, lastOnOrBefore, periodStart } from '../../src/shared/equity';
import { dailyBars } from '../../src/server/equity/engine/bars';
import { stockReturns } from '../../src/server/equity/engine/returns';

const P = (key: string) => EQ_RETURN_PERIODS.find((p) => p.key === key) as EqReturnPeriodInfo;
const bars = (rows: Array<[string, number]>) => dailyBars(rows.map(([d, c]) => ({ time: Date.parse(`${d}T00:00:00+05:30`) / 1000, open: c, high: c, low: c, close: c, volume: 1 })));

describe('returns', () => {
  it('lookbacks are the eight the trader asked for, in order', () => {
    expect(EQ_RETURN_PERIODS.map((p) => p.key)).toEqual(['1D', '1W', '1M', '3M', '6M', '1Y', '2Y', '3Y']);
  });

  it('the date a lookback starts from: 7 days for 1W, calendar months clamped to the month’s end', () => {
    expect(periodStart('2025-04-01', P('1D'))).toBeNull();
    expect(periodStart('2025-04-01', P('1W'))).toBe('2025-03-25');
    expect(periodStart('2025-03-31', P('1M'))).toBe('2025-02-28');
    expect(periodStart('2025-05-31', P('3M'))).toBe('2025-02-28');
    expect(periodStart('2024-05-31', P('3M'))).toBe('2024-02-29'); // leap year
    expect(periodStart('2025-01-15', P('6M'))).toBe('2024-07-15'); // across a year
    expect(periodStart('2024-02-29', P('1Y'))).toBe('2023-02-28');
    expect(periodStart('2025-04-01', P('2Y'))).toBe('2023-04-01');
    expect(periodStart('2025-04-01', P('3Y'))).toBe('2022-04-01');
  });

  it('the last date on or before a target', () => {
    const d = ['2025-03-20', '2025-03-24', '2025-03-26'];
    expect(lastOnOrBefore(d, '2025-03-19')).toBe(-1);
    expect(lastOnOrBefore(d, '2025-03-20')).toBe(0);
    expect(lastOnOrBefore(d, '2025-03-25')).toBe(1);
    expect(lastOnOrBefore(d, '2026-01-01')).toBe(2);
    expect(lastOnOrBefore([], '2025-01-01')).toBe(-1);
  });

  it('each move = last close vs the close on or before its start date; a holiday falls back a day', () => {
    const r = stockReturns({
      symbol: 'AAA',
      name: 'AAA LTD',
      daily: bars([
        ['2022-03-31', 50], // 3Y starts 2022-04-01, a holiday here → the day before
        ['2023-03-31', 80], // 2Y starts 2023-04-01, a Saturday → Friday
        ['2023-04-03', 85],
        ['2024-03-28', 100], // 1Y starts 2024-04-01: the last close on or before it (Good Friday shut on 29 Mar)
        ['2024-10-01', 120],
        ['2025-01-01', 125],
        ['2025-02-28', 160], // 1M starts 2025-03-01, a Saturday → Friday
        ['2025-03-03', 150],
        ['2025-03-24', 180], // 1W start 2025-03-25 is a holiday → 24 Mar
        ['2025-03-31', 190],
        ['2025-04-01', 200],
      ]),
    });
    expect(r).toMatchObject({ asOf: '2025-04-01', close: 200, firstDate: '2022-03-31' });
    const m = r.moves;
    expect(m['1D']).toEqual({ pct: 5.26, from: '2025-03-31', base: 190 });
    expect(m['1W']).toEqual({ pct: 11.11, from: '2025-03-24', base: 180 });
    expect(m['1M']).toEqual({ pct: 25, from: '2025-02-28', base: 160 });
    expect(m['3M']).toEqual({ pct: 60, from: '2025-01-01', base: 125 });
    expect(m['6M']).toEqual({ pct: 66.67, from: '2024-10-01', base: 120 });
    expect(m['1Y']).toEqual({ pct: 100, from: '2024-03-28', base: 100 });
    expect(m['2Y']).toEqual({ pct: 150, from: '2023-03-31', base: 80 });
    expect(m['3Y']).toEqual({ pct: 300, from: '2022-03-31', base: 50 });
  });

  it('listed after a lookback starts → no number for it (not a guess from the first candle)', () => {
    const r = stockReturns({ symbol: 'NEW', name: 'NEW LTD', daily: bars([['2025-03-10', 100], ['2025-03-31', 104], ['2025-04-01', 110]]) });
    expect(r.moves['1D'].pct).toBe(5.77);
    expect(r.moves['1W'].pct).toBe(10);
    expect(r.moves['1M']).toEqual({ pct: null, from: null, base: null });
    expect(r.moves['3Y'].pct).toBeNull();
    expect(r.firstDate).toBe('2025-03-10');
  });

  it('one candle: no previous close, so no 1D either; no candles → the error', () => {
    expect(stockReturns({ symbol: 'ONE', name: 'ONE', daily: bars([['2025-04-01', 100]]) }).moves['1D'].pct).toBeNull();
    expect(stockReturns({ symbol: 'X', name: 'X', daily: null, error: 'Candles: timeout' })).toMatchObject({ error: 'Candles: timeout', asOf: null, close: null });
    expect(stockReturns({ symbol: 'Y', name: 'Y', daily: bars([]) })).toMatchObject({ error: 'No candles from Kite' });
  });
});
