/**
 * V2 product catalogue: syncs every supported instrument from the data
 * provider, derives the products (indices, stocks, commodities — with which
 * legs each can offer) and serves a product's contracts, cached briefly.
 */
import type { Market, ProductKind, V2Instrument, V2Product } from '@/shared/v2';
import { KNOWN_PRODUCT } from '@/shared/v2';
import { childLogger } from '../../utils/logger';
import type { V2Store } from '../persistence/V2Store';
import type { V2DataProvider } from './DataProvider';

const log = childLogger('v2-products');
export const MAX_AGE_MS = 18 * 60 * 60_000;
const CACHE_MS = 60_000;

/** Most common gap between consecutive listed strikes. */
function strikeStepOf(strikes: number[]): number | null {
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (let i = 1; i < sorted.length; i++) {
    const d = Math.round((sorted[i]! - sorted[i - 1]!) * 100) / 100;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [d, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = d;
  return best;
}

/** Products from instruments (grouped by product id). */
export function buildProducts(instruments: V2Instrument[], stockNames: Record<string, string>): V2Product[] {
  const groups = new Map<string, V2Instrument[]>();
  for (const i of instruments) {
    const g = groups.get(i.productId);
    if (g) g.push(i);
    else groups.set(i.productId, [i]);
  }
  const out: V2Product[] = [];
  for (const [id, list] of groups) {
    const known = KNOWN_PRODUCT[id];
    const symbol = id.split(':')[1]!;
    const market: Market = id.startsWith('MCX:') ? 'MCX' : 'NSE';
    const kind: ProductKind = known?.kind ?? (market === 'MCX' ? 'COMMODITY' : 'STOCK');
    const futures = list.filter((i) => i.kind === 'FUT');
    const options = list.filter((i) => i.kind === 'CE' || i.kind === 'PE');
    const futureExpiries = [...new Set(futures.map((i) => i.expiry!))].sort();
    const optionExpiries = [...new Set(options.map((i) => i.expiry!))].sort();
    const nearest = optionExpiries[0];
    out.push({
      id,
      market,
      kind,
      symbol,
      name: known?.name ?? stockNames[symbol] ?? symbol,
      hasSpot: list.some((i) => i.kind === 'SPOT'),
      hasFutures: futures.length > 0,
      hasOptions: options.length > 0,
      futureExpiries,
      optionExpiries,
      strikeStep: nearest ? strikeStepOf(options.filter((o) => o.expiry === nearest).map((o) => o.strike!)) : null,
      lotSize: (futures[0] ?? options[0])?.lotSize ?? null,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export class ProductService {
  private cache = new Map<string, { at: number; list: V2Instrument[] }>();

  constructor(
    private readonly store: V2Store,
    private readonly provider: V2DataProvider,
  ) {}

  invalidate(): void {
    this.cache.clear();
  }

  async instruments(productId: string, now = Date.now()): Promise<V2Instrument[]> {
    const hit = this.cache.get(productId);
    if (hit && now - hit.at < CACHE_MS) return hit.list;
    const list = await this.store.instruments.forProduct(productId);
    this.cache.set(productId, { at: now, list });
    return list;
  }

  async sync(): Promise<{ instruments: number; products: number; syncedAt: string }> {
    const { instruments, stockNames } = await this.provider.getInstruments();
    if (!instruments.length) throw new Error('The data provider returned no instruments');
    const products = buildProducts(instruments, stockNames);
    await this.store.instruments.replaceAll(instruments, products);
    this.invalidate();
    log.info({ instruments: instruments.length, products: products.length }, 'v2 instruments synced');
    return { instruments: instruments.length, products: products.length, syncedAt: new Date().toISOString() };
  }

  /** Sync when never synced or stale. Returns a note when it synced. */
  async ensureFresh(now = Date.now()): Promise<string | undefined> {
    const at = await this.store.instruments.syncedAt();
    if (at && now - Date.parse(at) < MAX_AGE_MS) return undefined;
    const r = await this.sync();
    return `Instruments ${at ? 'refreshed' : 'synced'} (${r.instruments} contracts, ${r.products} products)`;
  }
}
