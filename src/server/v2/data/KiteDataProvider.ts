/**
 * Kite Connect implementation of the V2 data provider.
 *
 * Instruments: NSE (indices + cash stocks), BSE (SENSEX / BANKEX indices), NFO
 * and BFO (index + stock futures and options) and MCX (futures + options of
 * the known commodities). Historical candles go through the app's shared
 * KiteHistoricalProvider so every subsystem shares one rate gate; LTP / quote
 * calls are batched (≤1000 / ≤500 instruments per request).
 */
import type { Exchange, LegKind, V2Instrument } from '@/shared/v2';
import { KNOWN_PRODUCTS } from '@/shared/v2';
import type { KiteAuthService } from '../../services/kite/kiteAuth';
import { withKiteRetry } from '../../services/kite/kiteClient';
import type { KiteHistoricalProvider } from '../../services/kite/KiteHistoricalProvider';
import { istDate } from '../../utils/marketTime';
import type { RawCandle } from '../engine/candles';
import type { CandleQuery, InstrumentDump, Quote, V2DataProvider } from './DataProvider';

export interface KiteRow {
  instrument_token: number | string;
  tradingsymbol: string;
  name?: string;
  expiry?: string | Date | null;
  strike?: number | string;
  instrument_type: string;
  segment?: string;
  exchange: string;
  lot_size?: number | string;
  tick_size?: number | string;
}

const LTP_BATCH = 1000;
const QUOTE_BATCH = 500;

const INDEX_BY_SYMBOL = new Map(KNOWN_PRODUCTS.filter((p) => p.indexSymbol).map((p) => [`${p.id.split(':')[0]}|${p.indexSymbol}`, p]));
const MCX_SYMBOLS = new Set(KNOWN_PRODUCTS.filter((p) => p.market === 'MCX').map((p) => p.symbol));
const BSE_DERIV = new Set(['SENSEX', 'BANKEX']);

function expiryOf(v: KiteRow['expiry']): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v.slice(0, 10) || null : v.toISOString().slice(0, 10);
}

function make(r: KiteRow, productId: string, kind: LegKind, exchange: Exchange): V2Instrument {
  const token = Number(r.instrument_token);
  const isOption = kind === 'CE' || kind === 'PE';
  return {
    id: `K:${token}`,
    token,
    exchange,
    productId,
    kind,
    symbol: r.tradingsymbol,
    expiry: kind === 'SPOT' ? null : expiryOf(r.expiry),
    strike: isOption ? Number(r.strike) || 0 : null,
    lotSize: Number(r.lot_size) || 1,
    tickSize: Number(r.tick_size) || 0,
  };
}

/** Maps one row of a Kite instrument dump to a V2 instrument (or null when unsupported). */
export function mapRow(r: KiteRow, today: string, stockNames?: Record<string, string>): V2Instrument | null {
  const ex = r.exchange as Exchange;
  const type = r.instrument_type;
  const expiry = expiryOf(r.expiry);
  if (expiry && expiry < today) return null;
  const derivKind: LegKind | null = type === 'FUT' ? 'FUT' : type === 'CE' || type === 'PE' ? type : null;
  switch (ex) {
    case 'NSE':
    case 'BSE': {
      if (r.segment === 'INDICES') {
        const p = INDEX_BY_SYMBOL.get(`${ex}|${r.tradingsymbol}`);
        return p ? make(r, p.id, 'SPOT', ex) : null;
      }
      // Cash stocks: NSE equity series only (tradingsymbols without a "-BE"-style suffix).
      if (ex === 'NSE' && type === 'EQ' && r.segment === 'NSE' && /^[A-Z0-9&]+$/.test(r.tradingsymbol)) {
        if (stockNames && r.name) stockNames[r.tradingsymbol] = r.name;
        return make(r, `NSE:${r.tradingsymbol}`, 'SPOT', ex);
      }
      return null;
    }
    case 'NFO':
      return derivKind && r.name ? make(r, `NSE:${r.name}`, derivKind, ex) : null;
    case 'BFO':
      return derivKind && r.name && BSE_DERIV.has(r.name) ? make(r, `BSE:${r.name}`, derivKind, ex) : null;
    case 'MCX': {
      if (!derivKind) return null;
      const name = r.name?.trim().toUpperCase();
      const product = name && MCX_SYMBOLS.has(name) ? name : /^([A-Z]+)\d/.exec(r.tradingsymbol)?.[1];
      return product && MCX_SYMBOLS.has(product) ? make(r, `MCX:${product}`, derivKind, ex) : null;
    }
    default:
      return null;
  }
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const key = (i: V2Instrument) => `${i.exchange}:${i.symbol}`;

export class KiteDataProvider implements V2DataProvider {
  readonly name = 'kite';

  constructor(
    private readonly auth: KiteAuthService,
    private readonly historical: KiteHistoricalProvider,
  ) {}

  isConnected(): Promise<boolean> {
    return this.auth.isConnected();
  }

  async getInstruments(): Promise<InstrumentDump> {
    const today = istDate(Date.now());
    const stockNames: Record<string, string> = {};
    const instruments: V2Instrument[] = [];
    for (const exchange of ['NSE', 'BSE', 'NFO', 'BFO', 'MCX']) {
      const rows = await this.auth.call((kc) => withKiteRetry<KiteRow[]>(() => kc.getInstruments(exchange)));
      for (const r of rows) {
        const i = mapRow(r, today, stockNames);
        if (i) instruments.push(i);
      }
    }
    return { instruments, stockNames };
  }

  async getHistoricalCandles(q: CandleQuery): Promise<RawCandle[]> {
    // Continuous (stitched expired contracts) exists only for futures day candles.
    const continuous = q.instrument.kind === 'FUT' && q.interval === '1d';
    return this.historical.getCandles({ token: q.instrument.token, timeframe: q.interval, from: q.from, to: q.to, continuous });
  }

  async getLtp(instruments: V2Instrument[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    for (const batch of chunks(instruments, LTP_BATCH)) {
      const res = await this.auth.call((kc) => withKiteRetry<Record<string, { instrument_token: number; last_price: number }>>(() => kc.getLTP(batch.map(key))));
      for (const v of Object.values(res ?? {})) if (Number.isFinite(v.last_price)) out.set(Number(v.instrument_token), v.last_price);
    }
    return out;
  }

  async getQuotes(instruments: V2Instrument[]): Promise<Map<number, Quote>> {
    const out = new Map<number, Quote>();
    for (const batch of chunks(instruments, QUOTE_BATCH)) {
      const res = await this.auth.call((kc) =>
        withKiteRetry<Record<string, { instrument_token: number; last_price: number; volume?: number; oi?: number; net_change?: number }>>(() => kc.getQuote(batch.map(key))),
      );
      for (const v of Object.values(res ?? {})) out.set(Number(v.instrument_token), { ltp: v.last_price, volume: v.volume, oi: v.oi, change: v.net_change });
    }
    return out;
  }
}
