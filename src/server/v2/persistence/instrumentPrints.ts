/**
 * The daily contract sync without re-reading the whole contract table: each product gets a fingerprint of its
 * contracts and its catalogue row. The fingerprints of the last sync are kept (one small row); the next sync
 * rewrites only the products whose fingerprint changed (new weekly expiries, expired contracts, a lot-size
 * change) — usually a handful — instead of comparing ~100,000 contracts.
 */
import { createHash } from 'node:crypto';
import type { V2Instrument, V2Product } from '@/shared/v2';

export type ProductPrints = Record<string, string>;

/** One fingerprint per product id (contracts in token order + the product row). */
export function productPrints(list: V2Instrument[], products: V2Product[]): ProductPrints {
  const byProduct = new Map<string, V2Instrument[]>();
  for (const i of list) {
    const l = byProduct.get(i.productId);
    if (l) l.push(i);
    else byProduct.set(i.productId, [i]);
  }
  const rows = new Map(products.map((p) => [p.id, p]));
  const out: ProductPrints = {};
  for (const id of new Set([...byProduct.keys(), ...rows.keys()])) {
    const h = createHash('sha1');
    h.update(JSON.stringify(rows.get(id) ?? null));
    for (const i of (byProduct.get(id) ?? []).sort((a, b) => a.token - b.token)) {
      h.update(`\n${i.token}|${i.exchange}|${i.kind}|${i.symbol}|${i.expiry ?? ''}|${i.strike ?? ''}|${i.lotSize}|${i.tickSize}`);
    }
    out[id] = h.digest('hex').slice(0, 20);
  }
  return out;
}

/** Products to rewrite: changed or new (`write`), and no longer listed (`drop`). */
export function changedProducts(before: ProductPrints, now: ProductPrints): { write: string[]; drop: string[] } {
  return {
    write: Object.keys(now).filter((id) => before[id] !== now[id]),
    drop: Object.keys(before).filter((id) => !(id in now)),
  };
}
