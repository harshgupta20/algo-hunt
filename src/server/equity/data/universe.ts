/**
 * The equity universe: every NSE cash stock (equity series — no -BE / -SM / bond series), from Kite's NSE
 * instrument list, refreshed once a day and kept in memory plus a small file next to the app's other local data
 * (data/equity-instruments.json) so a restart works before Kite is logged in. Never in the database.
 * Index lists (NIFTY 50 / Next 50 / Midcap 150 / Smallcap 250 / 500, with sectors) and the F&O list are
 * injected by the app's wiring.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EqPreset, EqPresetInfo, EqStock } from '@/shared/equity';
import { EQ_PRESETS } from '@/shared/equity';
import { childLogger } from '../../utils/logger';

const log = childLogger('equity');
const REFRESH_MS = 18 * 3600_000;

/** A Kite NSE instrument row (the fields used). */
interface KiteRow {
  instrument_token: number | string;
  tradingsymbol: string;
  name?: string;
  segment?: string;
  instrument_type?: string;
  exchange?: string;
}

/** Index membership from NSE's constituent files: N50 · NN50 · MID150 · SML250 (all are in the NIFTY 500). */
export interface ListedStock {
  symbol: string;
  sector: string;
  groups: string[];
}

export interface UniverseDeps {
  /** Run a call with the logged-in Kite client. */
  kite: <T>(fn: (kc: { getInstruments(exchange: string): Promise<KiteRow[]> }) => Promise<T>) => Promise<T>;
  /** NSE index constituents (undefined when NSE's files can't be read). */
  lists: () => Promise<ListedStock[] | undefined>;
  /** Symbols of stocks with futures (the F&O list). */
  fno: () => Promise<string[]>;
  file?: string;
  now?: () => number;
}

interface Snapshot {
  fetchedAt: number;
  stocks: Array<{ symbol: string; name: string; token: number }>;
  /** NIFTY 50 index token (the benchmark). */
  nifty50: number | null;
}

/** NSE equity-series symbols: letters, digits, & — a hyphen only before a word of 3+ characters (BAJAJ-AUTO, not -BE / -SM). */
const EQ_SYMBOL = /^[A-Z0-9&]+(?:-[A-Z0-9&]{3,})*$/;

