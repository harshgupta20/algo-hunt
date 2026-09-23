/**
 * Keeps the Neon `instruments` table in sync with Kite's instrument master
 * (refreshed by Kite every trading morning) and adapts it to InstrumentStore.
 */
import type { Instrument, InstrumentType } from '@ash/shared';
import { UNDERLYING_BY_SYMBOL } from '@ash/shared';
import type { DataStore } from '../../db/store';
import { childLogger } from '../../utils/logger';
import type { InstrumentSource } from './instrumentStore';
import type { KiteAuthService } from './kiteAuth';
import { withKiteRetry } from './kiteClient';

const log = childLogger('instrument-sync');

export const INSTRUMENTS_SYNCED_KEY = 'instruments_synced_at';
/** Re-sync when the stored master is older than this (Kite publishes it daily). */
const MAX_AGE_MS = 18 * 60 * 60_000;

interface KiteInstrumentRow {
  instrument_token: number;
  tradingsymbol: string;
  name: string;
  expiry: string | Date;
  strike: number;
  instrument_type: string;
  exchange: string;
  lot_size?: number;
  tick_size?: number;
}

/** Download NFO + BFO from Kite, keep supported underlyings' FUT/CE/PE, replace the table. */
export async function syncInstrumentsFromKite(auth: KiteAuthService, store: DataStore): Promise<number> {
  const supported = new Set(Object.keys(UNDERLYING_BY_SYMBOL));
  const rows: KiteInstrumentRow[] = [];
  await auth.call(async (kc) => {
    for (const ex of ['NFO', 'BFO']) {
      rows.push(...(await withKiteRetry<KiteInstrumentRow[]>(() => kc.getInstruments(ex))));
    }
  });

  const instruments: Instrument[] = rows
    .filter((r) => supported.has(r.name) && ['FUT', 'CE', 'PE'].includes(r.instrument_type))
    .map((r) => ({
      token: Number(r.instrument_token),
      tradingSymbol: r.tradingsymbol,
      underlying: r.name,
      exchange: r.exchange as Instrument['exchange'],
      instrumentType: r.instrument_type as InstrumentType,
      strike: Number(r.strike) || 0,
      expiry: typeof r.expiry === 'string' ? r.expiry.slice(0, 10) : r.expiry.toISOString().slice(0, 10),
      lotSize: r.lot_size,
      tickSize: r.tick_size,
    }));

  if (instruments.length === 0) throw new Error('Kite returned no F&O instruments for the supported underlyings');
  await store.instruments.replaceAll(instruments);
  await store.kv.set(INSTRUMENTS_SYNCED_KEY, { at: new Date().toISOString(), count: instruments.length });
  log.info({ count: instruments.length }, 'instrument master synced from kite');
  return instruments.length;
}

/** Sync if the stored master is missing or stale. Returns true if a sync ran. */
export async function syncInstrumentsIfStale(auth: KiteAuthService, store: DataStore): Promise<boolean> {
  const synced = await store.kv.get<{ at: string }>(INSTRUMENTS_SYNCED_KEY);
  if (synced && Date.now() - Date.parse(synced.value.at) < MAX_AGE_MS) return false;
  await syncInstrumentsFromKite(auth, store);
  return true;
}

/** InstrumentStore source backed by Neon + live Kite quotes. */
export function kiteInstrumentSource(auth: KiteAuthService, store: DataStore): InstrumentSource {
  return {
    async loadInstruments() {
      const list = await store.instruments.list();
      if (list.length > 0) return list;
      // First run after deploy: populate the master if a Kite session exists.
      if (await auth.isConnected()) {
        await syncInstrumentsFromKite(auth, store);
        return store.instruments.list();
      }
      return [];
    },
    async referencePrice(future: Instrument) {
      const key = `${future.exchange}:${future.tradingSymbol}`;
      const ltp = await auth.call((kc) =>
        withKiteRetry<Record<string, { last_price?: number }>>(() => kc.getLTP([key])),
      );
      const price = ltp?.[key]?.last_price;
      if (typeof price !== 'number') throw new Error(`Could not fetch LTP for ${key}`);
      return price;
    },
  };
}
