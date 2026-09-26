/**
 * In-memory candles for the live worker, per contract:
 *
 *   official  Kite's historical candles per native interval (warm-up, repairs,
 *             confirmations) — authoritative up to `officialUntil`.
 *   minutes   today's 1-minute candles built from the tick stream.
 *   gaps      time ranges the stream did NOT fully observe (before the
 *             subscription, while a socket was down, late trades).
 *
 * A series for an interval = official candles up to `officialUntil`, then
 * periods aggregated from live minutes (same calendar alignment as Kite). A
 * live period that overlaps a gap is "dirty": the evaluation it feeds must be
 * confirmed against Kite's candles before it may alert or be trusted.
 *
 * Minute building (matches how Kite forms candles):
 *   - price ticks are bucketed by the exchange's last-trade time (index values
 *     by the exchange timestamp) and only inside the market session;
 *   - volume = cumulative day volume at the minute's last trade minus the value
 *     at the previous minute's last trade (pre-open volume lands in the first
 *     candle, like Kite's day total);
 *   - the day's first candle opens at the exchange's day open.
 */
import type { Market, Timeframe } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import type { MarketCalendar } from '../calendar/MarketCalendar';
import { aggregate, type RawCandle } from '../engine/candles';
import type { NativeInterval } from '../data/DataProvider';
import type { Tick } from './ticks';

const MINUTE = 60_000;
/** Official candles closing within this long of the fetch may not be final yet — treated as forming. */
const OFFICIAL_SETTLE_MS = 2_000;
/** Ticks can trail the minute by this much before the minute is closed. */
export const MINUTE_GRACE_MS = 2_000;
/** A subscription is trusted from the first whole minute starting this long after it began. */
const OBSERVE_MARGIN_MS = 2_000;

const floorMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;
const ceilMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE;

export interface SeriesView {
  candles: RawCandle[];
  /** Official history exists for this interval. */
  warmed: boolean;
  /** Some completed live period (at the evaluation time) overlaps a gap. */
  dirty: boolean;
}

class TokenSeries {
  minutes: RawCandle[] = [];
  forming: RawCandle | null = null;
  formingStart = 0;
  /** End of the last closed minute (late-trade detection). */
  closedUntil = 0;
  cumAtMinuteStart: number | null = null;
  lastCum: number | null = null;
  lastPrice: number | undefined;
  observedBeforeSession = false;
  firstTickSeen = false;
  gaps: Array<[number, number]> = [[0, Infinity]];
  official = new Map<NativeInterval, RawCandle[]>();
  officialUntil = new Map<NativeInterval, number>();
  liveCache = new Map<NativeInterval, { key: string; candles: RawCandle[] }>();

  constructor(
    readonly market: Market,
    readonly index: boolean,
  ) {}

  overlapsGap(from: number, to: number): boolean {
    return this.gaps.some(([a, b]) => b > from && a < to);
  }
}

export class LiveCandles {
  private readonly series = new Map<number, TokenSeries>();
  late = 0;

  constructor(private calendars: Record<Market, MarketCalendar>) {}

  setCalendars(c: Record<Market, MarketCalendar>): void {
    this.calendars = c;
  }

  get size(): number {
    return this.series.size;
  }

  has(token: number): boolean {
    return this.series.has(token);
  }

  tokens(): number[] {
    return [...this.series.keys()];
  }

  /** Start keeping candles for a contract (unobserved until the stream reports it). */
  track(token: number, market: Market, index: boolean): void {
    if (!this.series.has(token)) this.series.set(token, new TokenSeries(market, index));
  }

  untrack(token: number): void {
    this.series.delete(token);
  }

  /** New trading day (`now` before its session): live minutes restart; official history is re-fetched by the caller. */
  reset(now: number): void {
    for (const [token, s] of this.series) {
      const next = new TokenSeries(s.market, s.index);
      // Contracts the stream is still delivering are observed from now on; others stay unobserved until it reports them.
      if (!s.gaps.some((g) => g[1] === Infinity)) {
        next.gaps = [[0, ceilMinute(now + OBSERVE_MARGIN_MS)]];
        next.observedBeforeSession = now < this.calendars[s.market].sessionStart(istDate(now));
      }
      this.series.set(token, next);
    }
    this.late = 0;
  }

