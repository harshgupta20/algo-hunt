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
  LiveStatus,
  PaperOverride,
  PaperPlan,
  PaperTrade,
  Operand,
  ProductKind,
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
import { DEFAULT_V2_SETTINGS, offersKinds } from '../../src/shared/v2';
import type { ChannelFactory, ChannelName, Channel, Message } from '../../src/server/v2/alerts/notifications';
import type { RawCandle } from '../../src/server/v2/engine/candles';
import type { CandleQuery, InstrumentDump, Quote, V2DataProvider } from '../../src/server/v2/data/DataProvider';
import { buildProducts } from '../../src/server/v2/data/ProductService';
import type { AlertFilters, DatabaseSize, NewAlert, NewPaperTrade, NewSignal, ProductFilters, PruneResult, RecordStoreFilters, SignalFilters, V2Store } from '../../src/server/v2/persistence/V2Store';
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
    live: null as { status: LiveStatus; offlineNotifiedAt: string | null } | null,
    paperPlans: new Map<string, PaperPlan>(),
    paperTrades: [] as PaperTrade[],
    paperOverrides: new Map<string, PaperOverride>(),
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
            (!f.needs || offersKinds(p, f.needs)) &&
            (!f.search || p.symbol.includes(f.search.toUpperCase()) || p.name.toUpperCase().includes(f.search.toUpperCase())),
        ),
      ),
    get: async (id: string) => clone(this.data.products.find((p) => p.id === id) ?? null),
    count: async () => this.data.products.length,
    countByKind: async (f: Pick<ProductFilters, 'search' | 'market' | 'needs'> = {}) => {
      const out: Record<ProductKind, number> = { INDEX: 0, STOCK: 0, COMMODITY: 0 };
      for (const p of await this.products.list(f)) out[p.kind]++;
      return out;
    },
  };

  calendar = {
    list: async () => clone(this.data.calendar),
    replaceAll: async (e: CalendarEntry[]) => {
      this.data.calendar = clone(e);
    },
  };

  strategies = {
    count: async () => this.data.strategies.size,
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
    counts: async () => ({ total: this.data.connections.size, enabled: [...this.data.connections.values()].filter((c) => c.enabled).length }),
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
    setEnabledMany: async (ids: string[], enabled: boolean, at: string) => {
      let n = 0;
      for (const id of ids) if (await this.connections.setEnabled(id, enabled, at)) n++;
      return n;
    },
    remove: async (id: string) => this.data.connections.delete(id),
  };

  units = {
    list: async (cid: string) => clone([...this.data.units.values()].filter((u) => u.connectionId === cid)),
    get: async (cid: string, key: string) => clone(this.data.units.get(`${cid}|${key}`) ?? null),
    listFor: async (ids: string[]) => clone([...this.data.units.values()].filter((u) => ids.includes(u.connectionId))),
    upsert: async (s: UnitState) => {
      this.data.units.set(`${s.connectionId}|${s.unitKey}`, clone({ ...s, updatedAt: this.iso() }));
    },
    upsertMany: async (list: UnitState[]) => {
      for (const s of list) await this.units.upsert(s);
    },
    clear: async (cid: string) => {
      for (const k of [...this.data.units.keys()]) if (k.startsWith(`${cid}|`)) this.data.units.delete(k);
    },
    clearMany: async (ids: string[]) => {
      for (const id of ids) await this.units.clear(id);
    },
    disableMany: async (ids: string[]) => {
      for (const [k, u] of this.data.units) if (ids.includes(u.connectionId)) this.data.units.set(k, { ...u, state: 'DISABLED' });
    },
  };

  signals = {
    insert: async (s: NewSignal) => {
      if (this.data.signals.some((x) => x.identity === s.identity)) return null;
      const row: V2Signal = { ...clone(s), id: s.id ?? randomUUID(), createdAt: s.createdAt ?? this.iso() };
      this.data.signals.push(row);
      return clone(row);
    },
    list: async (f: SignalFilters) =>
      clone(
        [...this.data.signals]
          .reverse()
          .filter((s) => this.matches(f, { ...s, productId: s.evaluation.productId }) && (!f.outcomes?.length || f.outcomes.includes(s.outcome)))
          .slice(0, f.limit ?? 100),
      ),
  };

  alerts = {
    insert: async (a: NewAlert) => {
      const row: V2Alert = { ...clone(a), id: a.id ?? randomUUID(), deliveries: [], acknowledgedAt: null, createdAt: a.createdAt ?? this.iso() };
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
    feed: async (after: string | null, limit: number) =>
      [...this.data.alerts]
        .reverse()
        .filter((a) => !after || a.createdAt > after)
        .slice(0, limit)
        .map((a) => ({ id: a.id, strategyName: a.strategyName, productId: a.productId, unit: clone(a.unit), createdAt: a.createdAt })),
    list: async (f: AlertFilters) =>
      clone(
        [...this.data.alerts]
          .reverse()
          .filter(
            (a) =>
              this.matches(f, a) &&
              (!f.active || !a.acknowledgedAt) &&
              (!f.statuses?.length || f.statuses.includes(a.status)) &&
              (!f.sources?.length || f.sources.includes(a.evaluation.source ?? 'HISTORICAL')),
          )
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

  contextStamp = async () =>
    JSON.stringify([
      [...this.data.connections.values()].map((c) => [c.id, c.enabled, c.enabledAt, c.updatedAt, c.config]),
      [...this.data.strategies.values()].map((s) => [s.id, s.version, s.updatedAt]),
      this.data.settings,
      this.data.calendar,
      this.data.products.length,
      this.data.syncedAt,
    ]);

  /** The filters alerts and signals share (as PgV2Store's recordWhere). */
  private matches(
    f: RecordStoreFilters,
    r: { connectionId: string; strategyId: string; productId: string; triggerTimeframe: string; createdAt: string; evaluation: { trace: { children?: Array<{ id: string; result: string }> } } },
  ): boolean {
    const p = this.data.products.find((x) => x.id === r.productId);
    const symbol = r.productId.split(':')[1] ?? '';
    return (
      (!f.connectionId || r.connectionId === f.connectionId) &&
      (!f.strategyId || r.strategyId === f.strategyId) &&
      (!f.kinds?.length || (!!p && f.kinds.includes(p.kind))) &&
      (!f.markets?.length || (!!p && f.markets.includes(p.market))) &&
      (!f.search?.trim() || symbol.toLowerCase().includes(f.search.trim().toLowerCase())) &&
      (!f.timeframes?.length || f.timeframes.includes(r.triggerTimeframe as never)) &&
      (!f.since || r.createdAt >= f.since) &&
      (!f.until || r.createdAt < f.until) &&
      (!f.groups?.length || (r.evaluation.trace.children ?? []).some((g) => g.result === 'TRUE' && f.groups!.includes(g.id)))
    );
  }

  paper = {
    getPlan: async (id: string) => clone(this.data.paperPlans.get(id) ?? null),
    savePlan: async (id: string, plan: PaperPlan) => {
      this.data.paperPlans.set(id, clone(plan));
      return clone(plan);
    },
    listPlans: async () => [...this.data.paperPlans].map(([strategyId, plan]) => ({ strategyId, plan: clone(plan) })),
    insertTrade: async (t: NewPaperTrade) => {
      if (this.data.paperTrades.some((x) => x.connectionId === t.connectionId && x.slot === t.slot && x.status === 'OPEN')) return null;
      const trade = { ...clone(t), id: t.id ?? randomUUID() };
      this.data.paperTrades.push(trade);
      return clone(trade);
    },
    openFor: async (cid: string, slot: string) => clone(this.data.paperTrades.find((t) => t.connectionId === cid && t.slot === slot && t.status === 'OPEN') ?? null),
    listOpen: async () => clone(this.data.paperTrades.filter((t) => t.status === 'OPEN')),
    closeTrade: async (id: string, patch: Partial<PaperTrade>) => {
      const t = this.data.paperTrades.find((x) => x.id === id && x.status === 'OPEN');
      if (!t) return null;
      Object.assign(t, clone(patch), { status: 'CLOSED' });
      return clone(t);
    },
    updateMarks: async (marks: Array<{ id: string; lastPrice: number; at: string }>) => {
      for (const m of marks) {
        const t = this.data.paperTrades.find((x) => x.id === m.id && x.status === 'OPEN');
        if (t) Object.assign(t, { lastPrice: m.lastPrice, lastPriceAt: m.at });
      }
    },
    listTrades: async (f: { status?: 'OPEN' | 'CLOSED'; strategyId?: string; connectionId?: string; since?: string; limit?: number }) =>
      clone(
        this.data.paperTrades
          .filter((t) => (!f.status || t.status === f.status) && (!f.strategyId || t.strategyId === f.strategyId) && (!f.connectionId || t.connectionId === f.connectionId) && (!f.since || t.entryAt >= f.since))
          .sort((a, b) => b.entryAt.localeCompare(a.entryAt))
          .slice(0, f.limit ?? 1000),
      ),
    getOverride: async (id: string) => clone(this.data.paperOverrides.get(id) ?? null),
    saveOverride: async (id: string, o: PaperOverride) => {
      if (!Object.keys(o).length) {
        this.data.paperOverrides.delete(id);
        return null;
      }
      this.data.paperOverrides.set(id, clone(o));
      return clone(o);
    },
    listOverrides: async () => [...this.data.paperOverrides].map(([connectionId, override]) => ({ connectionId, override: clone(override) })),
    closedVersion: async () => {
      const closed = this.data.paperTrades.filter((t) => t.status === 'CLOSED');
      return `${closed.length}|${closed.map((t) => t.exitAt ?? '').sort().at(-1) ?? ''}|${this.data.paperTrades.length}`;
    },
    reset: async (id: string) => {
      const before = this.data.paperTrades.length;
      this.data.paperTrades = this.data.paperTrades.filter((t) => t.strategyId !== id);
      return before - this.data.paperTrades.length;
    },
  };

  maintenance = {
    size: async (): Promise<DatabaseSize> => ({ engine: 'memory', bytes: null, limitBytes: null, tables: [] }),
    prune: async (before: string): Promise<PruneResult> => {
      const d = this.data;
      const n = { alerts: d.alerts.length, signals: d.signals.length, paperTrades: d.paperTrades.length, scanRuns: d.runs.length };
      d.paperTrades = d.paperTrades.filter((t) => !(t.status === 'CLOSED' && t.exitAt && t.exitAt < before));
      d.alerts = d.alerts.filter((a) => a.createdAt >= before);
      const kept = new Set(d.alerts.map((a) => a.signalId));
      d.signals = d.signals.filter((s) => s.createdAt >= before || kept.has(s.id));
      d.runs = d.runs.filter((r) => r.startedAt >= before);
      return { alerts: n.alerts - d.alerts.length, signals: n.signals - d.signals.length, paperTrades: n.paperTrades - d.paperTrades.length, scanRuns: n.scanRuns - d.runs.length };
    },
  };

  live = {
    get: async () => clone(this.data.live),
    save: async (status: LiveStatus) => {
      this.data.live = { status: clone(status), offlineNotifiedAt: null };
    },
    markOfflineNotified: async (at: string) => {
      if (this.data.live) this.data.live.offlineNotifiedAt = at;
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
