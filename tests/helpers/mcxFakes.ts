/**
 * In-memory stand-ins for MCX V2 tests: a McxStore with the same dedupe
 * semantics as Postgres (unique signal identity, versioned strategies, lease
 * locks), a candle-fixture data provider, a recording channel factory, and
 * builders for instruments, candles and strategy definitions.
 */
import { randomUUID } from 'node:crypto';
import type {
  CalendarEntry,
  ExprNode,
  McxAlert,
  McxDelivery,
  McxInstrument,
  McxScanRun,
  McxSettings,
  McxSignal,
  McxStrategy,
  McxStrategyDefinition,
  McxStrategyVersion,
  NativeInterval,
  Operand,
  SeriesSpec,
  UnitState,
} from '../../src/shared/mcx';
import { DEFAULT_MCX_SETTINGS } from '../../src/shared/mcx';
import type { ChannelFactory, ChannelName, McxChannel, McxMessage } from '../../src/server/mcx/alerts/notifications';
import type { RawCandle } from '../../src/server/mcx/engine/candles';
import type { CandleQuery, McxDataProvider, McxQuote } from '../../src/server/mcx/data/McxDataProvider';
import type { AlertFilters, McxStore } from '../../src/server/mcx/persistence/McxStore';
import { IST_OFFSET_MS } from '../../src/server/utils/marketTime';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryMcxStore implements McxStore {
  data = {
    instruments: [] as McxInstrument[],
    syncedAt: null as string | null,
    calendar: [] as CalendarEntry[],
    strategies: new Map<string, Omit<McxStrategy, 'definition'>>(),
    versions: new Map<string, McxStrategyVersion[]>(),
    units: new Map<string, UnitState>(),
    signals: [] as McxSignal[],
    alerts: [] as McxAlert[],
    runs: [] as McxScanRun[],
    settings: { ...DEFAULT_MCX_SETTINGS } as McxSettings,
    locks: new Map<string, number>(),
  };
  private clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  private strategy(id: string): McxStrategy | null {
    const s = this.data.strategies.get(id);
    if (!s) return null;
    const v = this.data.versions.get(id)!.find((x) => x.version === s.version)!;
    return clone({ ...s, definition: v.definition });
  }

  instruments = {
    replaceAll: async (list: McxInstrument[]) => {
      this.data.instruments = clone(list);
      this.data.syncedAt = new Date(this.clock()).toISOString();
    },
    list: async () => clone(this.data.instruments),
    count: async () => this.data.instruments.length,
    syncedAt: async () => this.data.syncedAt,
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
    create: async (definition: McxStrategyDefinition) => {
      const id = randomUUID();
      const at = new Date(this.clock()).toISOString();
      this.data.strategies.set(id, { id, name: definition.name, enabled: false, enabledAt: null, version: 1, createdAt: at, updatedAt: at });
      this.data.versions.set(id, [{ version: 1, definition: clone(definition), createdAt: at }]);
      return this.strategy(id)!;
    },
    update: async (id: string, definition: McxStrategyDefinition) => {
      const s = this.data.strategies.get(id);
      if (!s) return null;
      const at = new Date(this.clock()).toISOString();
      s.version += 1;
      s.name = definition.name;
      s.updatedAt = at;
      this.data.versions.get(id)!.push({ version: s.version, definition: clone(definition), createdAt: at });
      return this.strategy(id);
    },
    setEnabled: async (id: string, enabled: boolean, at: string) => {
      const s = this.data.strategies.get(id);
      if (!s) return null;
      s.enabled = enabled;
      if (enabled) s.enabledAt = at;
      return this.strategy(id);
    },
    remove: async (id: string) => {
      const had = this.data.strategies.delete(id);
      for (const k of [...this.data.units.keys()]) if (k.startsWith(`${id}|`)) this.data.units.delete(k);
      return had;
    },
    versions: async (id: string) => clone([...(this.data.versions.get(id) ?? [])].reverse()),
  };

  units = {
    list: async (strategyId?: string) => clone([...this.data.units.values()].filter((u) => !strategyId || u.strategyId === strategyId)),
    get: async (strategyId: string, target: string) => clone(this.data.units.get(`${strategyId}|${target}`) ?? null),
    upsert: async (s: UnitState) => {
      this.data.units.set(`${s.strategyId}|${s.targetInstrumentId}`, clone({ ...s, updatedAt: new Date(this.clock()).toISOString() }));
    },
    clear: async (strategyId: string) => {
      for (const k of [...this.data.units.keys()]) if (k.startsWith(`${strategyId}|`)) this.data.units.delete(k);
    },
  };

  signals = {
    insert: async (s: Omit<McxSignal, 'id' | 'createdAt'>) => {
      if (this.data.signals.some((x) => x.identity === s.identity)) return null;
      const row: McxSignal = { ...clone(s), id: randomUUID(), createdAt: new Date(this.clock()).toISOString() };
      this.data.signals.push(row);
      return clone(row);
    },
    list: async (strategyId?: string, limit = 100) =>
      clone(
        this.data.signals
          .filter((s) => !strategyId || s.strategyId === strategyId)
          .reverse()
          .slice(0, limit),
      ),
  };

  alerts = {
    insert: async (a: Omit<McxAlert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'>) => {
      const row: McxAlert = { ...clone(a), id: randomUUID(), deliveries: [], acknowledgedAt: null, createdAt: new Date(this.clock()).toISOString() };
      this.data.alerts.push(row);
      return clone(row);
    },
    addDelivery: async (id: string, d: McxDelivery) => {
      this.data.alerts.find((a) => a.id === id)?.deliveries.push(clone(d));
    },
    setStatus: async (id: string, status: McxAlert['status']) => {
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
          .filter((a) => (!f.strategyId || a.strategyId === f.strategyId) && (!f.active || !a.acknowledgedAt))
          .slice(0, f.limit ?? 200),
      ),
  };

  scanRuns = {
    insert: async (r: McxScanRun) => {
      this.data.runs.push(clone(r));
    },
    list: async (limit: number) => clone([...this.data.runs].reverse().slice(0, limit)),
    get: async (id: string) => clone(this.data.runs.find((r) => r.id === id) ?? null),
    prune: async (before: string) => {
      this.data.runs = this.data.runs.filter((r) => r.startedAt >= before);
    },
  };

  settings = {
    get: async () => clone(this.data.settings),
    save: async (s: McxSettings) => {
      this.data.settings = clone(s);
      return clone(s);
    },
  };

  locks = {
    acquire: async (name: string, leaseSeconds: number, _minIntervalSeconds = 0) => {
      const until = this.data.locks.get(name) ?? 0;
      if (until > this.clock()) return false;
      this.data.locks.set(name, this.clock() + leaseSeconds * 1000);
      return true;
    },
    release: async (name: string) => {
      this.data.locks.delete(name);
    },
  };
}