  /** The stream is delivering these contracts from `at` (subscribed / reconnected). */
  observing(tokens: number[], at: number): void {
    const from = ceilMinute(at + OBSERVE_MARGIN_MS);
    for (const t of tokens) {
      const s = this.series.get(t);
      if (!s) continue;
      for (const g of s.gaps) if (g[1] === Infinity) g[1] = from;
      if (!s.firstTickSeen) s.observedBeforeSession = at < this.calendars[s.market].sessionStart(istDate(at));
    }
  }

  /** The stream stopped delivering these contracts at `at` (socket down). */
  lost(tokens: number[], at: number): void {
    for (const t of tokens) {
      const s = this.series.get(t);
      if (s && !s.gaps.some((g) => g[1] === Infinity)) s.gaps.push([floorMinute(at), Infinity]);
    }
  }

  ingest(tick: Tick, receivedAt: number): void {
    const s = this.series.get(tick.token);
    if (!s) return;
    s.lastPrice = tick.price;
    const cal = this.calendars[s.market];
    if (!s.firstTickSeen) {
      s.firstTickSeen = true;
      // Volume before the first observed tick belongs to the unobserved gap — unless we were watching since before the open.
      s.cumAtMinuteStart = tick.volume === undefined ? null : s.observedBeforeSession ? 0 : tick.volume;
    }
    const time = s.index ? (tick.exchangeTime ?? receivedAt) : tick.tradeTime;
    const cum = tick.volume;
    const newTrades = cum !== undefined && s.lastCum !== null && cum > s.lastCum;
    if (time === undefined) {
      if (cum !== undefined) s.lastCum = cum;
      return;
    }
    const minute = floorMinute(time);
    const date = istDate(minute);
    const inSession = cal.isTradingDay(date) && minute >= cal.sessionStart(date) && minute < cal.sessionEnd(date);
    if (!inSession) {
      if (cum !== undefined) s.lastCum = cum;
      return;
    }
    if (minute < s.closedUntil || (s.forming && minute < s.formingStart)) {
      // A new trade stamped in a minute that's already closed: that minute is now suspect.
      if (newTrades) {
        this.late++;
        s.gaps.push([minute, minute + MINUTE]);
      }
      if (cum !== undefined) s.lastCum = cum;
      return;
    }
    if (s.forming && minute > s.formingStart) this.close(s);
    if (!s.forming) {
      const first = s.minutes.length === 0 && s.observedBeforeSession && tick.dayOpen !== undefined && tick.dayOpen > 0;
      const open = first ? tick.dayOpen! : tick.price;
      s.forming = { time: minute / 1000, open, high: Math.max(open, tick.price), low: Math.min(open, tick.price), close: tick.price, volume: 0 };
      s.formingStart = minute;
      if (s.cumAtMinuteStart === null && cum !== undefined) s.cumAtMinuteStart = s.lastCum ?? cum;
    } else {
      s.forming.high = Math.max(s.forming.high, tick.price);
      s.forming.low = Math.min(s.forming.low, tick.price);
      s.forming.close = tick.price;
    }
    if (cum !== undefined && s.cumAtMinuteStart !== null) s.forming.volume = Math.max(0, cum - s.cumAtMinuteStart);
    if (tick.oi !== undefined && tick.oi > 0) s.forming.oi = tick.oi;
    if (cum !== undefined) s.lastCum = cum;
  }

  private close(s: TokenSeries): void {
    if (!s.forming) return;
    s.minutes.push(s.forming);
    s.closedUntil = s.formingStart + MINUTE;
    s.forming = null;
    s.cumAtMinuteStart = s.lastCum;
    s.liveCache.clear();
  }

  /** Close every minute that ended at least MINUTE_GRACE_MS before `now`. */
  finalize(now: number): void {
    for (const s of this.series.values()) {
      if (s.forming && s.formingStart + MINUTE + MINUTE_GRACE_MS <= now) this.close(s);
    }
  }

