/**
 * MCX market calendar — the ONLY place MCX V2 derives session times and
 * candle boundaries from. Defaults: weekdays 09:00 IST until 23:30 while the
 * US observes daylight saving, 23:55 otherwise. Holidays and special sessions
 * come from data (mcx_calendar rows), never from timestamps in code.
 *
 * Candle alignment follows Kite: intraday candles (incl. derived 2h/4h) start
 * at the session open; daily candles at IST midnight; weekly on Monday.
 */
import type { CalendarEntry, McxTimeframe } from '@/shared/mcx';
import { MCX2_TIMEFRAME } from '@/shared/mcx';
import {
  IST_OFFSET_MS,
  MCX_CLOSE_MIN_US_DST,
  MCX_CLOSE_MIN_US_STANDARD,
  MCX_OPEN_MIN,
  istDate,
  istMinuteOfDay,
  usDstInEffect,
} from '../../utils/marketTime';

const MINUTE = 60_000;
const DAY = 86_400_000;

export interface DaySession {
  date: string;
  trading: boolean;
  openMin: number;
  closeMin: number;
  /** Why the day is special: holiday / special session note. */
  note?: string;
}

/** Epoch ms of IST midnight for a yyyy-mm-dd date. */
export function dateStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS;
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export class McxMarketCalendar {
  private readonly overrides = new Map<string, CalendarEntry>();

  constructor(entries: CalendarEntry[] = []) {
    for (const e of entries) this.overrides.set(e.date, e);
  }

  session(date: string): DaySession {
    const o = this.overrides.get(date);
    if (o?.kind === 'HOLIDAY') return { date, trading: false, openMin: 0, closeMin: 0, note: o.note ?? 'Holiday' };
    if (o?.kind === 'SPECIAL_SESSION') return { date, trading: true, openMin: o.openMin, closeMin: o.closeMin, note: o.note ?? 'Special session' };
    const wd = weekday(date);
    if (wd === 0 || wd === 6) return { date, trading: false, openMin: 0, closeMin: 0 };
    return { date, trading: true, openMin: MCX_OPEN_MIN, closeMin: usDstInEffect(date) ? MCX_CLOSE_MIN_US_DST : MCX_CLOSE_MIN_US_STANDARD };
  }

  isTradingDay(date: string): boolean {
    return this.session(date).trading;
  }

  sessionStart(date: string): number {
    return dateStartMs(date) + this.session(date).openMin * MINUTE;
  }

  sessionEnd(date: string): number {
    return dateStartMs(date) + this.session(date).closeMin * MINUTE;
  }

  /** In session now (with an optional grace period after the close). */
  isMarketOpen(now: number, graceMinutes = 0): boolean {
    const s = this.session(istDate(now));
    if (!s.trading) return false;
    const m = istMinuteOfDay(now);
    return m >= s.openMin && m <= s.closeMin + graceMinutes;
  }

  previousTradingDay(date: string): string | null {
    for (let i = 1; i <= 14; i++) {
      const d = addDays(date, -i);
      if (this.isTradingDay(d)) return d;
    }
    return null;
  }

  /** Open time (ms) of the `tf` candle containing instant `ms`. */
  periodOpen(ms: number, tf: McxTimeframe): number {
    const date = istDate(ms);
    const dayStart = dateStartMs(date);
    if (tf === '1d') return dayStart;
    if (tf === '1w') return dayStart - ((weekday(date) + 6) % 7) * DAY;
    const open = dayStart + this.session(date).openMin * MINUTE;
    const step = MCX2_TIMEFRAME[tf].minutes * MINUTE;
    return open + Math.floor((ms - open) / step) * step;
  }

  /** When the candle that opened at `openMs` closes (the last intraday candle is truncated at the close). */
  candleClose(openMs: number, tf: McxTimeframe): number {
    const date = istDate(openMs);
    if (tf === '1d') return this.sessionEnd(date);
    if (tf === '1w') {
      // Last trading day of that Monday-start week (Friday unless it's a holiday).
      for (let i = 4; i >= 0; i--) {
        const d = addDays(date, i);
        if (this.isTradingDay(d)) return this.sessionEnd(d);
      }
      return dateStartMs(addDays(date, 4)) + MCX_CLOSE_MIN_US_DST * MINUTE;
    }
    return Math.min(openMs + MCX2_TIMEFRAME[tf].minutes * MINUTE, this.sessionEnd(date));
  }

  /** Open time of the last candle expected to have closed at or before `now` (from the calendar alone). */
  lastCompletedOpen(now: number, tf: McxTimeframe): number | null {
    const today = istDate(now);
    const lastOfDay = (date: string): number => {
      if (tf === '1d') return dateStartMs(date);
      if (tf === '1w') return this.periodOpen(dateStartMs(date), '1w');
      return this.periodOpen(this.sessionEnd(date) - 1, tf);
    };
    const fromPreviousDay = (): number | null => {
      const prev = this.previousTradingDay(today);
      if (!prev) return null;
      if (tf === '1w') {
        const wk = this.periodOpen(dateStartMs(prev), '1w');
        return this.candleClose(wk, '1w') <= now ? wk : this.periodOpen(wk - DAY, '1w');
      }
      return lastOfDay(prev);
    };
    if (!this.isTradingDay(today) || now < this.sessionStart(today)) return fromPreviousDay();
    if (tf === '1d') return now >= this.sessionEnd(today) ? dateStartMs(today) : fromPreviousDay();
    if (tf === '1w') {
      const wk = this.periodOpen(now, '1w');
      return this.candleClose(wk, '1w') <= now ? wk : this.periodOpen(wk - DAY, '1w');
    }
    if (now >= this.sessionEnd(today)) return lastOfDay(today);
    const cand = this.periodOpen(now, tf);
    if (this.candleClose(cand, tf) <= now) return cand;
    const prev = cand - MCX2_TIMEFRAME[tf].minutes * MINUTE;
    return prev >= this.sessionStart(today) ? prev : fromPreviousDay();
  }
}