/** Fixture provider: candles per `${token}|${interval}`, LTP per token. Counts calls. */
export class FixtureMcxProvider implements McxDataProvider {
  readonly name = 'fixture';
  connected = true;
  candles = new Map<string, RawCandle[]>();
  ltp = new Map<number, number>();
  failTokens = new Set<number>();
  calls = { historical: 0, ltp: 0, quotes: 0, instruments: 0 };
  queries: CandleQuery[] = [];

  constructor(public instruments: McxInstrument[] = []) {}

  set(inst: McxInstrument, interval: NativeInterval, candles: RawCandle[]): this {
    this.candles.set(`${inst.token}|${interval}`, candles);
    return this;
  }

  async isConnected() {
    return this.connected;
  }
  async getInstruments() {
    this.calls.instruments++;
    return clone(this.instruments);
  }
  async getHistoricalCandles(q: CandleQuery) {
    this.calls.historical++;
    this.queries.push(q);
    if (this.failTokens.has(q.instrument.token)) throw new Error('fixture: upstream error');
    const all = this.candles.get(`${q.instrument.token}|${q.interval}`) ?? [];
    const from = Date.parse(`${q.from}T00:00:00Z`) - IST_OFFSET_MS;
    const to = Date.parse(`${q.to}T23:59:59Z`) - IST_OFFSET_MS;
    return all.filter((c) => c.time * 1000 >= from && c.time * 1000 <= to);
  }
  async getLtp(list: McxInstrument[]) {
    this.calls.ltp++;
    return new Map(list.flatMap((i) => (this.ltp.has(i.token) ? [[i.token, this.ltp.get(i.token)!] as [number, number]] : [])));
  }
  async getQuotes(list: McxInstrument[]) {
    this.calls.quotes++;
    return new Map<number, McxQuote>(list.flatMap((i) => (this.ltp.has(i.token) ? [[i.token, { ltp: this.ltp.get(i.token)! }] as [number, McxQuote]] : [])));
  }
}

/** Channel factory that records messages (optionally failing a channel). */
export class RecordingChannels implements ChannelFactory {
  sent: Array<{ channel: ChannelName; message: McxMessage }> = [];
  fail = new Set<ChannelName>();
  configured = { telegram: true, email: true };

  status() {
    return {
      telegram: { configured: this.configured.telegram, detail: this.configured.telegram ? 'test chat' : 'not configured' },
      email: { configured: this.configured.email, detail: this.configured.email ? 'test inbox' : 'not configured' },
    };
  }
  channel(name: ChannelName): McxChannel | null {
    if (!this.configured[name]) return null;
    return {
      name,
      send: async (message: McxMessage) => {
        if (this.fail.has(name)) throw new Error(`${name} down`);
        this.sent.push({ channel: name, message });
      },
    };
  }
}

// ---- builders -----------------------------------------------------------------------

