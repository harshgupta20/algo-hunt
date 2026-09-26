/**
 * In-memory stand-ins for V2 tests: a V2Store with the same dedupe semantics as
 * Postgres, a fixture data provider, a recording channel factory and builders
 * for instruments, candles, strategies and connections.
 */
import { randomUUID } from 'node:crypto';
import type {
  CalendarEntry,
  ConnectionConfig,
  Delivery,
  ExprNode,
  LegDef,
  LegId,
  Operand,
  ScanRun,
  SeriesSpec,
  StrategyDefinition,
  UnitState,
  V2Alert,
  V2Connection,
  V2Instrument,
  V2Product,
  V2Settings,
  V2Signal,
  V2Strategy,
  V2StrategyVersion,
} from '../../src/shared/v2';
import { DEFAULT_V2_SETTINGS } from '../../src/shared/v2';
import type { ChannelFactory, ChannelName, Channel, Message } from '../../src/server/v2/alerts/notifications';
import type { RawCandle } from '../../src/server/v2/engine/candles';
import type { CandleQuery, InstrumentDump, Quote, V2DataProvider } from '../../src/server/v2/data/DataProvider';
import { buildProducts } from '../../src/server/v2/data/ProductService';
import type { AlertFilters, ProductFilters, V2Store } from '../../src/server/v2/persistence/V2Store';
import { IST_OFFSET_MS } from '../../src/server/utils/marketTime';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryV2Store implements V2Store {
  data = {
    instruments: [] as V2Instrument[],
    products: [] as V2Product[],
    syncedAt: null as string | null,
    calendar: [] as CalendarEntry[],
    strategies: new Map<string, Omit<V2Strategy, 'definition'>>(),
    versions: new Map<string, V2StrategyVersion[]>(),
    connections: new Map<string, V2Connection>(),
    units: new Map<string, UnitState>(),
    signals: [] as V2Signal[],
    alerts: [] as V2Alert[],
    runs: [] as ScanRun[],
    settings: { ...DEFAULT_V2_SETTINGS } as V2Settings,
    locks: new Map<string, number>(),
  };

  constructor(private readonly clock: () => number = Date.now) {}

  private iso() {
    return new Date(this.clock()).toISOString();
  }

  private strategy(id: string): V2Strategy | null {
    const s = this.data.strategies.get(id);
    if (!s) return null;
    return clone({ ...s, definition: this.data.versions.get(id)!.find((v) => v.version === s.version)!.definition });
  }

  instruments = {
    replaceAll: async (list: V2Instrument[], products: V2Product[]) => {
      this.data.instruments = clone(list);
      this.data.products = clone(products);
      this.data.syncedAt = this.iso();
    },
    forProduct: async (id: string) => clone(this.data.instruments.filter((i) => i.productId === id)),
    count: async () => this.data.instruments.length,
    syncedAt: async () => this.data.syncedAt,
  };

  products = {
    list: async (f: ProductFilters = {}) =>
      clone(
        this.data.products.filter(
          (p) =>
            (!f.ids || f.ids.includes(p.id)) &&
            (!f.kind || p.kind === f.kind) &&
            (!f.market || p.market === f.market) &&
            (!f.search || p.symbol.includes(f.search.toUpperCase()) || p.name.toUpperCase().includes(f.search.toUpperCase())),
        ),
      ),
    get: async (id: string) => clone(this.data.products.find((p) => p.id === id) ?? null),
    count: async () => this.data.products.length,
  };

  calendar = {
    list: async () => clone(this.data.calendar),
    replaceAll: async (e: CalendarEntry[]) => {
      this.data.calendar = clone(e);
    },
  };

  strategies = {
    list: async () => [...this.data.strategies.keys()].map((id) => this.strategy(id)!),
    get: async (id: string) => this.strategy(id),
    create: async (definition: StrategyDefinition) => {
      const id = randomUUID();
      this.data.strategies.set(id, { id, name: definition.name, version: 1, createdAt: this.iso(), updatedAt: this.iso() });
      this.data.versions.set(id, [{ version: 1, definition: clone(definition), createdAt: this.iso() }]);
      return this.strategy(id)!;
    },
    update: async (id: string, definition: StrategyDefinition) => {
      const s = this.data.strategies.get(id);
      if (!s) return null;
      s.version += 1;
      s.name = definition.name;
      this.data.versions.get(id)!.push({ version: s.version, definition: clone(definition), createdAt: this.iso() });
      return this.strategy(id);
    },
    remove: async (id: string) => {
      for (const [cid, c] of this.data.connections) if (c.strategyId === id) this.data.connections.delete(cid);
      return this.data.strategies.delete(id);
    },
    versions: async (id: string) => clone([...(this.data.versions.get(id) ?? [])].reverse()),
  };

  connections = {
    list: async (strategyId?: string) => clone([...this.data.connections.values()].filter((c) => !strategyId || c.strategyId === strategyId)),
    get: async (id: string) => clone(this.data.connections.get(id) ?? null),
    create: async (strategyId: string, productId: string, config: ConnectionConfig) => {
      const c: V2Connection = { id: randomUUID(), strategyId, productId, config: clone(config), enabled: false, enabledAt: null, createdAt: this.iso(), updatedAt: this.iso() };
      this.data.connections.set(c.id, c);
      return clone(c);
    },
    update: async (id: string, config: ConnectionConfig) => {
      const c = this.data.connections.get(id);
      if (!c) return null;
      c.config = clone(config);
      return clone(c);
    },
    setEnabled: async (id: string, enabled: boolean, at: string) => {
      const c = this.data.connections.get(id);
      if (!c) return null;
      c.enabled = enabled;
      if (enabled) c.enabledAt = at;
      return clone(c);
    },
    remove: async (id: string) => this.data.connections.delete(id),
  };

  units = {
    list: async (cid: string) => clone([...this.data.units.values()].filter((u) => u.connectionId === cid)),
    get: async (cid: string, key: string) => clone(this.data.units.get(`${cid}|${key}`) ?? null),
    upsert: async (s: UnitState) => {
      this.data.units.set(`${s.connectionId}|${s.unitKey}`, clone({ ...s, updatedAt: this.iso() }));
    },
    clear: async (cid: string) => {
      for (const k of [...this.data.units.keys()]) if (k.startsWith(`${cid}|`)) this.data.units.delete(k);
    },
  };

  signals = {
    insert: async (s: Omit<V2Signal, 'id' | 'createdAt'>) => {
      if (this.data.signals.some((x) => x.identity === s.identity)) return null;
      const row: V2Signal = { ...clone(s), id: randomUUID(), createdAt: this.iso() };
      this.data.signals.push(row);
      return clone(row);
    },
    list: async (f: { connectionId?: string; strategyId?: string; limit?: number }) =>
      clone(
        [...this.data.signals]
          .reverse()
          .filter((s) => (!f.connectionId || s.connectionId === f.connectionId) && (!f.strategyId || s.strategyId === f.strategyId))
          .slice(0, f.limit ?? 100),
      ),
  };

  alerts = {
    insert: async (a: Omit<V2Alert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'>) => {
      const row: V2Alert = { ...clone(a), id: randomUUID(), deliveries: [], acknowledgedAt: null, createdAt: this.iso() };
      this.data.alerts.push(row);
      return clone(row);
    },
    addDelivery: async (id: string, d: Delivery) => {
      this.data.alerts.find((a) => a.id === id)?.deliveries.push(clone(d));
    },
    setStatus: async (id: string, status: V2Alert['status']) => {
      const a = this.data.alerts.find((x) => x.id === id);
      if (a) a.status = status;
    },
    acknowledge: async (id: string, at: string) => {
      const a = this.data.alerts.find((x) => x.id === id);
      if (!a) return null;
      a.status = 'ACKNOWLEDGED';
      a.acknowledgedAt = at;
      return clone(a);
    },
    get: async (id: string) => clone(this.data.alerts.find((a) => a.id === id) ?? null),
    list: async (f: AlertFilters) =>
      clone(
        [...this.data.alerts]
          .reverse()
          .filter((a) => (!f.connectionId || a.connectionId === f.connectionId) && (!f.strategyId || a.strategyId === f.strategyId) && (!f.active || !a.acknowledgedAt))
          .slice(0, f.limit ?? 200),
      ),
  };

  scanRuns = {
    insert: async (r: ScanRun) => {
      this.data.runs.push(clone(r));
    },
    list: async (limit: number) => clone([...this.data.runs].reverse().slice(0, limit)),
    prune: async (before: string) => {
      this.data.runs = this.data.runs.filter((r) => r.startedAt >= before);
    },
  };

  settings = {
    get: async () => clone(this.data.settings),
    save: async (s: V2Settings) => {
      this.data.settings = clone(s);
      return clone(s);
    },
  };

  locks = {
    acquire: async (name: string, leaseSeconds: number, _minIntervalSeconds = 0) => {
      if ((this.data.locks.get(name) ?? 0) > this.clock()) return false;
      this.data.locks.set(name, this.clock() + leaseSeconds * 1000);
      return true;
    },
    release: async (name: string) => {
      this.data.locks.delete(name);
    },
  };
}

