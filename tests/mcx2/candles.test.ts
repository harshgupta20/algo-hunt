import { describe, expect, it } from 'vitest';
import { McxMarketCalendar } from '../../src/server/mcx/calendar/McxMarketCalendar';
import { aggregate, buildSeries, finalize, heikinAshi, volumeCandles } from '../../src/server/mcx/engine/candles';
import { candlesAt, ist } from '../helpers/mcxFakes';

const cal = new McxMarketCalendar();
const D = '2026-10-07';
const hours = (from: string, n: number) => Array.from({ length: n }, (_, i) => ist(D, from) + i * 3_600_000);

describe('derived timeframes', () => {
  it('builds 2h / 4h from 1h aligned to the 09:00 open, last candle truncated at the close', () => {
    const h = candlesAt(hours('09:00', 15), Array.from({ length: 15 }, (_, i) => 100 + i), { volume: 10 });
    const two = aggregate(h, '2h', cal);
    expect(two.map((c) => c.time * 1000)).toEqual([9, 11, 13, 15, 17, 19, 21, 23].map((hh) => ist(D, `${String(hh).padStart(2, '0')}:00`)));
    expect(two[0]).toMatchObject({ open: 100, close: 101, volume: 20 });
    const four = finalize(aggregate(h, '4h', cal), '4h', cal, ist(D, '23:40'));
    expect(four.map((c) => c.time * 1000)).toEqual([ist(D, '09:00'), ist(D, '13:00'), ist(D, '17:00'), ist(D, '21:00')]);
    expect(four.at(-1)).toMatchObject({ closeMs: ist(D, '23:30'), complete: true, volume: 30 });
  });

  it('marks candles complete only once their close has passed', () => {
    const c = finalize(candlesAt([ist(D, '10:30'), ist(D, '10:45')], [1, 2]), '15m', cal, ist(D, '10:50'));
    expect(c.map((x) => x.complete)).toEqual([true, false]);
  });

  it('builds weekly candles from daily ones', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12'].map((d) => ist(d, '00:00'));
    const w = buildSeries(candlesAt(days, [1, 2, 3, 4, 5, 6]), '1w', { type: 'NORMAL' }, cal, ist('2026-10-12', '12:00'));
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ open: 1, close: 5, complete: true, closeMs: ist('2026-10-09', '23:30') });
    expect(w[1]!.complete).toBe(false);
  });
});

describe('candle types', () => {
  it('computes Heikin Ashi (close = OHLC/4, open = previous HA mid)', () => {
    const raw = finalize(
      candlesAt([ist(D, '10:00'), ist(D, '10:05')], [10, 14], { ohlc: [{ open: 8, high: 12, low: 7, close: 10 }, { open: 10, high: 15, low: 9, close: 14 }] }),
      '5m',
      cal,
      ist(D, '11:00'),
    );
    const ha = heikinAshi(raw);
    expect(ha[0]).toMatchObject({ close: 9.25, open: 9 });
    expect(ha[1]!.open).toBeCloseTo((9 + 9.25) / 2);
    expect(ha[1]!.close).toBe(12);
    expect(ha[1]!.high).toBe(15);
    expect(ha[1]).toMatchObject({ complete: true, closeMs: ist(D, '10:10') });
  });

  it('merges base candles into volume candles and restarts every day', () => {
    const times = [ist(D, '09:00'), ist(D, '09:05'), ist(D, '09:10'), ist(D, '09:15'), ist('2026-10-08', '09:00')];
    const base = finalize(candlesAt(times, [1, 2, 3, 4, 5], { volume: [60, 50, 30, 80, 20] }), '5m', cal, ist('2026-10-08', '09:07'));
    const v = volumeCandles(base, 100, cal, ist('2026-10-08', '09:07'));
    expect(v.map((c) => c.volume)).toEqual([110, 110, 20]);
    expect(v[0]).toMatchObject({ time: times[0]! / 1000, close: 2, complete: true });
    expect(v[1]).toMatchObject({ time: times[2]! / 1000, close: 4, complete: true });
    expect(v[2]!.complete).toBe(false); // today's volume candle is still filling
  });
});
