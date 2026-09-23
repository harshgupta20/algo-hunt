/**
 * Indian market-session helpers. Vercel runs in UTC, so every session boundary
 * is computed explicitly in IST (UTC+05:30, no DST).
 */
import type { Timeframe } from '@ash/shared';
import { TIMEFRAME_MS } from '@ash/shared';

export const IST_OFFSET_MS = 330 * 60_000;
const MINUTE = 60_000;

/** NSE/BSE F&O regular session, minutes after IST midnight. */
export const SESSION_OPEN_MIN = 9 * 60 + 15; // 09:15
export const SESSION_CLOSE_MIN = 15 * 60 + 30; // 15:30

/** yyyy-mm-dd of the IST calendar day containing `ms`. */
export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "yyyy-mm-dd HH:MM:SS" in IST — the format Kite's historical API expects. */
export function istDateTime(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19);
}

/** Minutes since IST midnight for `ms`. */
export function istMinuteOfDay(ms: number): number {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 0 = Sunday … 6 = Saturday, in IST. */
export function istWeekday(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCDay();
}

/** Epoch ms of the session close (15:30 IST) on the IST day containing `ms`. */
export function sessionCloseMs(ms: number): number {
  const dayStartUtc = Date.parse(`${istDate(ms)}T00:00:00Z`) - IST_OFFSET_MS;
  return dayStartUtc + SESSION_CLOSE_MIN * MINUTE;
}

/**
 * True during a weekday session window (with a grace period after the close so
 * the final candle of the day is still evaluated). Exchange holidays simply
 * yield no new candles, which the evaluator handles as a no-op.
 */
export function isMarketWindow(ms: number, graceMinutes = 10): boolean {
  const wd = istWeekday(ms);
  if (wd === 0 || wd === 6) return false;
  const m = istMinuteOfDay(ms);
  return m >= SESSION_OPEN_MIN && m <= SESSION_CLOSE_MIN + graceMinutes;
}

/**
 * When a Kite candle that opened at `openMs` closes. Kite aligns candles to the
 * 09:15 open, and the last candle of the day is truncated at 15:30 (e.g. the
 * 15:15 hourly candle closes at 15:30, not 16:15).
 */
export function candleCloseMs(openMs: number, timeframe: Timeframe): number {
  return Math.min(openMs + TIMEFRAME_MS[timeframe], sessionCloseMs(openMs));
}

/** Kite access tokens are invalidated at ~06:00 IST the next morning. */
export function nextKiteTokenExpiry(fromMs: number): number {
  const dayStartUtc = Date.parse(`${istDate(fromMs)}T00:00:00Z`) - IST_OFFSET_MS;
  const sixAm = dayStartUtc + 6 * 60 * MINUTE;
  return fromMs < sixAm ? sixAm : sixAm + 24 * 60 * MINUTE;
}
