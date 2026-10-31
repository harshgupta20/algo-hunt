/**
 * Upstox as the Options backtest's history (OptionsHistory):
 *
 *   contracts   expired expiries (Upstox keeps about six months; not MCX) + today's live ones (instrument file):
 *               every option contract of each expiry from `from` through `to` and the next three, with the lot
 *               size it had; futures only when the strategy reads them (Upstox lists them on monthly expiries)
 *   coverage    the first known expiry has an unknown predecessor, so days up to it aren't covered; two
 *               consecutive expiries much further apart than the product's usual spacing may hide a missing one
 *               (Upstox's list has had holes) — those days are a gap, not tested (expiryCoverage)
 *   candles     expired contracts from the expired-instrument API, the index / stock and live contracts from
 *               the v3 historical API; requests split into Upstox's limits (minutes: ≤ 28 days, 30-minute: ≤ 85
 *               days, daily: ≤ 10 years) on fixed boundaries so a re-run asks for the same pieces (kept in memory)
 *   intervals   1 / 3 / 5 / 15 / 30 min and daily come from Upstox; 10 min is built from 5 min and 1 hour from
 *               30 min, on our calendar (sessions start 09:15, like Kite's). Every candle must sit on its
 *               timeframe's boundary — if Upstox's don't, that timeframe is built from 1-minute candles instead.
 *               Candles outside the session (pre-open) are dropped.
 */
import type { CalendarEntry, V2Instrument, V2Product } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import { childLogger } from '../../utils/logger';
import type { UpstoxApi, UpstoxContract, ExpiredInterval } from '../../services/upstox/upstoxClient';
import { calendars, dateStartMs, lastCompleteDay, type MarketCalendar } from '../calendar/MarketCalendar';
import { aggregate, type RawCandle } from '../engine/candles';
import type { NativeInterval } from '../data/DataProvider';
import type { ContractList, HistoryStats, OptionsHistory } from '../data/OptionsHistory';
import { contractInstrument, downloadInstrumentFiles, expiryDate, isExpiredKey, parseInstrumentFiles, productSpot, upstoxKey, type InstrumentFile } from './instruments';

const log = childLogger('upstox-history');
const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
const fromDayNumber = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** How each native interval is fetched: straight from Upstox, or built from a smaller one. */
type Fetch = { expired: ExpiredInterval; unit: 'minutes' | 'days'; n: number; chunkDays: number } | { from: NativeInterval };
const FETCH: Record<NativeInterval, Fetch> = {
  '1m': { expired: '1minute', unit: 'minutes', n: 1, chunkDays: 28 },
  '3m': { expired: '3minute', unit: 'minutes', n: 3, chunkDays: 28 },
  '5m': { expired: '5minute', unit: 'minutes', n: 5, chunkDays: 28 },
  '10m': { from: '5m' },
  '15m': { expired: '15minute', unit: 'minutes', n: 15, chunkDays: 28 },
  '30m': { expired: '30minute', unit: 'minutes', n: 30, chunkDays: 85 },
  '1h': { from: '30m' },
  '1d': { expired: 'day', unit: 'days', n: 1, chunkDays: 3650 },
};

/** Fixed chunk boundaries (a Monday), so the same span always splits the same way. */
const ANCHOR = dayNumber('2000-01-03');

/** Pieces of [from, to] on fixed `size`-day boundaries, each clamped to [—, max]. */
export function chunks(from: string, to: string, size: number, max: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  const end = to < max ? to : max;
  if (from > end) return out;
  for (let i = Math.floor((dayNumber(from) - ANCHOR) / size); ; i++) {
    const a = fromDayNumber(ANCHOR + i * size);
    if (a > end) break;
    const b = fromDayNumber(ANCHOR + (i + 1) * size - 1);
    out.push({ from: a, to: b < max ? b : max });
  }
  return out;
}

/**
 * Which days have a known expiry schedule. The first known expiry's predecessor isn't known (a nearer expiry may
 * have been dropped), so coverage starts the day after it. A spacing between two consecutive expiries well over
 * the product's usual one (the median spacing of the past expiries: 7 days weekly, ~30 monthly) may hide a
 * missing expiry: the days after the earlier one through the later one are a gap. Holiday shifts (a day or two)
 * stay well inside the margin.
 */
export function expiryCoverage(expiries: string[], today: string): { coveredFrom: string | null; gaps: Array<{ from: string; to: string }> } {
  const all = [...new Set(expiries)].sort();
  if (!all.length) return { coveredFrom: null, gaps: [] };
  const pairs = all.slice(1).map((e, i) => ({ a: all[i]!, b: e, days: dayNumber(e) - dayNumber(all[i]!) }));
  const past = pairs.filter((p) => p.a < today).map((p) => p.days).sort((x, y) => x - y);
  const usual = past.length ? past[Math.floor(past.length / 2)]! : 7;
  const gaps = pairs.filter((p) => p.a < today && p.days > usual * 1.5 + 3).map((p) => ({ from: addDays(p.a, 1), to: p.b }));
  return { coveredFrom: addDays(all[0]!, 1), gaps };
}

