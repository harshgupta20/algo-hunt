/**
 * The MCX tab's product catalog: each commodity product joined with what the
 * synced Kite instrument master actually lists for it today.
 */
import type { McxProductInfo } from '@ash/shared';
import { MCX_PRODUCTS } from '@ash/shared';
import type { InstrumentStore } from '../kite/instrumentStore';
import { istDate } from '../../utils/marketTime';

export function mcxCatalog(store: InstrumentStore, now = Date.now()): McxProductInfo[] {
  const today = istDate(now);
  return MCX_PRODUCTS.map((p) => {
    const rows = store.all.filter((i) => i.underlying === p.symbol && i.expiry >= today);
    const futures = rows
      .filter((i) => i.instrumentType === 'FUT')
      .sort((a, b) => a.expiry.localeCompare(b.expiry))
      .map((i) => ({ tradingSymbol: i.tradingSymbol, expiry: i.expiry, lotSize: i.lotSize }));
    const optionExpiries = [...new Set(rows.filter((i) => i.instrumentType !== 'FUT').map((i) => i.expiry))].sort();
    const nearest = optionExpiries[0];
    return {
      symbol: p.symbol,
      name: p.name,
      group: p.group!,
      optionsLiquid: Boolean(p.optionsLiquid),
      available: rows.length > 0,
      hasOptions: optionExpiries.length > 0,
      futures,
      optionExpiries,
      strikeInterval: nearest ? store.strikeInterval(p.symbol, nearest) : undefined,
      strikeCount: nearest ? store.strikes(p.symbol, nearest).length : undefined,
    };
  });
}