  /** Merge Kite's candles for an interval (fetched at `fetchedAt`); they override live-built ones. */
  applyOfficial(token: number, interval: NativeInterval, rows: RawCandle[], fetchedAt: number): void {
    const s = this.series.get(token);
    if (!s) return;
    const cal = this.calendars[s.market];
    const settled = fetchedAt - OFFICIAL_SETTLE_MS;
    const complete = rows.filter((c) => cal.candleClose(c.time * 1000, interval as Timeframe) <= settled);
    const prev = s.official.get(interval) ?? [];
    const first = complete[0]?.time ?? Infinity;
    s.official.set(interval, prev.filter((c) => c.time < first).concat(complete));
    const merged = s.official.get(interval)!;
    const lastClose = merged.length ? cal.candleClose(merged.at(-1)!.time * 1000, interval as Timeframe) : -Infinity;
    // Kite's data counts as complete up to the fetch — unless it lacks a period we saw trades in (it's still catching up).
    let until = Math.max(cal.periodOpen(settled, interval as Timeframe), lastClose);
    const have = new Set(merged.map((c) => c.time));
    const seen = s.minutes.filter((m) => m.time * 1000 >= lastClose && m.time * 1000 < until);
    for (const p of interval === '1m' ? seen : aggregate(seen, interval as Timeframe, cal)) {
      if (!have.has(p.time)) {
        until = p.time * 1000;
        break;
      }
    }
    s.officialUntil.set(interval, Math.max(s.officialUntil.get(interval) ?? -Infinity, until));
    s.liveCache.delete(interval);
  }

  officialUntil(token: number, interval: NativeInterval): number | undefined {
    return this.series.get(token)?.officialUntil.get(interval);
  }

  /** The candle series for an interval as known now, and whether it can be trusted at evaluation time `at`. */
  view(token: number, interval: NativeInterval, at: number): SeriesView {
    const s = this.series.get(token);
    if (!s) return { candles: [], warmed: false, dirty: true };
    const cal = this.calendars[s.market];
    const until = s.officialUntil.get(interval);
    const official = s.official.get(interval) ?? [];
    const start = until ?? -Infinity;
    const key = `${s.minutes.length}|${start}`;
    let cached = s.liveCache.get(interval);
    if (!cached || cached.key !== key) {
      const minutes = s.minutes.filter((m) => m.time * 1000 >= start);
      cached = { key, candles: interval === '1m' ? minutes : aggregate(minutes, interval as Timeframe, cal) };
      s.liveCache.set(interval, cached);
    }
    let dirty = until === undefined;
    for (const c of cached.candles) {
      const open = c.time * 1000;
      const close = cal.candleClose(open, interval as Timeframe);
      if (close > at) break;
      if (s.overlapsGap(open, close)) {
        dirty = true;
        break;
      }
    }
    return { candles: official.concat(cached.candles), warmed: until !== undefined, dirty };
  }

  /** The live-built candle of an interval that opened at `openMs` (stability check against Kite's). */
  liveCandle(token: number, interval: NativeInterval, openMs: number): RawCandle | undefined {
    const s = this.series.get(token);
    if (!s) return undefined;
    const cal = this.calendars[s.market];
    const close = cal.candleClose(openMs, interval as Timeframe);
    const minutes = s.minutes.filter((m) => m.time * 1000 >= openMs && m.time * 1000 < close);
    if (!minutes.length) return undefined;
    return interval === '1m' ? minutes[0] : aggregate(minutes, interval as Timeframe, cal)[0];
  }

  officialCandle(token: number, interval: NativeInterval, openMs: number): RawCandle | undefined {
    return this.series.get(token)?.official.get(interval)?.find((c) => c.time * 1000 === openMs);
  }

  /** Price at `at`: close of the last minute that ended by then, else the last tick. */
  priceAt(token: number, at: number): number | undefined {
    const s = this.series.get(token);
    if (!s) return undefined;
    for (let i = s.minutes.length - 1; i >= 0; i--) if (s.minutes[i]!.time * 1000 + MINUTE <= at) return s.minutes[i]!.close;
    return s.lastPrice;
  }

  lastPrice(token: number): number | undefined {
    return this.series.get(token)?.lastPrice;
  }
}