/** Memory for candle pieces (past data never changes): least recently used out past `max` candles. */
class PieceCache {
  private readonly map = new Map<string, RawCandle[]>();
  private size = 0;
  constructor(private readonly max: number) {}
  get(key: string): RawCandle[] | undefined {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, rows: RawCandle[]): void {
    const old = this.map.get(key);
    if (old) this.size -= old.length;
    this.map.delete(key);
    this.map.set(key, rows);
    this.size += rows.length;
    for (const [k, v] of this.map) {
      if (this.size <= this.max) break;
      this.map.delete(k);
      this.size -= v.length;
    }
  }
}

export interface UpstoxHistoryDeps {
  /** The market-data client (bound to the live Upstox session). */
  api: () => UpstoxApi;
  /** Holidays / special sessions (the session window and timeframe boundaries). */
  calendar: () => Promise<CalendarEntry[]>;
  now?: () => number;
  /** Today's instrument files (default: downloaded from Upstox). */
  instrumentFiles?: () => Promise<Buffer[]>;
}

/** ~2 million candles ≈ 250 MB at most. */
const MAX_CANDLES = 2_000_000;

export class UpstoxHistory implements OptionsHistory {
  readonly name = 'Upstox';
  private readonly pieces = new PieceCache(MAX_CANDLES);
  private readonly expiryLists = new Map<string, { at: number; list: string[] }>();
  private readonly contractLists = new Map<string, UpstoxContract[]>();
  private file: Promise<InstrumentFile> | null = null;
  private fileDay: string | null = null;
  /** Native intervals whose Upstox candles weren't on our boundaries (built from 1 minute since). */
  private readonly misaligned = new Set<NativeInterval>();

