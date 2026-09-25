/**
 * Kite Connect implementation of McxDataProvider. Historical candles go through
 * the app's single KiteHistoricalProvider so V1 and V2 share one rate gate
 * (Kite allows ~3 historical requests/s per API key). LTP/quote calls are
 * batched (≤1000 / ≤500 instruments per request).
 */
import type { McxInstrument } from '@/shared/mcx';
import { MCX2_PRODUCT_BY_SYMBOL } from '@/shared/mcx';
import type { KiteAuthService } from '../../services/kite/kiteAuth';
import { withKiteRetry } from '../../services/kite/kiteClient';
import type { KiteHistoricalProvider } from '../../services/kite/KiteHistoricalProvider';
import { istDate } from '../../utils/marketTime';
import type { RawCandle } from '../engine/candles';
import type { CandleQuery, McxDataProvider, McxQuote } from './McxDataProvider';

interface KiteInstrumentRow {
  instrument_token: number | string;
  tradingsymbol: string;
  name?: string;
  expiry?: string | Date | null;
  strike?: number | string;
  instrument_type: string;
  exchange: string;
  lot_size?: number | string;
  tick_size?: number | string;
}

const LTP_BATCH = 1000;
const QUOTE_BATCH = 500;

function expiryOf(v: KiteInstrumentRow['expiry']): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v.slice(0, 10) || null : v.toISOString().slice(0, 10);
}

/** Product of a Kite MCX row: `name`, else the tradingsymbol prefix (GOLD26OCTFUT → GOLD). */
export function productOf(r: Pick<KiteInstrumentRow, 'name' | 'tradingsymbol'>): string | undefined {
  const name = r.name?.trim().toUpperCase();
  if (name && MCX2_PRODUCT_BY_SYMBOL[name]) return name;
  const prefix = /^([A-Z]+)\d/.exec(r.tradingsymbol)?.[1];
  return prefix && MCX2_PRODUCT_BY_SYMBOL[prefix] ? prefix : undefined;
}

export function toMcxInstrument(r: KiteInstrumentRow, today: string): McxInstrument | null {
  if (r.exchange !== 'MCX') return null;
  const type = r.instrument_type === 'FUT' ? 'MCX_FUTURE' : r.instrument_type === 'CE' || r.instrument_type === 'PE' ? 'MCX_OPTION' : null;
  if (!type) return null;
  const underlying = productOf(r);
  if (!underlying) return null;
  const token = Number(r.instrument_token);
  const expiry = expiryOf(r.expiry);
  return {
    id: `MCX:${token}`,
    token,
    exchange: 'MCX',
    instrumentType: type,
    underlying,
    symbol: r.tradingsymbol,
    expiry,
    strike: type === 'MCX_OPTION' ? Number(r.strike) || 0 : null,
    optionType: type === 'MCX_OPTION' ? (r.instrument_type as 'CE' | 'PE') : null,
    lotSize: Number(r.lot_size) || 1,
    tickSize: Number(r.tick_size) || 0,
    active: !expiry || expiry >= today,
  };
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export class KiteMcxDataProvider implements McxDataProvider {
  readonly name = 'kite';

  constructor(
    private readonly auth: KiteAuthService,
    private readonly historical: KiteHistoricalProvider,
  ) {}

  isConnected(): Promise<boolean> {
    return this.auth.isConnected();
  }

  async getInstruments(): Promise<McxInstrument[]> {
    const rows = await this.auth.call((kc) => withKiteRetry<KiteInstrumentRow[]>(() => kc.getInstruments('MCX')));
    const today = istDate(Date.now());
    return rows.map((r) => toMcxInstrument(r, today)).filter((i): i is McxInstrument => i !== null);
  }

  async getHistoricalCandles(q: CandleQuery): Promise<RawCandle[]> {
    // Continuous (stitched expired contracts) exists only for futures day candles.
    const continuous = q.instrument.instrumentType === 'MCX_FUTURE' && q.interval === '1d';
    return this.historical.getCandles({ token: q.instrument.token, timeframe: q.interval, from: q.from, to: q.to, continuous });
  }

  async getLtp(instruments: McxInstrument[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    for (const batch of chunks(instruments, LTP_BATCH)) {
      const res = await this.auth.call((kc) =>
        withKiteRetry<Record<string, { instrument_token: number; last_price: number }>>(() => kc.getLTP(batch.map((i) => `MCX:${i.symbol}`))),
      );
      for (const v of Object.values(res ?? {})) if (Number.isFinite(v.last_price)) out.set(Number(v.instrument_token), v.last_price);
    }
    return out;
  }

  async getQuotes(instruments: McxInstrument[]): Promise<Map<number, McxQuote>> {
    const out = new Map<number, McxQuote>();
    for (const batch of chunks(instruments, QUOTE_BATCH)) {
      const res = await this.auth.call((kc) =>
        withKiteRetry<Record<string, { instrument_token: number; last_price: number; volume?: number; oi?: number; net_change?: number }>>(() =>
          kc.getQuote(batch.map((i) => `MCX:${i.symbol}`)),
        ),
      );
      for (const v of Object.values(res ?? {})) {
        out.set(Number(v.instrument_token), { ltp: v.last_price, volume: v.volume, oi: v.oi, change: v.net_change });
      }
    }
    return out;
  }
}
