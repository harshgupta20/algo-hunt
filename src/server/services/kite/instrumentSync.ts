/**
 * Keeps the Neon `instruments` table in sync with Kite's instrument master
 * (refreshed by Kite every trading morning) and adapts it to InstrumentStore.
 *
 * Each market syncs on its own: NSE/BSE index F&O from NFO + BFO, MCX
 * commodity F&O from MCX. A sync only replaces its own exchanges' rows, so one
 * market's refresh (or failure) never wipes the other's contracts.
 */
import type { Exchange, Instrument, InstrumentType, Segment } from '@ash/shared';
import { MCX_PRODUCTS, UNDERLYINGS } from '@ash/shared';
import type { DataStore } from '../../db/store';
import { childLogger } from '../../utils/logger';
import type { InstrumentSource } from './instrumentStore';
import type { KiteAuthService } from './kiteAuth';
import { withKiteRetry } from './kiteClient';

const log = childLogger('instrument-sync');

export const INSTRUMENTS_SYNCED_KEY = 'instruments_synced_at';
export const MCX_INSTRUMENTS_SYNCED_KEY = 'instruments_synced_at_mcx';
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

interface SegmentSync {
  segment: Segment;
  exchanges: Exchange[];
  symbols: Set<string>;
  kvKey: string;
  /** Underlying symbol of a Kite row, if it belongs to this market's products. */
  underlyingOf(row: KiteInstrumentRow, symbols: Set<string>): string | undefined;
}

const SEGMENTS: Record<Segment, SegmentSync> = {
  NSE: {
    segment: 'NSE',
    exchanges: ['NFO', 'BFO'],
    symbols: new Set(UNDERLYINGS.map((u) => u.symbol)),
    kvKey: INSTRUMENTS_SYNCED_KEY,
    underlyingOf: (r, symbols) => (symbols.has(r.name) ? r.name : undefined),
  },
  MCX: {
    segment: 'MCX',
    exchanges: ['MCX'],
    symbols: new Set(MCX_PRODUCTS.map((u) => u.symbol)),
    kvKey: MCX_INSTRUMENTS_SYNCED_KEY,
    // Kite's `name` is the product (GOLD, NATGASMINI…); fall back to the
    // tradingsymbol prefix (GOLD25DECFUT → GOLD) if a row has no name.
    underlyingOf: (r, symbols) => {
      const name = r.name?.trim().toUpperCase();
      if (name && symbols.has(name)) return name;
      const prefix = /^([A-Z]+)\d/.exec(r.tradingsymbol)?.[1];
      return prefix && symbols.has(prefix) ? prefix : undefined;
    },
  },
};

function toInstrument(r: KiteInstrumentRow, underlying: string): Instrument {
  return {
    token: Number(r.instrument_token),
    tradingSymbol: r.tradingsymbol,
    underlying,
    exchange: r.exchange as Instrument['exchange'],
    instrumentType: r.instrument_type as InstrumentType,
    strike: Number(r.strike) || 0,
    expiry: typeof r.expiry === 'string' ? r.expiry.slice(0, 10) : r.expiry.toISOString().slice(0, 10),
    lotSize: r.lot_size,
    tickSize: r.tick_size,
  };
}

/** Download one market's F&O from Kite, keep supported products' FUT/CE/PE, replace that market's rows. */
export async function syncSegmentFromKite(auth: KiteAuthService, store: DataStore, segment: Segment): Promise<number> {
  const spec = SEGMENTS[segment];
  const rows: KiteInstrumentRow[] = [];
  await auth.call(async (kc) => {
    for (const ex of spec.exchanges) {
      rows.push(...(await withKiteRetry<KiteInstrumentRow[]>(() => kc.getInstruments(ex))));
    }
  });

  const instruments: Instrument[] = [];
  for (const r of rows) {
    if (!['FUT', 'CE', 'PE'].includes(r.instrument_type)) continue;
    const underlying = spec.underlyingOf(r, spec.symbols);
    if (underlying) instruments.push(toInstrument(r, underlying));
  }

  if (instruments.length === 0) throw new Error(`Kite returned no ${segment} F&O instruments for the supported underlyings`);
  await store.instruments.replaceExchanges(spec.exchanges, instruments);
  await store.kv.set(spec.kvKey, { at: new Date().toISOString(), count: instruments.length });
  log.info({ segment, count: instruments.length }, 'instrument master synced from kite');
  return instruments.length;
}

/** Sync every market (NSE/BSE first, then MCX). A market that fails is logged and skipped; returns the total synced. */
export async function syncInstrumentsFromKite(auth: KiteAuthService, store: DataStore): Promise<number> {
  let total = 0;
  const errors: string[] = [];
  for (const segment of Object.keys(SEGMENTS) as Segment[]) {
    try {
      total += await syncSegmentFromKite(auth, store, segment);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ segment, err: message }, 'instrument sync failed for market');
      errors.push(`${segment}: ${message}`);
    }
  }
  if (total === 0) throw new Error(`Instrument sync failed — ${errors.join('; ')}`);
  return total;
}

/** Sync each market whose stored master is missing or stale. Returns true if any sync ran. */
export async function syncInstrumentsIfStale(auth: KiteAuthService, store: DataStore): Promise<boolean> {
  let ran = false;
  for (const spec of Object.values(SEGMENTS)) {
    const synced = await store.kv.get<{ at: string }>(spec.kvKey);
    if (synced && Date.now() - Date.parse(synced.value.at) < MAX_AGE_MS) continue;
    try {
      await syncSegmentFromKite(auth, store, spec.segment);
      ran = true;
    } catch (err) {
      log.error({ segment: spec.segment, err: err instanceof Error ? err.message : String(err) }, 'stale instrument sync failed');
    }
  }
  return ran;
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