export class FixtureV2Provider implements V2DataProvider {
  readonly name = 'fixture';
  connected = true;
  candles = new Map<string, RawCandle[]>();
  ltp = new Map<number, number>();
  failTokens = new Set<number>();
  calls = { historical: 0, ltp: 0, quotes: 0, instruments: 0 };

  constructor(
    public instruments: V2Instrument[] = [],
    public stockNames: Record<string, string> = {},
  ) {}

  set(inst: V2Instrument, interval: CandleQuery['interval'], candles: RawCandle[]): this {
    this.candles.set(`${inst.token}|${interval}`, candles);
    return this;
  }
  async isConnected() {
    return this.connected;
  }
  async getInstruments(): Promise<InstrumentDump> {
    this.calls.instruments++;
    return { instruments: clone(this.instruments), stockNames: { ...this.stockNames } };
  }
  async getHistoricalCandles(q: CandleQuery) {
    this.calls.historical++;
    if (this.failTokens.has(q.instrument.token)) throw new Error('fixture: upstream error');
    const all = this.candles.get(`${q.instrument.token}|${q.interval}`) ?? [];
    const from = Date.parse(`${q.from}T00:00:00Z`) - IST_OFFSET_MS;
    const to = Date.parse(`${q.to}T23:59:59Z`) - IST_OFFSET_MS;
    return all.filter((c) => c.time * 1000 >= from && c.time * 1000 <= to);
  }
  async getLtp(list: V2Instrument[]) {
    this.calls.ltp++;
    return new Map(list.flatMap((i) => (this.ltp.has(i.token) ? [[i.token, this.ltp.get(i.token)!] as [number, number]] : [])));
  }
  async getQuotes(list: V2Instrument[]) {
    this.calls.quotes++;
    return new Map<number, Quote>(list.flatMap((i) => (this.ltp.has(i.token) ? [[i.token, { ltp: this.ltp.get(i.token)! }] as [number, Quote]] : [])));
  }
}