export function stocksFromKite(rows: KiteRow[]): Snapshot['stocks'] {
  const out: Snapshot['stocks'] = [];
  for (const r of rows) {
    if (r.segment !== 'NSE' || r.instrument_type !== 'EQ' || !EQ_SYMBOL.test(r.tradingsymbol)) continue;
    out.push({ symbol: r.tradingsymbol, name: (r.name ?? '').trim() || r.tradingsymbol, token: Number(r.instrument_token) });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function universeFile(): string {
  const pending = process.env.PENDING_WRITES_FILE?.trim() || 'data/pending-writes.json';
  return path.join(path.dirname(pending), 'equity-instruments.json');
}

const PRESET_GROUP: Partial<Record<EqPreset, string[]>> = { NIFTY50: ['N50'], NIFTYNEXT50: ['NN50'], NIFTY100: ['N50', 'NN50'], MIDCAP150: ['MID150'], SMALLCAP250: ['SML250'] };

export class Universe {
  private snap: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;
  private readonly file: string;
  private readonly now: () => number;

  constructor(private readonly deps: UniverseDeps) {
    this.file = deps.file ?? universeFile();
    this.now = deps.now ?? Date.now;
  }

  private readFile(): Snapshot | null {
    try {
      if (!existsSync(this.file)) return null;
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Snapshot;
      return Array.isArray(s.stocks) && s.stocks.length ? s : null;
    } catch {
      return null;
    }
  }

  private writeFile(s: Snapshot) {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(s));
      renameSync(tmp, this.file);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'could not save the equity stock list');
    }
  }

  private async fetch(): Promise<Snapshot> {
    const rows = await this.deps.kite((kc) => kc.getInstruments('NSE'));
    const nifty = rows.find((r) => r.segment === 'INDICES' && r.tradingsymbol === 'NIFTY 50');
    const s: Snapshot = { fetchedAt: this.now(), stocks: stocksFromKite(rows), nifty50: nifty ? Number(nifty.instrument_token) : null };
    if (!s.stocks.length) throw new Error('Kite returned no NSE stocks');
    this.writeFile(s);
    log.info({ stocks: s.stocks.length }, 'equity stock list refreshed');
    return s;
  }

  /** The stock list: memory → file → Kite; refreshed from Kite once it is older than 18 h (the old list is used if that fails). */
  async snapshot(): Promise<Snapshot> {
    this.snap ??= this.readFile();
    const fresh = this.snap && this.now() - this.snap.fetchedAt < REFRESH_MS;
    if (fresh) return this.snap!;
    this.loading ??= this.fetch()
      .then((s) => (this.snap = s))
      .catch((err) => {
        if (this.snap) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, 'equity stock list refresh failed — using the saved one');
          return this.snap;
        }
        throw new Error(`The NSE stock list isn’t loaded yet and Kite couldn’t be reached (${err instanceof Error ? err.message : String(err)}). Log in to Kite and try again.`);
      })
      .finally(() => (this.loading = null));
    return this.loading;
  }

  async benchmarkToken(): Promise<number | null> {
    return (await this.snapshot()).nifty50;
  }

  /** Every stock with its sector and presets. */
  async all(): Promise<EqStock[]> {
    const [snap, lists, fno] = await Promise.all([this.snapshot(), this.deps.lists().catch(() => undefined), this.deps.fno().catch(() => [] as string[])]);
    const listed = new Map((lists ?? []).map((l) => [l.symbol, l]));
    const fnoSet = new Set(fno);
    return snap.stocks.map((s) => {
      const l = listed.get(s.symbol);
      const presets: EqPreset[] = ['ALL'];
      if (l) {
        presets.push('NIFTY500');
        for (const [p, groups] of Object.entries(PRESET_GROUP)) if (groups!.some((g) => l.groups.includes(g))) presets.push(p as EqPreset);
      }
      if (fnoSet.has(s.symbol)) presets.push('FNO');
      return { symbol: s.symbol, name: s.name, token: s.token, sector: l?.sector ?? null, presets };
    });
  }

  async presets(): Promise<EqPresetInfo[]> {
    const [stocks, lists] = await Promise.all([this.all(), this.deps.lists().catch(() => undefined)]);
    return EQ_PRESETS.map(({ value, label }) => {
      const count = stocks.filter((s) => s.presets.includes(value)).length;
      const fromNse = value !== 'ALL' && value !== 'FNO';
      return { preset: value, label, count, ...(fromNse && !lists ? { note: 'NSE’s index lists couldn’t be read right now — try again later' } : {}) };
    });
  }

  async search(q: { search?: string; preset?: EqPreset; symbols?: string[]; limit?: number }): Promise<{ total: number; stocks: EqStock[] }> {
    let list = await this.all();
    if (q.preset) list = list.filter((s) => s.presets.includes(q.preset!));
    if (q.symbols) {
      const want = new Set(q.symbols);
      list = list.filter((s) => want.has(s.symbol));
    }
    const term = q.search?.trim().toUpperCase();
    if (term) {
      list = list.filter((s) => s.symbol.includes(term) || s.name.toUpperCase().includes(term));
      // Exact and prefix symbol matches first.
      list.sort((a, b) => Number(b.symbol === term) - Number(a.symbol === term) || Number(b.symbol.startsWith(term)) - Number(a.symbol.startsWith(term)) || a.symbol.localeCompare(b.symbol));
    }
    return { total: list.length, stocks: q.limit ? list.slice(0, q.limit) : list };
  }

  /** Stocks for these symbols (unknown symbols listed separately). */
  async resolve(symbols: string[]): Promise<{ found: EqStock[]; unknown: string[] }> {
    const bySymbol = new Map((await this.all()).map((s) => [s.symbol, s]));
    const found: EqStock[] = [];
    const unknown: string[] = [];
    for (const sym of [...new Set(symbols.map((s) => s.trim().toUpperCase()))]) {
      const s = bySymbol.get(sym);
      if (s) found.push(s);
      else unknown.push(sym);
    }
    return { found, unknown };
  }
}