let token = 5000;
export function future(underlying: string, expiry: string): McxInstrument {
  const t = token++;
  return { id: `MCX:${t}`, token: t, exchange: 'MCX', instrumentType: 'MCX_FUTURE', underlying, symbol: `${underlying}${expiry.replace(/-/g, '')}FUT`, expiry, strike: null, optionType: null, lotSize: 1, tickSize: 1, active: true };
}
export function option(underlying: string, expiry: string, strike: number, type: 'CE' | 'PE'): McxInstrument {
  const t = token++;
  return {
    id: `MCX:${t}`,
    token: t,
    exchange: 'MCX',
    instrumentType: 'MCX_OPTION',
    underlying,
    symbol: `${underlying}${expiry.replace(/-/g, '')}${strike}${type}`,
    expiry,
    strike,
    optionType: type,
    lotSize: 1,
    tickSize: 0.5,
    active: true,
  };
}

/** Epoch ms of an IST wall-clock time. */
export function ist(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00Z`) - IST_OFFSET_MS;
}

/** Candles every `minutes` from `startMs`, one per close value (open = previous close). */
export function candlesFrom(startMs: number, minutes: number, closes: number[], opts: { volume?: number | number[]; spread?: number } = {}): RawCandle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    const spread = opts.spread ?? 1;
    const volume = Array.isArray(opts.volume) ? (opts.volume[i] ?? 100) : (opts.volume ?? 100);
    return { time: Math.floor((startMs + i * minutes * 60_000) / 1000), open, high: Math.max(open, close) + spread, low: Math.min(open, close) - spread, close, volume, oi: 1000 + i };
  });
}

/** Open times of `count` intraday candles over consecutive MCX sessions (09:00 → close), skipping weekends. */
export function sessionTimes(startDate: string, minutes: number, count: number, closeHHMM = '23:30'): number[] {
  const times: number[] = [];
  let d = startDate;
  while (times.length < count) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) {
      for (let t = ist(d, '09:00'); t < ist(d, closeHHMM) && times.length < count; t += minutes * 60_000) times.push(t);
    }
    d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return times;
}

/** Open times of `count` candles ending with the candle that opens at `lastOpenMs`, walking back through sessions (weekdays, 09:00 → close). */
export function timesEndingAt(lastOpenMs: number, minutes: number, count: number, closeHHMM = '23:30'): number[] {
  const out = [lastOpenMs];
  const step = minutes * 60_000;
  while (out.length < count) {
    const t = out[0]! - step;
    const day = new Date(out[0]! + IST_OFFSET_MS).toISOString().slice(0, 10);
    if (t >= ist(day, '09:00')) {
      out.unshift(t);
      continue;
    }
    let d = day;
    do d = new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
    const open = ist(d, '09:00');
    const close = ist(d, closeHHMM);
    out.unshift(open + Math.floor((close - 1 - open) / step) * step);
  }
  return out;
}

export function candlesAt(times: number[], closes: number[], opts: { volume?: number | number[]; spread?: number; ohlc?: Array<Partial<RawCandle> | undefined> } = {}): RawCandle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    const spread = opts.spread ?? 1;
    const volume = Array.isArray(opts.volume) ? (opts.volume[i] ?? 100) : (opts.volume ?? 100);
    const base: RawCandle = { time: Math.floor(times[i]! / 1000), open, high: Math.max(open, close) + spread, low: Math.min(open, close) - spread, close, volume, oi: 1000 + i };
    return { ...base, ...(opts.ohlc?.[i] ?? {}) };
  });
}

export const TARGET = (timeframe: SeriesSpec['timeframe'], candle: SeriesSpec['candle'] = { type: 'NORMAL' }): SeriesSpec => ({ instrument: { role: 'TARGET' }, timeframe, candle });
export const UNDERLYING = (timeframe: SeriesSpec['timeframe'], candle: SeriesSpec['candle'] = { type: 'NORMAL' }): SeriesSpec => ({ instrument: { role: 'UNDERLYING' }, timeframe, candle });

export const ind = (series: SeriesSpec, indicator: string, params: Record<string, number>, extra: Partial<Extract<Operand, { kind: 'INDICATOR' }>> = {}): Operand => ({
  kind: 'INDICATOR',
  series,
  indicator,
  params,
  ...extra,
});
export const field = (series: SeriesSpec, f: 'open' | 'high' | 'low' | 'close' | 'volume' | 'oi' = 'close'): Operand => ({ kind: 'FIELD', series, field: f });
export const num = (value: number): Operand => ({ kind: 'CONSTANT', value });

let nodeId = 0;
export const cond = (left: Operand, operator: Extract<ExprNode, { type: 'CONDITION' }>['operator'], right: Operand): ExprNode => ({ type: 'CONDITION', id: `c${nodeId++}`, left, operator, right });
export const and = (...children: ExprNode[]): ExprNode => ({ type: 'AND', id: `g${nodeId++}`, children });
export const or = (...children: ExprNode[]): ExprNode => ({ type: 'OR', id: `g${nodeId++}`, children });
export const not = (child: ExprNode): ExprNode => ({ type: 'NOT', id: `n${nodeId++}`, child });