export class RecordingChannels implements ChannelFactory {
  sent: Array<{ channel: ChannelName; message: Message }> = [];
  configured = { telegram: true, email: true };
  status() {
    return {
      telegram: { configured: this.configured.telegram, detail: this.configured.telegram ? 'test chat' : 'not configured' },
      email: { configured: this.configured.email, detail: this.configured.email ? 'test inbox' : 'not configured' },
    };
  }
  channel(name: ChannelName): Channel | null {
    if (!this.configured[name]) return null;
    return { name, send: async (message: Message) => void this.sent.push({ channel: name, message }) };
  }
}

// ---- builders -------------------------------------------------------------------------

let token = 70_000;
const inst = (p: Omit<V2Instrument, 'id' | 'token' | 'lotSize' | 'tickSize'>): V2Instrument => {
  const t = token++;
  return { id: `K:${t}`, token: t, lotSize: 1, tickSize: 0.05, ...p };
};
export const spot = (productId: string, symbol: string, exchange: V2Instrument['exchange'] = 'NSE') => inst({ exchange, productId, kind: 'SPOT', symbol, expiry: null, strike: null });
export const fut = (productId: string, expiry: string, exchange: V2Instrument['exchange'] = 'NFO') =>
  inst({ exchange, productId, kind: 'FUT', symbol: `${productId.split(':')[1]}${expiry.replace(/-/g, '')}FUT`, expiry, strike: null });
