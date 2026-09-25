/**
 * Test fixtures: a fixed instrument master, a candle-fixture historical source,
 * and a small in-process DataStore covering what the services under test use.
 * They stand in for Kite + Neon so the REAL engines can be tested offline.
 */
import { randomUUID } from 'node:crypto';
import type { Alert, AlertConfiguration, AlertConfigurationInput, Instrument, OHLCV, StrategyDef, Timeframe } from '@ash/shared';
import { TIMEFRAME_MS } from '@ash/shared';
import type { DataStore } from '../../src/server/db/store';
import { buildConfiguration } from '../../src/server/db/store';
import type { MonitorState, NewAlert } from '../../src/server/db/types';
import type { HistoricalCandleQuery, HistoricalDataProvider } from '../../src/server/services/kite/HistoricalDataProvider';
import { InstrumentStore } from '../../src/server/services/kite/instrumentStore';
import { IST_OFFSET_MS } from '../../src/server/utils/marketTime';

export const OPT_EXPIRY = '2099-12-24';
export const FUT_EXPIRY = '2099-12-31';

let nextToken = 1000;
function inst(underlying: string, type: Instrument['instrumentType'], strike: number, expiry: string, exchange: Instrument['exchange'] = 'NFO'): Instrument {
  return {
    token: nextToken++,
    tradingSymbol: `${underlying}${type}${strike}`,
    underlying,
    exchange,
    instrumentType: type,
    strike,
    expiry,
  };
}

/**
 * MCX master: CRUDEOIL with monthly futures + options (strikes 5300..5600 step 50,
 * option expiries a few days before the futures) and futures-only ALUMINIUM.
 */
export function mcxMaster(): Instrument[] {
  const list: Instrument[] = [];
  for (const e of ['2099-10-20', '2099-11-19', '2099-12-17']) list.push(inst('CRUDEOIL', 'FUT', 0, e, 'MCX'));
  for (const e of ['2099-10-16', '2099-11-17']) {
    for (let k = 5300; k <= 5600; k += 50) list.push(inst('CRUDEOIL', 'CE', k, e, 'MCX'), inst('CRUDEOIL', 'PE', k, e, 'MCX'));
  }
  for (const e of ['2099-10-31', '2099-11-28', '2099-12-31']) list.push(inst('ALUMINIUM', 'FUT', 0, e, 'MCX'));
  return list;
}

/** NIFTY future + CE/PE at strikes 21900..22100 (step 50). */
export function niftyMaster(): Instrument[] {
  const list: Instrument[] = [inst('NIFTY', 'FUT', 0, FUT_EXPIRY)];
  for (let k = 21900; k <= 22100; k += 50) {
    list.push(inst('NIFTY', 'CE', k, OPT_EXPIRY), inst('NIFTY', 'PE', k, OPT_EXPIRY));
  }
  return list;
}

export function fixtureInstrumentStore(master: Instrument[], price = 22010): InstrumentStore {
  return new InstrumentStore({ loadInstruments: async () => master, referencePrice: async () => price });
}

/**
 * Candle open times (epoch ms) for `count` consecutive session candles ending
 * with `lastOpen`, following Kite's 09:15-aligned sessions on weekdays.
 */
export function sessionOpens(lastOpen: number, count: number, tf: Timeframe): number[] {
  const step = TIMEFRAME_MS[tf];
  const out: number[] = [];
  let t = lastOpen;
  while (out.length < count) {
    out.unshift(t);
    t -= step;
    const ist = new Date(t + IST_OFFSET_MS);
    const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const wd = ist.getUTCDay();
    if (minute < 9 * 60 + 15 || wd === 0 || wd === 6) {
      // Jump back to the previous weekday's last candle.
      let day = Date.parse(`${ist.toISOString().slice(0, 10)}T00:00:00Z`) - IST_OFFSET_MS;
      do {
        day -= 86_400_000;
      } while ([0, 6].includes(new Date(day + IST_OFFSET_MS).getUTCDay()));
      const sessionOpen = day + (9 * 60 + 15) * 60_000;
      const sessionClose = day + (15 * 60 + 30) * 60_000;
      t = sessionOpen + Math.floor((sessionClose - 1 - sessionOpen) / step) * step;
    }
  }
  return out;
}

