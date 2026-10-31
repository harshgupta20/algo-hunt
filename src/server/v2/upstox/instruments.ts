/**
 * Upstox contracts as V2 instruments, and Upstox's daily instrument file.
 *
 *   id / token  `U:<instrument_key>` (expired keys carry their expiry: `NSE_FO|47983|17-04-2025`, so they never
 *               clash with a later contract that reuses the exchange token); `token` is a number derived from the
 *               key (2^52 + 48 bits of its SHA-256 — far from Kite's 32-bit tokens) because the engine keys its
 *               maps by number. A clash between two keys is checked, never assumed away.
 *   tick        Upstox gives tick sizes in paise (5 = ₹0.05)
 *   lot size    as listed for that contract (lots change over time — an expired contract keeps its own)
 *   expiry      yyyy-mm-dd; the instrument file has epoch ms of 23:59:59 IST on the day
 *
 * The instrument file (assets.upstox.com, public, no login) lists today's contracts: it maps our products
 * (NIFTY, SENSEX, RELIANCE…) to Upstox's underlying keys and gives the live (not yet expired) contracts.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { Exchange, LegKind, V2Instrument, V2Product } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import type { UpstoxContract } from '../../services/upstox/upstoxClient';

const TOKEN_BASE = 2 ** 52;
const registry = new Map<number, string>();

/** The engine's numeric token for an Upstox key (stable across runs; throws on the astronomically rare clash). */
export function upstoxToken(key: string): number {
  const h = createHash('sha256').update(key).digest();
  const token = TOKEN_BASE + h.readUIntBE(0, 6);
  const seen = registry.get(token);
  if (seen === undefined) registry.set(token, key);
  else if (seen !== key) throw new Error(`Two Upstox contracts map to one token (${seen}, ${key}) — report this`);
  return token;
}

/** The Upstox key of an instrument built here (null for Kite instruments). */
export function upstoxKey(i: V2Instrument): string | null {
  return i.id.startsWith('U:') ? i.id.slice(2) : null;
}

/** Expired keys end in their expiry (`…|dd-mm-yyyy`): their candles come from the expired-instrument API. */
export const isExpiredKey = (key: string) => /\|\d{2}-\d{2}-\d{4}$/.test(key);

const FO_EXCHANGE: Record<string, Exchange> = { NSE_FO: 'NFO', BSE_FO: 'BFO' };
const SPOT_EXCHANGE: Record<string, Exchange> = { NSE_INDEX: 'NSE', NSE_EQ: 'NSE', BSE_INDEX: 'BSE', BSE_EQ: 'BSE' };

export function expiryDate(e: string | number): string {
  if (typeof e === 'number') return istDate(e);
  if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return e;
  throw new Error(`Unreadable Upstox expiry: ${e}`);
}

/** An Upstox F&O contract (CE / PE / FUT on NSE_FO or BSE_FO) as a V2 instrument of `productId`; null for anything else. */
export function contractInstrument(c: UpstoxContract, productId: string): V2Instrument | null {
  const exchange = FO_EXCHANGE[c.segment];
  const kind = c.instrument_type as LegKind;
  if (!exchange || (kind !== 'CE' && kind !== 'PE' && kind !== 'FUT')) return null;
  const lot = Number(c.lot_size);
  const tick = Number(c.tick_size);
  const strike = kind === 'FUT' ? null : Number(c.strike_price);
  if (!(lot > 0) || !(tick > 0) || (strike !== null && !(strike > 0))) throw new Error(`Upstox listed ${c.trading_symbol} without a usable lot size, tick or strike`);
  return {
    id: `U:${c.instrument_key}`,
    token: upstoxToken(c.instrument_key),
    exchange,
    productId,
    kind,
    symbol: c.trading_symbol,
    expiry: expiryDate(c.expiry),
    strike,
    lotSize: lot,
    tickSize: tick / 100,
  };
}

