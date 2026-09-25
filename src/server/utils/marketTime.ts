/**
 * Indian market-session helpers. Vercel runs in UTC, so every session boundary
 * is computed explicitly in IST (UTC+05:30, no DST).
 *
 * Two markets, two sessions:
 *  - NSE/BSE F&O: 09:15–15:30 IST.
 *  - MCX (non-agri commodities): 09:00–23:30 IST while the US observes daylight
 *    saving, 09:00–23:55 otherwise (MCX shifts its close with US time so the
 *    evening overlaps COMEX/NYMEX).
 * Every helper takes a Session and defaults to NSE, the original market.
 */
import type { Segment, Timeframe } from '@ash/shared';
import { TIMEFRAME_MS, segmentOf } from '@ash/shared';

export const IST_OFFSET_MS = 330 * 60_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** NSE/BSE F&O regular session, minutes after IST midnight. */
export const SESSION_OPEN_MIN = 9 * 60 + 15; // 09:15
export const SESSION_CLOSE_MIN = 15 * 60 + 30; // 15:30

/** MCX session, minutes after IST midnight. */
export const MCX_OPEN_MIN = 9 * 60; // 09:00
export const MCX_CLOSE_MIN_US_DST = 23 * 60 + 30; // 23:30
export const MCX_CLOSE_MIN_US_STANDARD = 23 * 60 + 55; // 23:55

export interface Session {
  readonly segment: Segment;
  /** Minutes after IST midnight the session opens. */
  readonly openMin: number;
  /** Minutes after IST midnight the session closes on IST calendar day `date` (yyyy-mm-dd). */
  closeMin(date: string): number;
}

/** yyyy-mm-dd of the n-th Sunday of a month (month 1–12). */
function nthSunday(year: number, month: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const day = 1 + ((7 - first.getUTCDay()) % 7) + (n - 1) * 7;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Whether the US is on daylight saving time for an IST trading day. US DST runs
 * from the 2nd Sunday of March to the 1st Sunday of November; MCX applies the
 * change from the following Monday, which is exactly the "strictly between"
 * range for trading days (the Sundays themselves never trade).
 */
export function usDstInEffect(date: string): boolean {
  const year = Number(date.slice(0, 4));
  return date > nthSunday(year, 3, 2) && date < nthSunday(year, 11, 1);
}

export const NSE_SESSION: Session = { segment: 'NSE', openMin: SESSION_OPEN_MIN, closeMin: () => SESSION_CLOSE_MIN };

export const MCX_SESSION: Session = {
  segment: 'MCX',
  openMin: MCX_OPEN_MIN,
  closeMin: (date) => (usDstInEffect(date) ? MCX_CLOSE_MIN_US_DST : MCX_CLOSE_MIN_US_STANDARD),
};

export function sessionForSegment(segment: Segment): Session {
  return segment === 'MCX' ? MCX_SESSION : NSE_SESSION;
}

/** The session an underlying trades in (MCX products → MCX, everything else → NSE). */
export function sessionFor(underlying: string): Session {
  return sessionForSegment(segmentOf(underlying));
}

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

/** Epoch ms of IST midnight starting the IST day that contains `ms`. */
export function istDayStartMs(ms: number): number {
  return Date.parse(`${istDate(ms)}T00:00:00Z`) - IST_OFFSET_MS;
}

/** Epoch ms of the session open on the IST day containing `ms`. */
export function sessionOpenMs(ms: number, session: Session = NSE_SESSION): number {
  return istDayStartMs(ms) + session.openMin * MINUTE;
}

/** Epoch ms of the session close (15:30 IST on NSE) on the IST day containing `ms`. */
export function sessionCloseMs(ms: number, session: Session = NSE_SESSION): number {
  return istDayStartMs(ms) + session.closeMin(istDate(ms)) * MINUTE;
}

/** Trading minutes in the session on the IST day containing `ms`. */
export function sessionMinutes(ms: number, session: Session = NSE_SESSION): number {
  return session.closeMin(istDate(ms)) - session.openMin;
}

/**
 * True during a weekday session window (with a grace period after the close so
 * the final candle of the day is still evaluated). Exchange holidays simply
 * yield no new candles, which the evaluator handles as a no-op.
 */
export function isMarketWindow(ms: number, graceMinutes = 10, session: Session = NSE_SESSION): boolean {
  const wd = istWeekday(ms);
  if (wd === 0 || wd === 6) return false;
  const m = istMinuteOfDay(ms);
  return m >= session.openMin && m <= session.closeMin(istDate(ms)) + graceMinutes;
}

/** True while either market (NSE/BSE or MCX) is inside its session window. */
export function isAnyMarketWindow(ms: number, graceMinutes = 10): boolean {
  return isMarketWindow(ms, graceMinutes, NSE_SESSION) || isMarketWindow(ms, graceMinutes, MCX_SESSION);
}

/**
 * Open time of the `timeframe` candle containing instant `ms`. Intraday
 * candles align to the session open (Kite: 09:15 on NSE, 09:00 on MCX); daily
 * candles start at IST midnight (Kite's daily timestamp); weekly candles start
 * Monday 00:00 IST.
 */
export function periodOpenMs(ms: number, timeframe: Timeframe, session: Session = NSE_SESSION): number {
  const dayStart = istDayStartMs(ms);
  if (timeframe === '1d') return dayStart;
  if (timeframe === '1w') return dayStart - ((istWeekday(ms) + 6) % 7) * DAY;
  const open = dayStart + session.openMin * MINUTE;
  const step = TIMEFRAME_MS[timeframe];
  return open + Math.floor((ms - open) / step) * step;
}

/**
 * When a Kite candle that opened at `openMs` closes. Kite aligns candles to the
 * session open, and the last candle of the day is truncated at the close (e.g.
 * the 15:15 hourly NSE candle closes at 15:30, not 16:15). A daily candle
 * closes at that day's session close; a weekly one at Friday's close.
 */
export function candleCloseMs(openMs: number, timeframe: Timeframe, session: Session = NSE_SESSION): number {
  if (timeframe === '1d') return sessionCloseMs(openMs, session);
  if (timeframe === '1w') return sessionCloseMs(openMs + 4 * DAY, session);
  return Math.min(openMs + TIMEFRAME_MS[timeframe], sessionCloseMs(openMs, session));
}

/** Kite access tokens are invalidated at ~06:00 IST the next morning. */
export function nextKiteTokenExpiry(fromMs: number): number {
  const dayStartUtc = Date.parse(`${istDate(fromMs)}T00:00:00Z`) - IST_OFFSET_MS;
  const sixAm = dayStartUtc + 6 * 60 * MINUTE;
  return fromMs < sixAm ? sixAm : sixAm + 24 * 60 * MINUTE;
}