  constructor(private readonly deps: UpstoxHistoryDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private async cal(): Promise<MarketCalendar> {
    return calendars(await this.deps.calendar()).NSE;
  }

  private instrumentFile(): Promise<InstrumentFile> {
    const day = istDate(this.now());
    if (!this.file || this.fileDay !== day) {
      this.fileDay = day;
      const load = this.deps.instrumentFiles ?? (() => downloadInstrumentFiles());
      this.file = load().then((files) => parseInstrumentFiles(files, day));
      this.file.catch(() => {
        this.file = null;
      });
    }
    return this.file;
  }

  /** Past expiries of an underlying (asked again after an hour: a newly expired contract joins the list). */
  private async expiredExpiries(key: string, stats?: HistoryStats): Promise<string[]> {
    const hit = this.expiryLists.get(key);
    if (hit && this.now() - hit.at < 60 * 60_000) return hit.list;
    if (stats) stats.fetched++;
    const list = await this.deps.api().expiries(key);
    this.expiryLists.set(key, { at: this.now(), list });
    return list;
  }

  private async expiredContracts(kind: 'option' | 'future', key: string, expiry: string, stats?: HistoryStats): Promise<UpstoxContract[]> {
    const id = `${kind}|${key}|${expiry}`;
    const hit = this.contractLists.get(id);
    if (hit) {
      if (stats) stats.cached++;
      return hit;
    }
    if (stats) stats.fetched++;
    const api = this.deps.api();
    const list = kind === 'option' ? await api.expiredOptions(key, expiry) : await api.expiredFutures(key, expiry);
    this.contractLists.set(id, list);
    return list;
  }

  async contracts(product: V2Product, range: { from: string; to: string }, opts: { options: boolean; futures: boolean }, stats?: HistoryStats): Promise<ContractList> {
    if (product.market === 'MCX') throw new Error('Upstox has no expired MCX contracts — the Options backtest covers NSE and BSE products');
    const file = await this.instrumentFile();
    const found = productSpot(file, product);
    if (!found) throw new Error(`Upstox lists no futures & options for ${product.symbol} today`);
    const { key, spot } = found;
    if (!opts.options && !opts.futures) return { spot, contracts: [], coveredFrom: range.from, gaps: [], notes: [] };
    const today = istDate(this.now());
    const notes: string[] = [];

    const liveRows = (file.live.get(key) ?? []).filter((c) => expiryDate(c.expiry) >= today);
    const liveExpiries = [...new Set(liveRows.map((c) => expiryDate(c.expiry)))].sort();
    const expired = (await this.expiredExpiries(key, stats)).filter((e) => e < today);
    const all = [...new Set([...expired, ...liveExpiries])].sort();
    if (!all.length) return { spot, contracts: [], coveredFrom: null, gaps: [], notes: ['Upstox lists no expiries for this product'] };

    // Expiries the test reads: on/after `from`, through `to`, plus the next three (NEXT / FAR near the end).
    const upTo = (list: string[]) => {
      const on = list.filter((e) => e >= range.from);
      return [...on.filter((e) => e <= range.to), ...on.filter((e) => e > range.to).slice(0, 3)];
    };
    const optionExpiries = new Set(opts.options ? upTo(all) : []);
    // Futures expire on the monthly expiry — the last expiry of each month.
    const monthly = all.filter((e) => !all.some((x) => x.slice(0, 7) === e.slice(0, 7) && x > e));
    const futureExpiries = new Set(opts.futures ? upTo(monthly) : []);

    const instruments: V2Instrument[] = [];
    const add = (rows: UpstoxContract[], kinds: Array<'OPT' | 'FUT'>) => {
      for (const r of rows) {
        const i = contractInstrument(r, product.id);
        if (i && kinds.includes(i.kind === 'FUT' ? 'FUT' : 'OPT')) instruments.push(i);
      }
    };
    for (const e of [...new Set([...optionExpiries, ...futureExpiries])].sort()) {
      const kinds: Array<'OPT' | 'FUT'> = [...(optionExpiries.has(e) ? (['OPT'] as const) : []), ...(futureExpiries.has(e) ? (['FUT'] as const) : [])];
      if (e >= today) {
        add(liveRows.filter((c) => expiryDate(c.expiry) === e), kinds);
        continue;
      }
      if (optionExpiries.has(e)) {
        const options = await this.expiredContracts('option', key, e, stats);
        if (!options.length) notes.push(`Upstox returned no option contracts for the ${e} expiry`);
        add(options, ['OPT']);
      }
      if (futureExpiries.has(e)) {
        const futures = await this.expiredContracts('future', key, e, stats);
        if (!futures.length) notes.push(`Upstox returned no future for the ${e} expiry`);
        add(futures, ['FUT']);
      }
    }

    const { coveredFrom, gaps } = expiryCoverage(all, today);
    for (const g of gaps) {
      if (g.to < range.from || g.from > range.to) continue;
      notes.push(`Upstox lists no expiry between ${addDays(g.from, -1)} and ${g.to} although this product usually has one more often — one may be missing, so those days weren’t tested`);
    }
    log.debug({ product: product.id, expiries: optionExpiries.size, contracts: instruments.length }, 'upstox contracts');
    return { spot, contracts: instruments, coveredFrom, gaps, notes };
  }

  async candles(inst: V2Instrument, interval: NativeInterval, from: string, to: string, stats?: HistoryStats): Promise<RawCandle[]> {
    const key = upstoxKey(inst);
    if (!key) throw new Error(`${inst.symbol} isn’t an Upstox instrument`);
    const cal = await this.cal();
    const max = [lastCompleteDay(cal, this.now()), inst.expiry ?? '9999-12-31'].sort()[0]!;
    const end = to < max ? to : max;
    if (from > end) return [];
    const rows = await this.native(key, inst, interval, from, end, cal, stats);
    const lo = dateStartMs(from) / 1000;
    const hi = dateStartMs(addDays(end, 1)) / 1000;
    return rows.filter((c) => c.time >= lo && c.time < hi);
  }

  private async native(key: string, inst: V2Instrument, interval: NativeInterval, from: string, to: string, cal: MarketCalendar, stats?: HistoryStats): Promise<RawCandle[]> {
    const how = FETCH[interval];
    if ('from' in how || this.misaligned.has(interval)) {
      const base = 'from' in how ? how.from : '1m';
      return aggregate(await this.native(key, inst, base, from, to, cal, stats), interval, cal);
    }
    const max = [lastCompleteDay(cal, this.now()), inst.expiry ?? '9999-12-31'].sort()[0]!;
    const out: RawCandle[] = [];
    for (const piece of chunks(from, to, how.chunkDays, max)) {
      const id = `${key}|${interval}|${piece.from}|${piece.to}`;
      let rows = this.pieces.get(id);
      if (rows) {
        if (stats) stats.cached++;
      } else {
        if (stats) stats.fetched++;
        const api = this.deps.api();
        rows = isExpiredKey(key) ? await api.expiredCandles(key, how.expired, piece.from, piece.to) : await api.historicalCandles(key, how.unit, how.n, piece.from, piece.to);
        rows = this.inSession(rows, interval, cal);
        this.pieces.set(id, rows);
      }
      out.push(...rows);
    }
    if (!this.aligned(out, interval, cal)) {
      log.warn({ interval, symbol: inst.symbol }, 'upstox candles off our timeframe boundaries — building from 1 minute');
      this.misaligned.add(interval);
      return this.native(key, inst, interval, from, to, cal, stats);
    }
    return out;
  }

  /** Intraday candles inside the session (pre-open / after-hours rows dropped). */
  private inSession(rows: RawCandle[], interval: NativeInterval, cal: MarketCalendar): RawCandle[] {
    if (interval === '1d') return rows;
    return rows.filter((c) => {
      const d = istDate(c.time * 1000);
      const ms = c.time * 1000;
      return cal.isTradingDay(d) && ms >= cal.sessionStart(d) && ms < cal.sessionEnd(d);
    });
  }

  private aligned(rows: RawCandle[], interval: NativeInterval, cal: MarketCalendar): boolean {
    if (interval === '1m') return true;
    return rows.every((c) => cal.periodOpen(c.time * 1000, interval) === c.time * 1000);
  }
}
