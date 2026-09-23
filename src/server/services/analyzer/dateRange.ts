/**
 * Resolves a date-range preset into concrete { from, to } yyyy-mm-dd bounds
 * (IST calendar days — the server runs in UTC).
 */
import type { DateRangePreset } from '@ash/shared';
import { istDate as isoDate } from '../../utils/marketTime';

const DAY = 86_400_000;

/** Count NSE weekdays (Mon–Fri) within an inclusive yyyy-mm-dd range. */
export function tradingDaysInRange(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  let count = 0;
  for (let d = start; d <= end; d += DAY) {
    const dow = new Date(d).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return Math.max(count, 1);
}

export function resolveDateRange(
  preset: DateRangePreset,
  from?: string,
  to?: string,
  now: number = Date.now(),
): { from: string; to: string } {
  const today = isoDate(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = isoDate(now - DAY);
      return { from: y, to: y };
    }
    case 'last-week':
      return { from: isoDate(now - 7 * DAY), to: today };
    case 'last-month':
      return { from: isoDate(now - 30 * DAY), to: today };
    case 'last-3-months':
      return { from: isoDate(now - 90 * DAY), to: today };
    case 'last-6-months':
      return { from: isoDate(now - 180 * DAY), to: today };
    case 'last-year':
      return { from: isoDate(now - 365 * DAY), to: today };
    case 'custom':
      if (!from || !to) throw new Error('Custom date range requires both from and to');
      return { from, to };
  }
}
