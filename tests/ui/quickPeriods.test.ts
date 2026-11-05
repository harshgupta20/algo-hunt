/**
 * Quick periods (every backtest): the last N days ending on the latest trading day — weekends stepped over, months
 * clamped to the month's end, today counting only after the close when the section needs finished candles.
 */
import { describe, expect, it } from 'vitest';
import { QUICK_PERIODS, lastWeekday, latestTradingDay, quickFrom } from '@/client/components/periods';

const ist = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+05:30`);

describe('quick periods', () => {
  it('are the platform’s eight lookbacks, in order', () => {
    expect(QUICK_PERIODS).toEqual(['1D', '1W', '1M', '3M', '6M', '1Y', '2Y', '3Y']);
  });

  it('day periods end on the day itself: 1D = that day, 5D / 1W = Mon–Fri ending Friday', () => {
    expect(quickFrom('2026-11-06', '1D')).toBe('2026-11-06');
    expect(quickFrom('2026-11-06', '5D')).toBe('2026-11-02');
    expect(quickFrom('2026-11-06', '1W')).toBe('2026-10-31');
    expect(quickFrom('2026-11-06', '10D')).toBe('2026-10-28');
  });

  it('month / year periods start the day after the same date back, clamped to the month’s end', () => {
    expect(quickFrom('2026-11-05', '1M')).toBe('2026-10-06');
    expect(quickFrom('2026-03-31', '1M')).toBe('2026-03-01'); // 31 Mar − 1M = 28 Feb → from 1 Mar
    expect(quickFrom('2024-05-31', '3M')).toBe('2024-03-01'); // 29 Feb (leap year) → from 1 Mar
    expect(quickFrom('2026-11-05', '6M')).toBe('2026-05-06');
    expect(quickFrom('2026-11-05', '1Y')).toBe('2025-11-06');
    expect(quickFrom('2026-11-05', '2Y')).toBe('2024-11-06');
    expect(quickFrom('2026-11-05', '3Y')).toBe('2023-11-06');
    expect(quickFrom('2026-11-05', '5Y')).toBe('2021-11-06');
    expect(quickFrom('2026-11-05', '10Y')).toBe('2016-11-06');
  });

  it('the latest trading day: weekends step back to Friday; with a close time, today counts only after it', () => {
    expect(lastWeekday('2026-11-08')).toBe('2026-11-06'); // Sunday → Friday
    expect(lastWeekday('2026-11-05')).toBe('2026-11-05');
    expect(latestTradingDay(null, ist('2026-11-05', '10:00'))).toBe('2026-11-05'); // intraday: today so far
    expect(latestTradingDay(940, ist('2026-11-05', '10:00'))).toBe('2026-11-04'); // daily candle not final yet
    expect(latestTradingDay(940, ist('2026-11-05', '15:45'))).toBe('2026-11-05');
    expect(latestTradingDay(940, ist('2026-11-09', '09:00'))).toBe('2026-11-06'); // Monday morning → Friday
    expect(latestTradingDay(null, ist('2026-11-07', '12:00'))).toBe('2026-11-06'); // Saturday → Friday
  });
});
