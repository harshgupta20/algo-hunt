/**
 * The daily contract sync rewrites only products whose contracts or catalogue row changed (PgV2Store keeps
 * the fingerprints of the last sync). Here: the fingerprints and the change list they produce.
 */
import { describe, expect, it } from 'vitest';
import { changedProducts, productPrints } from '../../src/server/v2/persistence/instrumentPrints';
import { fut, ladder, productsOf, spot } from '../helpers/v2Fakes';

describe('contract sync fingerprints', () => {
  const base = [spot('NSE:NIFTY', 'NIFTY 50'), fut('NSE:NIFTY', '2026-10-27'), ...ladder('NSE:NIFTY', '2026-10-13', 24_800, 25_000, 100), spot('NSE:ITC', 'ITC'), fut('MCX:GOLD', '2026-12-04', 'MCX')];

  it('the same contracts give the same fingerprints, in any order', () => {
    expect(productPrints([...base].reverse(), productsOf(base))).toEqual(productPrints(base, productsOf(base)));
  });

  it('only the products that changed are rewritten; products no longer listed are dropped', () => {
    const before = productPrints(base, productsOf(base));
    const weekly = ladder('NSE:NIFTY', '2026-10-20', 24_800, 25_000, 100).map((o) => ({ ...o, token: o.token + 900_000 })); // a new weekly expiry
    const next = [...base.filter((i) => i.productId !== 'MCX:GOLD'), ...weekly];
    const diff = changedProducts(before, productPrints(next, productsOf(next)));
    expect(diff).toEqual({ write: ['NSE:NIFTY'], drop: ['MCX:GOLD'] });
    const lot = base.map((i) => (i.productId === 'NSE:ITC' ? { ...i, lotSize: i.lotSize + 1 } : i));
    expect(changedProducts(before, productPrints(lot, productsOf(lot))).write).toEqual(['NSE:ITC']);
    expect(changedProducts(before, before)).toEqual({ write: [], drop: [] });
  });
});
