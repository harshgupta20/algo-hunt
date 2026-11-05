/**
 * The Returns tab's lookbacks and the one calculation behind them (shared so the server computes it and the page
 * explains it the same way):
 *
 *   1D       last close vs the previous trading day's close.
 *   1W       last close vs the close on the date 7 days earlier — or the last trading day before it (a holiday).
 *   1M … 3Y  the same with calendar months: 31 May − 3M = 28 / 29 Feb (the day is kept, clamped to the month's end).
 *
 * No close that far back (Kite's candles start later — the stock listed after that date) → no number.
 */
import type { EqReturnPeriod } from './types';

export interface EqReturnPeriodInfo {
  key: EqReturnPeriod;
  /** Calendar months back (1M … 3Y). */
  months?: number;
  /** Calendar days back (1W). */
  days?: number;
  /** "1 month", "3 years" — for tooltips. */
  words: string;
}

export const EQ_RETURN_PERIODS: readonly EqReturnPeriodInfo[] = [
  { key: '1D', words: '1 day' },
  { key: '1W', days: 7, words: '1 week' },
  { key: '1M', months: 1, words: '1 month' },
  { key: '3M', months: 3, words: '3 months' },
  { key: '6M', months: 6, words: '6 months' },
  { key: '1Y', months: 12, words: '1 year' },
  { key: '2Y', months: 24, words: '2 years' },
  { key: '3Y', months: 36, words: '3 years' },
];

/** The calendar date a lookback starts from (`date` = the last close's date). 1D has none — it's the previous candle. */
export function periodStart(date: string, p: EqReturnPeriodInfo): string | null {
  const d = new Date(`${date}T00:00:00Z`);
  if (p.days) return new Date(d.getTime() - p.days * 86_400_000).toISOString().slice(0, 10);
  if (!p.months) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - p.months;
  // Day 0 of the next month = the last day of this one.
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))).toISOString().slice(0, 10);
}

/** Index of the last date on or before `target` in ascending `dates` (−1: none). */
export function lastOnOrBefore(dates: readonly string[], target: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! <= target) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
