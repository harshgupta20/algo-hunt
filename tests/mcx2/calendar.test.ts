import { describe, expect, it } from 'vitest';
import { McxMarketCalendar } from '../../src/server/mcx/calendar/McxMarketCalendar';
import { ist } from '../helpers/mcxFakes';

const cal = new McxMarketCalendar([
  { date: '2026-10-02', kind: 'HOLIDAY', note: 'Gandhi Jayanti' },
  { date: '2026-11-08', kind: 'SPECIAL_SESSION', openMin: 18 * 60, closeMin: 19 * 60 + 15, note: 'Muhurat' },
]);

describe('McxMarketCalendar sessions', () => {
  it('closes 23:30 during US DST and 23:55 otherwise', () => {
    expect(cal.session('2026-10-07')).toMatchObject({ trading: true, openMin: 540, closeMin: 23 * 60 + 30 });
    expect(cal.session('2026-11-03')).toMatchObject({ trading: true, closeMin: 23 * 60 + 55 });
  });

  it('applies holidays, weekends and special sessions from data', () => {
    expect(cal.isTradingDay('2026-10-02')).toBe(false);
    expect(cal.session('2026-10-02').note).toBe('Gandhi Jayanti');
    expect(cal.isTradingDay('2026-10-03')).toBe(false); // Saturday
    expect(cal.session('2026-11-08')).toMatchObject({ trading: true, openMin: 1080, closeMin: 1155 });
    expect(cal.previousTradingDay('2026-10-05')).toBe('2026-10-01'); // Mon → Thu (Fri holiday)
  });

  it('knows when the market is open, with a close grace', () => {
    expect(cal.isMarketOpen(ist('2026-10-07', '08:59'))).toBe(false);
    expect(cal.isMarketOpen(ist('2026-10-07', '09:00'))).toBe(true);
    expect(cal.isMarketOpen(ist('2026-10-07', '23:34'))).toBe(false);
    expect(cal.isMarketOpen(ist('2026-10-07', '23:34'), 5)).toBe(true);
  });
});

describe('McxMarketCalendar candle boundaries', () => {
  it('aligns intraday and derived candles to the 09:00 open', () => {
    expect(cal.periodOpen(ist('2026-10-07', '10:52'), '15m')).toBe(ist('2026-10-07', '10:45'));
    expect(cal.periodOpen(ist('2026-10-07', '10:52'), '2h')).toBe(ist('2026-10-07', '09:00'));
    expect(cal.periodOpen(ist('2026-10-07', '11:00'), '2h')).toBe(ist('2026-10-07', '11:00'));
    expect(cal.periodOpen(ist('2026-10-07', '16:10'), '4h')).toBe(ist('2026-10-07', '13:00'));
  });

  it('truncates the last candle at the session close', () => {
    expect(cal.candleClose(ist('2026-10-07', '21:00'), '4h')).toBe(ist('2026-10-07', '23:30'));
    expect(cal.candleClose(ist('2026-10-07', '23:15'), '1h')).toBe(ist('2026-10-07', '23:30'));
    expect(cal.candleClose(ist('2026-10-07', '10:45'), '15m')).toBe(ist('2026-10-07', '11:00'));
  });

  it('closes daily candles at the session end and weekly on the last trading day', () => {
    expect(cal.candleClose(ist('2026-10-07', '00:00'), '1d')).toBe(ist('2026-10-07', '23:30'));
    // Week of Mon 2026-09-28: Friday 2026-10-02 is a holiday → closes Thursday.
    const wk = cal.periodOpen(ist('2026-09-30', '12:00'), '1w');
    expect(wk).toBe(ist('2026-09-28', '00:00'));
    expect(cal.candleClose(wk, '1w')).toBe(ist('2026-10-01', '23:30'));
  });

  it('finds the last completed candle for the trigger clock', () => {
    expect(cal.lastCompletedOpen(ist('2026-10-07', '11:00'), '15m')).toBe(ist('2026-10-07', '10:45'));
    expect(cal.lastCompletedOpen(ist('2026-10-07', '10:59'), '15m')).toBe(ist('2026-10-07', '10:30'));
    // Before the open → yesterday's last candle.
    expect(cal.lastCompletedOpen(ist('2026-10-07', '08:30'), '15m')).toBe(ist('2026-10-06', '23:15'));
    // Monday morning → Thursday's last candle (Friday holiday).
    expect(cal.lastCompletedOpen(ist('2026-10-05', '09:10'), '15m')).toBe(ist('2026-10-01', '23:15'));
    // Truncated 4h candle (21:00–23:30) completes at the close.
    expect(cal.lastCompletedOpen(ist('2026-10-07', '23:31'), '4h')).toBe(ist('2026-10-07', '21:00'));
    expect(cal.lastCompletedOpen(ist('2026-10-07', '12:00'), '1d')).toBe(ist('2026-10-06', '00:00'));
    expect(cal.lastCompletedOpen(ist('2026-10-07', '23:45'), '1d')).toBe(ist('2026-10-07', '00:00'));
  });
});
