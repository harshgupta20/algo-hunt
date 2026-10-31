/**
 * When the paper trades kept on this computer go to the database: a few minutes after each market's close
 * (NSE / BSE 15:30, MCX 23:30 or 23:55), on that market's trading days — after the square-off and expiry closes
 * have run. A close that passed while the app was off counts too: the next start catches up.
 */
import type { Market } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import type { MarketCalendar } from '../calendar/MarketCalendar';

/** After the close: square-off / expiry closes may use the live price until 5 minutes after it. */
export const PAPER_SYNC_AFTER_CLOSE_MS = 6 * 60_000;
const DAY = 86_400_000;
/** How far back / ahead to look for a trading day (long holidays included). */
const LOOK_DAYS = 14;

function syncPoints(cals: Record<Market, MarketCalendar>, around: number, dir: -1 | 1): number[] {
  const out: number[] = [];
  for (let i = 0; i <= LOOK_DAYS; i++) {
    const date = istDate(around + dir * i * DAY);
    for (const cal of Object.values(cals)) if (cal.isTradingDay(date)) out.push(cal.sessionEnd(date) + PAPER_SYNC_AFTER_CLOSE_MS);
  }
  return out;
}

/** The latest sync point at or before `now` (ms), or null. */
export function lastPaperSyncPoint(cals: Record<Market, MarketCalendar>, now: number): number | null {
  const past = syncPoints(cals, now, -1).filter((p) => p <= now);
  return past.length ? Math.max(...past) : null;
}

/** The first sync point after `now` (ms), or null. */
export function nextPaperSyncPoint(cals: Record<Market, MarketCalendar>, now: number): number | null {
  const next = syncPoints(cals, now, 1).filter((p) => p > now);
  return next.length ? Math.min(...next) : null;
}
