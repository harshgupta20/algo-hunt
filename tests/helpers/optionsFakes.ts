/**
 * Fixtures for the Options backtest: an OptionsHistory with fixed contracts (built through the real Upstox
 * mapping) and 1-minute candles, every other interval aggregated from those minutes on the NSE calendar —
 * so 1-minute, 15-minute and daily candles can never disagree.
 */
import type { V2Instrument, V2Product } from '../../src/shared/v2';
import { calendars } from '../../src/server/v2/calendar/MarketCalendar';
import type { NativeInterval } from '../../src/server/v2/data/DataProvider';
import type { ContractList, HistoryStats, OptionsHistory } from '../../src/server/v2/data/OptionsHistory';
import { aggregate, type RawCandle } from '../../src/server/v2/engine/candles';
import { contractInstrument, upstoxToken } from '../../src/server/v2/upstox/instruments';
import { ist } from './v2Fakes';

const DAY = 86_400_000;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

let tok = 40_000;

/** An expired NIFTY contract as Upstox lists it, through the app's mapping. */
export function upContract(productId: string, expiry: string, kind: 'CE' | 'PE' | 'FUT', strike: number | null, lot: number): V2Instrument {
  const name = productId.split(':')[1]!;
  const i = contractInstrument(
    {
      instrument_key: `NSE_FO|${tok++}|${ddmmyyyy(expiry)}`,
      segment: 'NSE_FO',
      trading_symbol: kind === 'FUT' ? `${name} FUT ${expiry}` : `${name} ${strike} ${kind} ${expiry}`,
      instrument_type: kind,
      expiry,
      strike_price: strike ?? 0,
      lot_size: lot,
      tick_size: 5,
    },
    productId,
  );
  if (!i) throw new Error('fixture contract not mapped');
  return i;
}

export function upLadder(productId: string, expiry: string, from: number, to: number, step: number, lot: number): V2Instrument[] {
  const out: V2Instrument[] = [];
  for (let k = from; k <= to; k += step) out.push(upContract(productId, expiry, 'CE', k, lot), upContract(productId, expiry, 'PE', k, lot));
  return out;
}

export function upSpot(productId: string, key: string, symbol: string): V2Instrument {
  return { id: `U:${key}`, token: upstoxToken(key), exchange: 'NSE', productId, kind: 'SPOT', symbol, expiry: null, strike: null, lotSize: 1, tickSize: 0.05 };
}

const hhmm = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(11, 16);

/** A session's 375 one-minute candles: close = price(minute open "HH:MM"); open = the previous close (no wicks). */
export function dayMinutes(date: string, price: (t: string) => number, volume = 100): RawCandle[] {
  const out: RawCandle[] = [];
  let prev: number | null = null;
  for (let m = ist(date, '09:15'); m < ist(date, '15:30'); m += 60_000) {
    const close = price(hhmm(m));
    const open = prev ?? close;
    out.push({ time: m / 1000, open, high: Math.max(open, close), low: Math.min(open, close), close, volume, oi: 1000 });
    prev = close;
  }
  return out;
}

/** Minutes since "HH:MM" (negative before it). */
export const since = (t: string, from: string) => {
  const [a, b] = t.split(':').map(Number);
  const [c, d] = from.split(':').map(Number);
  return a! * 60 + b! - (c! * 60 + d!);
};

export class FixtureHistory implements OptionsHistory {
  readonly name = 'Upstox';
  readonly minutes = new Map<number, RawCandle[]>();
  readonly calls: Array<{ symbol: string; interval: NativeInterval; from: string; to: string }> = [];
  contractCalls = 0;
  private readonly cal = calendars([]).NSE;

  constructor(
    public spot: V2Instrument,
    public list: V2Instrument[],
    public opts: { lastDay: string; coveredFrom?: string | null; gaps?: ContractList['gaps']; notes?: string[] },
  ) {}

  add(inst: V2Instrument, rows: RawCandle[]): this {
    this.minutes.set(inst.token, [...(this.minutes.get(inst.token) ?? []), ...rows].sort((a, b) => a.time - b.time));
    return this;
  }

  async contracts(_p: V2Product, range: { from: string; to: string }, o: { options: boolean; futures: boolean }, stats?: HistoryStats): Promise<ContractList> {
    this.contractCalls++;
    if (stats) stats.fetched++;
    const all = [...new Set(this.list.map((i) => i.expiry!))].sort();
    const upTo = (l: string[]) => {
      const on = l.filter((e) => e >= range.from);
      return new Set([...on.filter((e) => e <= range.to), ...on.filter((e) => e > range.to).slice(0, 3)]);
    };
    const optE = o.options ? upTo([...new Set(this.list.filter((i) => i.kind !== 'FUT').map((i) => i.expiry!))].sort()) : new Set<string>();
    const futE = o.futures ? upTo([...new Set(this.list.filter((i) => i.kind === 'FUT').map((i) => i.expiry!))].sort()) : new Set<string>();
    const contracts = this.list.filter((i) => (i.kind === 'FUT' ? futE : optE).has(i.expiry!));
    const coveredFrom = this.opts.coveredFrom !== undefined ? this.opts.coveredFrom : all.length ? addDays(all[0]!, 1) : null;
    return { spot: this.spot, contracts, coveredFrom, gaps: this.opts.gaps ?? [], notes: this.opts.notes ?? [] };
  }

  async candles(inst: V2Instrument, interval: NativeInterval, from: string, to: string, stats?: HistoryStats): Promise<RawCandle[]> {
    this.calls.push({ symbol: inst.symbol, interval, from, to });
    if (stats) stats.fetched++;
    const max = [this.opts.lastDay, inst.expiry ?? '9999-12-31'].sort()[0]!;
    const end = to < max ? to : max;
    const lo = ist(from, '00:00');
    const hi = ist(addDays(end, 1), '00:00');
    const rows = (this.minutes.get(inst.token) ?? []).filter((c) => c.time * 1000 >= lo && c.time * 1000 < hi);
    return interval === '1m' ? rows : aggregate(rows, interval, this.cal);
  }
}