export const opt = (productId: string, expiry: string, strike: number, kind: 'CE' | 'PE', exchange: V2Instrument['exchange'] = 'NFO') =>
  inst({ exchange, productId, kind, symbol: `${productId.split(':')[1]}${expiry.replace(/-/g, '')}${strike}${kind}`, expiry, strike });

export function ladder(productId: string, expiry: string, from: number, to: number, step: number, exchange: V2Instrument['exchange'] = 'NFO'): V2Instrument[] {
  const out: V2Instrument[] = [];
  for (let k = from; k <= to; k += step) out.push(opt(productId, expiry, k, 'CE', exchange), opt(productId, expiry, k, 'PE', exchange));
  return out;
}

export const productsOf = (list: V2Instrument[], names: Record<string, string> = {}) => buildProducts(list, names);

export function ist(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00Z`) - IST_OFFSET_MS;
}

/** Open times of `count` candles ending with `lastOpenMs`, walking back through weekday sessions [open, close). */
export function timesEndingAt(lastOpenMs: number, minutes: number, count: number, session: { open: string; close: string }): number[] {
  const out = [lastOpenMs];
  const step = minutes * 60_000;
  while (out.length < count) {
    const t = out[0]! - step;
    const day = new Date(out[0]! + IST_OFFSET_MS).toISOString().slice(0, 10);
    if (t >= ist(day, session.open)) {
      out.unshift(t);
      continue;
    }
    let d = day;
    do d = new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
    const open = ist(d, session.open);
    out.unshift(open + Math.floor((ist(d, session.close) - 1 - open) / step) * step);
  }
  return out;
}

export const NSE_SESSION = { open: '09:15', close: '15:30' };
export const MCX_SESSION = { open: '09:00', close: '23:30' };

export function candlesAt(times: number[], closes: number[], opts: { volume?: number; spread?: number } = {}): RawCandle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    const spread = opts.spread ?? 1;
    return { time: Math.floor(times[i]! / 1000), open, high: Math.max(open, close) + spread, low: Math.min(open, close) - spread, close, volume: opts.volume ?? 100, oi: 1000 + i };
  });
}

/** Uptrend, 4-candle pullback, then a jump: RSI(14) crosses 60 on the last candle only (with `finalJump` 14). */
export function momentumCloses(finalJump: number, start = 300): number[] {
  const closes: number[] = [];
  let p = start;
  for (let i = 0; i < 60; i++) closes.push((p += i % 3 === 0 ? 1 : 2.5));
  for (let i = 0; i < 4; i++) closes.push((p -= 6));
  closes.push(p + finalJump);
  return closes;
}

export const legSeries = (leg: LegId, timeframe: SeriesSpec['timeframe'] = '15m'): SeriesSpec => ({ leg, timeframe, candle: { type: 'NORMAL' } });
export const ind = (series: SeriesSpec, indicator: string, params: Record<string, number>): Operand => ({ kind: 'INDICATOR', series, indicator, params });
export const field = (series: SeriesSpec, f: 'close' | 'volume' = 'close'): Operand => ({ kind: 'FIELD', series, field: f });
export const num = (value: number): Operand => ({ kind: 'CONSTANT', value });
let nid = 0;
export const cond = (left: Operand, operator: Extract<ExprNode, { type: 'CONDITION' }>['operator'], right: Operand): ExprNode => ({ type: 'CONDITION', id: `c${nid++}`, left, operator, right });
export const and = (...children: ExprNode[]): ExprNode => ({ type: 'AND', id: `g${nid++}`, children });

export function strategy(legs: LegDef[], expression: ExprNode, triggerTimeframe: SeriesSpec['timeframe'] = '15m'): StrategyDefinition {
  return { schemaVersion: 1, name: 'test strategy', legs, evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe }, expression };
}

export const config = (patch: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  expiry: { mode: 'CURRENT' },
  strikeShifts: [0],
  alert: { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION', cooldownMinutes: 30, oncePerCandle: true },
  ...patch,
});