/** Right-align a close series onto session candle times ending at `lastOpen`. */
export function toCandles(closes: number[], lastOpen: number, tf: Timeframe): OHLCV[] {
  const opens = sessionOpens(lastOpen, closes.length, tf);
  return closes.map((c, i) => ({ time: opens[i]! / 1000, open: c, high: c, low: c, close: c, volume: 100 }));
}

export class FixtureHistorical implements HistoricalDataProvider {
  readonly name = 'fixture';
  readonly calls: HistoricalCandleQuery[] = [];
  /** `byTokenTf` ("token:timeframe") serves other timeframes; otherwise candles are per token. */
  constructor(
    private readonly byToken: Map<number, OHLCV[]>,
    private readonly byTokenTf = new Map<string, OHLCV[]>(),
  ) {}
  async getCandles(q: HistoricalCandleQuery): Promise<OHLCV[]> {
    this.calls.push(q);
    return this.byTokenTf.get(`${q.token}:${q.timeframe}`) ?? this.byToken.get(q.token) ?? [];
  }
}

/** In-process DataStore with the dedupe semantics of the Postgres unique indexes. */
export function fixtureStore(strategies: StrategyDef[] = []): DataStore & { alertRows: Alert[] } {
  const configs = new Map<string, AlertConfiguration>();
  const monitors = new Map<string, MonitorState>();
  const alertRows: Alert[] = [];
  const store = {
    alertRows,
    configs: {
      async create(input: AlertConfigurationInput) {
        const c = buildConfiguration(input);
        configs.set(c.id, c);
        return c;
      },
      async getById(id: string) {
        return configs.get(id) ?? null;
      },
      async list() {
        return [...configs.values()];
      },
      async listActive() {
        return [...configs.values()].filter((c) => c.active);
      },
      async update(id: string, patch: Partial<AlertConfigurationInput>) {
        const c = configs.get(id);
        if (!c) return null;
        const u = { ...c, ...patch, params: { ...c.params, ...patch.params } } as AlertConfiguration;
        configs.set(id, u);
        return u;
      },
      async setActive(id: string, active: boolean, expiryDate?: string) {
        const c = configs.get(id);
        if (!c) return null;
        const u = { ...c, active, expiryDate: expiryDate ?? c.expiryDate };
        configs.set(id, u);
        return u;
      },
    },
    alerts: {
      async insert(a: NewAlert) {
        const dup = alertRows.some((x) => x.configId === a.configId && x.bucket === a.bucket && x.scenario === a.scenario);
        if (dup) return null;
        const saved = { ...a, id: randomUUID() } as Alert;
        alertRows.push(saved);
        return saved;
      },
      async list() {
        return [...alertRows];
      },
    },
    notifications: { async insert() {} },
    strategies: {
      async get(id: string) {
        return strategies.find((s) => s.id === id) ?? null;
      },
    },
    monitors: {
      async get(id: string) {
        return monitors.get(id) ?? null;
      },
      async list() {
        return [...monitors.values()];
      },
      async upsert(s: MonitorState) {
        monitors.set(s.configId, { ...s });
      },
      async recordRun(id: string, p: Pick<MonitorState, 'lastBucket' | 'snapshot' | 'lastError'>) {
        const s = monitors.get(id);
        if (!s) return;
        monitors.set(id, {
          ...s,
          lastBucket: Math.max(s.lastBucket ?? 0, p.lastBucket ?? 0) || null,
          snapshot: p.snapshot ?? s.snapshot,
          lastError: p.lastError,
        });
      },
      async delete(id: string) {
        monitors.delete(id);
      },
    },
  };
  return store as unknown as DataStore & { alertRows: Alert[] };
}
