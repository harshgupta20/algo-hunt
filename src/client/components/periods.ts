/**
 * Quick periods for every backtest (Equity, F&O, Options) — the platform's lookbacks 1D · 1W · 1M · 3M · 6M · 1Y · 2Y ·
 * 3Y (the same as Equity → Returns), plus a section's own extras (5D / 10D on F&O, 5Y / 10Y on Equity). The logic
 * only (no React), so it can be tested.
 *
 * A quick period is the last N calendar days ENDING on the latest trading day (`end`), inclusive:
 *   1D / 5D / 1W / 10D   N days: 1D = that day alone, 1W = the 7 days ending on it (a full Mon–Fri week).
 *   1M … 10Y             from the day after the same date N months back (the day clamped to the month's end), so
 *                        1Y ending 5 Nov 2026 = 6 Nov 2025 → 5 Nov 2026, and 1M ending 31 Mar = 1 Mar → 31 Mar.
 * Weekends are stepped over here; exchange holidays aren't known — the backtest itself skips them.
 */

export type QuickPeriodKey = '1D' | '5D' | '1W' | '10D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | '10Y';

export const QUICK_PERIOD_SPEC: Record<QuickPeriodKey, { days?: number; months?: number; words: string }> = {
  '1D': { days: 1, words: '1 day' },
  '5D': { days: 5, words: '5 days' },
  '1W': { days: 7, words: '1 week' },
  '10D': { days: 10, words: '10 days' },
  '1M': { months: 1, words: '1 month' },
  '3M': { months: 3, words: '3 months' },
  '6M': { months: 6, words: '6 months' },
  '1Y': { months: 12, words: '1 year' },
  '2Y': { months: 24, words: '2 years' },
  '3Y': { months: 36, words: '3 years' },
  '5Y': { months: 60, words: '5 years' },
  '10Y': { months: 120, words: '10 years' },
};

/** The lookbacks used across the platform. */
export const QUICK_PERIODS: readonly QuickPeriodKey[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '2Y', '3Y'];

const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The last weekday on or before `date`. */
export function lastWeekday(date: string): string {
  let d = date;
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1);
  return d;
}

/**
 * IST date of the latest trading day: today on a weekday — once `closeMinute` (IST minutes) has passed, when given
 * (a daily candle is final only after the close) — else the weekday before.
 */
export function latestTradingDay(closeMinute: number | null, now = Date.now()): string {
  const ist = new Date(now + IST_MS);
  const today = ist.toISOString().slice(0, 10);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const wd = weekday(today);
  if (wd >= 1 && wd <= 5 && (closeMinute === null || minute >= closeMinute)) return today;
  return lastWeekday(addDays(today, -1));
}

/** First day of the quick period `key` ending on `end` (inclusive). */
export function quickFrom(end: string, key: QuickPeriodKey): string {
  const s = QUICK_PERIOD_SPEC[key];
  if (s.days) return addDays(end, -(s.days - 1));
  const d = new Date(`${end}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - s.months!;
  // Day 0 of the next month = the last day of this one.
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return addDays(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))).toISOString().slice(0, 10), 1);
}