interface FileRow {
  segment: string;
  instrument_type: string;
  instrument_key: string;
  trading_symbol: string;
  tick_size?: number;
  lot_size?: number;
  expiry?: number;
  strike_price?: number;
  underlying_key?: string;
  underlying_symbol?: string;
  weekly?: boolean;
}

/** Today's Upstox instruments, reduced to what the Options backtest reads. */
export interface InstrumentFile {
  /** IST date it was downloaded. */
  day: string;
  /** `NSE:NIFTY` → `NSE_INDEX|Nifty 50` (from the F&O contracts' underlying). */
  underlyings: Map<string, string>;
  /** Underlying key → its index / cash row. */
  spots: Map<string, FileRow>;
  /** Underlying key → live F&O contracts. */
  live: Map<string, UpstoxContract[]>;
}

const FO_SEGMENT: Record<string, string> = { NSE: 'NSE_FO', BSE: 'BSE_FO' };

/** Parse the gzipped JSON files (NSE.json.gz, BSE.json.gz). */
export function parseInstrumentFiles(files: Buffer[], day: string): InstrumentFile {
  const rows: FileRow[] = files.flatMap((f) => JSON.parse(gunzipSync(f).toString('utf8')) as FileRow[]);
  const underlyings = new Map<string, string>();
  const live = new Map<string, UpstoxContract[]>();
  for (const r of rows) {
    if ((r.segment !== 'NSE_FO' && r.segment !== 'BSE_FO') || !r.underlying_key || !r.underlying_symbol) continue;
    if (r.instrument_type !== 'CE' && r.instrument_type !== 'PE' && r.instrument_type !== 'FUT') continue;
    underlyings.set(`${r.segment === 'NSE_FO' ? 'NSE' : 'BSE'}:${r.underlying_symbol}`, r.underlying_key);
    const list = live.get(r.underlying_key) ?? [];
    list.push({
      instrument_key: r.instrument_key,
      segment: r.segment,
      trading_symbol: r.trading_symbol,
      instrument_type: r.instrument_type,
      expiry: r.expiry ?? NaN,
      strike_price: r.strike_price,
      lot_size: r.lot_size ?? NaN,
      tick_size: r.tick_size ?? NaN,
      underlying_key: r.underlying_key,
      underlying_symbol: r.underlying_symbol,
      weekly: r.weekly,
    });
    live.set(r.underlying_key, list);
  }
  const wanted = new Set(underlyings.values());
  const spots = new Map<string, FileRow>();
  for (const r of rows) if (wanted.has(r.instrument_key) && SPOT_EXCHANGE[r.segment]) spots.set(r.instrument_key, r);
  return { day, underlyings, spots, live };
}

/** The product's Upstox underlying key and spot instrument (null when Upstox has no F&O for it). */
export function productSpot(file: InstrumentFile, product: V2Product): { key: string; spot: V2Instrument } | null {
  const [exchange] = product.id.split(':');
  if (!exchange || !FO_SEGMENT[exchange]) return null;
  const key = file.underlyings.get(`${exchange}:${product.symbol}`);
  const row = key ? file.spots.get(key) : undefined;
  if (!key || !row) return null;
  const tick = Number(row.tick_size);
  return {
    key,
    spot: {
      id: `U:${key}`,
      token: upstoxToken(key),
      exchange: SPOT_EXCHANGE[row.segment]!,
      productId: product.id,
      kind: 'SPOT',
      symbol: row.trading_symbol,
      expiry: null,
      strike: null,
      lotSize: 1,
      tickSize: tick > 0 ? tick / 100 : 0.05,
    },
  };
}

export const INSTRUMENT_FILES = ['https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz', 'https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz'];

/** Download today's files (public; a few MB). */
export async function downloadInstrumentFiles(fetchFn: typeof fetch = fetch): Promise<Buffer[]> {
  return Promise.all(
    INSTRUMENT_FILES.map(async (url) => {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`Upstox instrument file ${url.split('/').pop()}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }),
  );
}
