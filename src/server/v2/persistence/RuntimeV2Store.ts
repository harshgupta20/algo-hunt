/**
 * The database layer for one running app (npm start: UI, API, scanner and live worker in one process).
 * Neon keeps the core records — strategies, connections, settings, calendar, paper settings, alerts and
 * paper trades — written only when you save something or a real event happens (an alert, a paper trade
 * opening or closing). Everything that changes by the second lives in this process's memory:
 *
 *   memory only        live worker status, scanner cycles, suppressed signals, paper trades' latest prices,
 *                      unit results per candle, scan lock, "has anything changed?" stamp
 *   memory + Neon      cached on first use, written through on change: strategies, connections, settings,
 *                      calendar, products, paper plans / overrides, open paper trades, the Kite contract
 *                      list (per product), unit states (saved only when an alert decision changes them)
 *   Neon               alerts (+ deliveries) and their signals, paper trades opening / closing, alert and
 *                      paper history when you open it (kept in memory until the next change)
 *
 * Events never wait for the database: an alert, its delivery, the unit's state and the paper trade exist in
 * memory at once and their writes go to a queue (writeQueue.ts) that saves them in order — retrying while
 * Neon is asleep or unreachable. Anything read from the database waits for the queue first.
 *
 * Valid only while this process is the only one writing (the live worker runs inside it) — see
 * runtime.ts. The state lives on globalThis so every module copy in the process shares it.
 */
import type {
  AlertFeedItem,
  CalendarEntry,
  ConnectionConfig,
  Delivery,
  ExprTrace,
  LiveStatus,
  PaperOverride,
  PaperPlan,
  PaperTrade,
  ProductKind,
  ScanRun,
  StrategyDefinition,
  UnitState,
  V2Alert,
  V2AlertItem,
  V2Connection,
  V2Instrument,
  V2Product,
  V2Settings,
  V2Signal,
  V2SignalItem,
  V2Strategy,
} from '@/shared/v2';
import { newestFirst, offersKinds, olderThan } from '@/shared/v2';
import type { AlertFilters, DatabaseSize, NewAlert, NewPaperTrade, NewSignal, ProductFilters, PruneResult, RecordStoreFilters, SignalFilters, V2Store } from './V2Store';
import { WriteQueue, type WriteQueueOptions } from './writeQueue';

const KEEP_SIGNALS = 1_000;
const KEEP_RUNS = 200;
const KEEP_FEED = 200;
/** Alerts of this run kept in memory (merged into lists, served in full when opened). */
const KEEP_RECENT = 1_000;
/** List pages (filters + cursor) read from the database and kept. */
const KEEP_LISTS = 40;
/** Closed paper trades kept in memory (all of them, up to this many). */
const KEEP_CLOSED = 50_000;
const SIZE_FRESH_MS = 10 * 60_000;
/** After the database failed to give the alarm feed, try again after this long (the alarm uses this run's alerts meanwhile). */
const FEED_RETRY_MS = 60_000;

export interface RuntimeOptions {
  /** Where records waiting to be saved are kept across restarts. */
  pendingFile?: string;
  retryMs?: WriteQueueOptions['retryMs'];
  log?: WriteQueueOptions['log'];
}

interface RuntimeState {
  strategies?: Map<string, V2Strategy>;
  connections?: Map<string, V2Connection>;
  settings?: V2Settings;
  calendar?: CalendarEntry[];
  products?: V2Product[];
  instrumentCount?: number;
  syncedAt?: string | null;
  instruments: Map<string, V2Instrument[]>;
  plans?: Map<string, PaperPlan>;
  overrides?: Map<string, PaperOverride>;
  open?: Map<string, PaperTrade>;
  closedVersion: number;
  units?: Map<string, UnitState>;
  /** What was last saved per unit (only alert-decision fields are saved). */
  unitSaved: Map<string, string>;
  signals: V2Signal[];
  feed?: AlertFeedItem[];
  runs: ScanRun[];
  live: { status: LiveStatus; offlineNotifiedAt: string | null } | null;
  locks: Map<string, { until: number; lastRun: number | null }>;
  stamp: number;
  loading: Map<string, Promise<unknown>>;
  /** Database writes waiting to be saved (created with the first store). */
  writes?: WriteQueue;
  /** Alerts recorded by this run (newest last), in full — merged into lists, deliveries added here, the alarm's fallback. */
  recent: Map<string, V2Alert>;
  /** Identities of the alerting signals this run recorded (dedupe without asking the database). */
  alerted: Set<string>;
  /**
   * List pages read from the database. New alerts / signals don't throw them away — they are merged in from
   * memory; a page is read again only when history changed (`listGen`: acknowledge, deletions) or when a record
   * created after it was read has left memory (`evicted*At`).
   */
  lists: Map<string, { gen: number; readAt: string; seq?: number; rows: unknown }>;
  listGen: number;
  evictedAlertAt: string;
  evictedSignalAt: string;
  /**
   * Counting this run's records on top of a stored count needs to know which ones the count already had: each
   * recorded alert / alerting signal gets the next number; a cached count keeps the number it was read at.
   */
  alertSeq: number;
  signalSeq: number;
  seqOf: Map<string, number>;
  evictedAlertSeq: number;
  evictedSignalSeq: number;
  feedFailedAt: number | null;
  /** Every closed paper trade, read once (null until then); trades closed before that read waited in `closedSince`. */
  closedRead: PaperTrade[] | null;
  closedSince: PaperTrade[];
  size: { at: number; value: DatabaseSize } | null;
}

const g = globalThis as unknown as { __ashRuntimeState?: RuntimeState };

/** Fresh, empty state (tests use their own). */
export function createRuntimeState(): RuntimeState {
  return {
    instruments: new Map(),
    closedVersion: 0,
    unitSaved: new Map(),
    signals: [],
    runs: [],
    live: null,
    locks: new Map(),
    stamp: 0,
    loading: new Map(),
    recent: new Map(),
    alerted: new Set(),
    lists: new Map(),
    listGen: 0,
    evictedAlertAt: '',
    evictedSignalAt: '',
    alertSeq: 0,
    signalSeq: 0,
    seqOf: new Map(),
    evictedAlertSeq: 0,
    evictedSignalSeq: 0,
    feedFailedAt: null,
    closedRead: null,
    closedSince: [],
    size: null,
  };
}

/** This process's state. */
export function runtimeState(): RuntimeState {
  g.__ashRuntimeState ??= createRuntimeState();
  return g.__ashRuntimeState;
}

/** Forget everything cached (tests). */
export function resetRuntimeState(): void {
  g.__ashRuntimeState = undefined;
}

const clone = <T>(v: T): T => (v === undefined || v === null ? v : structuredClone(v));
const unitKey = (connectionId: string, key: string) => `${connectionId}|${key}`;
/** The unit-state fields an alert decision changes — the only ones worth saving. */
const decisionSig = (s: UnitState) => JSON.stringify([s.state, s.lastSignalCandle, s.lastAlertAt, s.cooldownUntil]);
const stripTrace = <E extends { trace?: unknown }>(e: E): Omit<E, 'trace'> => {
  const { trace: _t, ...rest } = e;
  return rest;
};
/** Only which top-level group fired (for the group filter) — the full trace is on the alert. */
const shallowTrace = (t: ExprTrace): ExprTrace => ({ id: t.id, type: t.type, result: t.result, label: t.label, children: t.children?.map((c) => ({ id: c.id, type: c.type, label: c.label, result: c.result })) });
const PRODUCT_ORDER: Record<ProductKind, number> = { INDEX: 0, COMMODITY: 1, STOCK: 2 };
const feedItem = (a: V2Alert): AlertFeedItem => ({ id: a.id, strategyName: a.strategyName, productId: a.productId, unit: clone(a.unit), createdAt: a.createdAt });
const byCreated = newestFirst<{ id: string; createdAt: string }>((x) => x.createdAt);
const byEntry = newestFirst<PaperTrade>((t) => t.entryAt);
/** An alert as lists show it (without the condition trace and the duplicate unit). */
const alertItem = (a: V2Alert): V2AlertItem => {
  const { trace: _t, unit: _u, ...evaluation } = a.evaluation;
  return clone({ ...a, evaluation });
};

export class RuntimeV2Store implements V2Store {
  private readonly q: WriteQueue;

  constructor(
    private readonly db: V2Store,
    private readonly clock: () => number = Date.now,
    private readonly rt: RuntimeState = runtimeState(),
    opts: RuntimeOptions = {},
  ) {
    if (!this.rt.writes) {
      this.rt.writes = new WriteQueue(db, { clock, file: opts.pendingFile, retryMs: opts.retryMs, log: opts.log });
      // Scanner cycles saved before the app kept them in memory: removed once at start (they were always kept 3 days).
      this.rt.writes.push({ op: 'scanRuns.prune', args: [new Date(clock() - 3 * 86_400_000).toISOString()] });
    }
    this.q = this.rt.writes;
  }

  /** A database call after the waiting writes are saved (so it sees them). */
  private async read<T>(fn: () => Promise<T>): Promise<T> {
    await this.q.drain();
    return fn();
  }

  /**
   * A list page read from the database and kept (see RuntimeState.lists); records of this run are merged in by
   * the caller. Not kept while writes wait. Falls back to the last read while the database can't be reached.
   */
  private async cachedList<T>(key: string, evictedAt: string, load: () => Promise<T>): Promise<T> {
    return (await this.cachedEntry(key, evictedAt, load)).rows;
  }

  /**
   * As cachedList, with when it was read. With `seq` (counts): the record number it was read at — records with a
   * higher number aren't in it; it isn't kept when a record arrived during the read, or when one numbered after
   * it has left memory (`evictedSeq`).
   */
  private async cachedEntry<T>(key: string, evictedAt: string, load: () => Promise<T>, counter?: { seq: () => number; evicted: number }): Promise<{ rows: T; readAt: string; seq: number }> {
    const hit = this.rt.lists.get(key);
    if (hit && hit.gen === this.rt.listGen && hit.readAt > evictedAt && (!counter || (hit.seq ?? -1) >= counter.evicted)) {
      this.rt.lists.delete(key);
      this.rt.lists.set(key, hit);
      return { rows: clone(hit.rows as T), readAt: hit.readAt, seq: hit.seq ?? 0 };
    }
    const readAt = this.iso();
    let rows: T;
    let seq = 0;
    try {
      rows = await this.read(async () => {
        seq = counter?.seq() ?? 0; // every record up to here is saved (read() waited for the queue)
        return load();
      });
    } catch (err) {
      if (hit) return { rows: clone(hit.rows as T), readAt: hit.readAt, seq: hit.seq ?? 0 };
      throw err;
    }
    if (!this.q.size && (!counter || counter.seq() === seq)) {
      this.rt.lists.delete(key);
      this.rt.lists.set(key, { gen: this.rt.listGen, readAt, seq, rows: clone(rows) });
      while (this.rt.lists.size > KEEP_LISTS) this.rt.lists.delete(this.rt.lists.keys().next().value!);
    }
    return { rows, readAt, seq };
  }

  /** Records changed in a way merging can't show (an acknowledgement): read list pages again. */
  private listsChanged(): void {
    this.rt.listGen++;
    this.rt.lists.clear();
  }

  /** Alert / signal history deleted (with a strategy or connection, the history clean-up). */
  private historyChanged(): void {
    this.listsChanged();
    this.rt.feed = undefined;
  }

  /**
   * Load everything the scanner, the live worker and the screens use, at start — so the first alert never
   * waits for the database (e.g. for the open paper trades). Failures are left for the first real use.
   */
  async warmUp(): Promise<void> {
    await Promise.allSettled([
      this.strategyMap(),
      this.connectionMap(),
      this.settings.get(),
      this.calendar.list(),
      this.productList(),
      this.instruments.count(),
      this.instruments.syncedAt(),
      this.planMap(),
      this.overrideMap(),
      this.openMap(),
      this.unitMap(),
      this.feedList(),
      this.closedAll(),
    ]);
  }

  /** Records waiting to be saved — shown in the status bar. */
  pendingWrites() {
    return this.q.pending();
  }

  /** Wait until every waiting write is saved (tests; returns at once while the database is failing). */
  flushWrites(): Promise<void> {
    return this.q.drain();
  }

  /** Load something once (concurrent callers share one database read). */
  private async once<T>(name: string, has: () => boolean, load: () => Promise<void>): Promise<void> {
    if (has()) return;
    let p = this.rt.loading.get(name) as Promise<T> | undefined;
    if (!p) {
      p = load().finally(() => this.rt.loading.delete(name)) as Promise<T>;
      this.rt.loading.set(name, p);
    }
    await p;
  }

  private changed(): void {
    this.rt.stamp++;
  }

  private iso(): string {
    return new Date(this.clock()).toISOString();
  }

  // ---- products / instruments ----------------------------------------------------------------

  private async productList(): Promise<V2Product[]> {
    await this.once('products', () => !!this.rt.products, async () => {
      this.rt.products = await this.read(() => this.db.products.list({ limit: 5000 }));
    });
    return this.rt.products!;
  }

  private productMatches(p: V2Product, f: ProductFilters): boolean {
    const q = f.search?.toUpperCase();
    return (
      (!f.ids || f.ids.includes(p.id)) &&
      (!f.kind || p.kind === f.kind) &&
      (!f.market || p.market === f.market) &&
      (!f.needs?.length || offersKinds(p, f.needs)) &&
      (!q || p.symbol.toUpperCase().includes(q) || p.name.toUpperCase().includes(q))
    );
  }

  instruments = {
    replaceAll: async (list: V2Instrument[], products: V2Product[]) => {
      await this.read(() => this.db.instruments.replaceAll(list, products));
      this.rt.instruments.clear();
      this.rt.products = undefined;
      this.rt.instrumentCount = list.length;
      this.rt.syncedAt = undefined; // re-read once (the database's own sync time)
      this.changed();
    },
    forProduct: async (productId: string) => {
      const hit = this.rt.instruments.get(productId);
      if (hit) return hit;
      const list = await this.read(() => this.db.instruments.forProduct(productId));
      this.rt.instruments.set(productId, list);
      return list;
    },
    count: async () => {
      await this.once('instrumentCount', () => this.rt.instrumentCount !== undefined, async () => {
        this.rt.instrumentCount = await this.read(() => this.db.instruments.count());
      });
      return this.rt.instrumentCount!;
    },
    syncedAt: async () => {
      await this.once('syncedAt', () => this.rt.syncedAt !== undefined, async () => {
        this.rt.syncedAt = await this.read(() => this.db.instruments.syncedAt());
      });
      return this.rt.syncedAt ?? null;
    },
  };

  products = {
    list: async (f: ProductFilters = {}) =>
      clone(
        (await this.productList())
          .filter((p) => this.productMatches(p, f))
          .sort((a, b) => PRODUCT_ORDER[a.kind] - PRODUCT_ORDER[b.kind] || Number(b.hasOptions) - Number(a.hasOptions) || a.symbol.localeCompare(b.symbol) || a.id.localeCompare(b.id))
          .slice(Math.max(0, f.offset ?? 0), Math.max(0, f.offset ?? 0) + Math.min(f.limit ?? 5000, 5000)),
      ),
    get: async (id: string) => clone((await this.productList()).find((p) => p.id === id) ?? null),
    count: async () => (await this.productList()).length,
    countByKind: async (f: Pick<ProductFilters, 'search' | 'market' | 'needs'> = {}) => {
      const out: Record<ProductKind, number> = { INDEX: 0, STOCK: 0, COMMODITY: 0 };
      for (const p of await this.productList()) if (this.productMatches(p, f)) out[p.kind]++;
      return out;
    },
  };

  // ---- calendar / settings ---------------------------------------------------------------------

  calendar = {
    list: async () => {
      await this.once('calendar', () => !!this.rt.calendar, async () => {
        this.rt.calendar = await this.read(() => this.db.calendar.list());
      });
      return clone(this.rt.calendar!);
    },
    replaceAll: async (entries: CalendarEntry[]) => {
      await this.read(() => this.db.calendar.replaceAll(entries));
      this.rt.calendar = clone(entries);
      this.changed();
    },
  };

  settings = {
    get: async () => {
      await this.once('settings', () => !!this.rt.settings, async () => {
        this.rt.settings = await this.read(() => this.db.settings.get());
      });
      return clone(this.rt.settings!);
    },
    save: async (s: V2Settings) => {
      const out = await this.read(() => this.db.settings.save(s));
      this.rt.settings = clone(out);
      this.changed();
      return out;
    },
  };

  // ---- strategies / connections ----------------------------------------------------------------

  private async strategyMap(): Promise<Map<string, V2Strategy>> {
    await this.once('strategies', () => !!this.rt.strategies, async () => {
      this.rt.strategies = new Map((await this.read(() => this.db.strategies.list())).map((s) => [s.id, s]));
    });
    return this.rt.strategies!;
  }

  private async connectionMap(): Promise<Map<string, V2Connection>> {
    await this.once('connections', () => !!this.rt.connections, async () => {
      this.rt.connections = new Map((await this.read(() => this.db.connections.list())).map((c) => [c.id, c]));
    });
    return this.rt.connections!;
  }

  strategies = {
    list: async () => clone([...(await this.strategyMap()).values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
    count: async () => (await this.strategyMap()).size,
    get: async (id: string) => clone((await this.strategyMap()).get(id) ?? null),
    create: async (definition: StrategyDefinition) => {
      const s = await this.read(() => this.db.strategies.create(definition));
      (await this.strategyMap()).set(s.id, s);
      this.changed();
      return clone(s);
    },
    update: async (id: string, definition: StrategyDefinition) => {
      const s = await this.read(() => this.db.strategies.update(id, definition));
      if (s) (await this.strategyMap()).set(s.id, s);
      this.changed();
      return clone(s);
    },
    remove: async (id: string) => {
      const ok = await this.read(() => this.db.strategies.remove(id));
      (await this.strategyMap()).delete(id);
      // The database removes its connections, alerts, paper plan and trades with it.
      const conns = await this.connectionMap();
      for (const [cid, c] of conns) if (c.strategyId === id) conns.delete(cid);
      this.rt.plans?.delete(id);
      for (const [tid, t] of this.rt.open ?? []) if (t.strategyId === id) this.rt.open!.delete(tid);
      for (const [aid, a] of this.rt.recent) if (a.strategyId === id) this.rt.recent.delete(aid);
      this.dropClosed((t) => t.strategyId === id);
      this.historyChanged();
      this.changed();
      return ok;
    },
    versions: (id: string) => this.read(() => this.db.strategies.versions(id)),
  };

  connections = {
    list: async (strategyId?: string) =>
      clone([...(await this.connectionMap()).values()].filter((c) => !strategyId || c.strategyId === strategyId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
    counts: async () => {
      const all = [...(await this.connectionMap()).values()];
      return { total: all.length, enabled: all.filter((c) => c.enabled).length };
    },
    get: async (id: string) => clone((await this.connectionMap()).get(id) ?? null),
    create: async (strategyId: string, productId: string, config: ConnectionConfig) => {
      const c = await this.read(() => this.db.connections.create(strategyId, productId, config));
      (await this.connectionMap()).set(c.id, c);
      this.changed();
      return clone(c);
    },
    update: async (id: string, config: ConnectionConfig) => {
      const c = await this.read(() => this.db.connections.update(id, config));
      if (c) (await this.connectionMap()).set(c.id, c);
      this.changed();
      return clone(c);
    },
    setEnabled: async (id: string, enabled: boolean, at: string) => {
      const c = await this.read(() => this.db.connections.setEnabled(id, enabled, at));
      if (c) (await this.connectionMap()).set(c.id, c);
      this.changed();
      return clone(c);
    },
    setEnabledMany: async (ids: string[], enabled: boolean, at: string) => {
      const n = await this.read(() => this.db.connections.setEnabledMany(ids, enabled, at));
      const map = await this.connectionMap();
      const now = this.iso();
      for (const id of ids) {
        const c = map.get(id);
        if (c) map.set(id, { ...c, enabled, enabledAt: enabled ? at : c.enabledAt, updatedAt: now });
      }
      this.changed();
      return n;
    },
    remove: async (id: string) => {
      const ok = await this.read(() => this.db.connections.remove(id));
      (await this.connectionMap()).delete(id);
      for (const k of [...(this.rt.units?.keys() ?? [])]) if (k.startsWith(`${id}|`)) this.rt.units!.delete(k);
      this.rt.overrides?.delete(id);
      for (const [tid, t] of this.rt.open ?? []) if (t.connectionId === id) this.rt.open!.delete(tid);
      for (const [aid, a] of this.rt.recent) if (a.connectionId === id) this.rt.recent.delete(aid);
      this.dropClosed((t) => t.connectionId === id);
      this.historyChanged();
      this.changed();
      return ok;
    },
  };

  // ---- unit states: memory; saved when an alert decision changes them ---------------------------

  private async unitMap(): Promise<Map<string, UnitState>> {
    await this.once('units', () => !!this.rt.units, async () => {
      const conns = [...(await this.connectionMap()).keys()];
      // Without the saved last evaluations (old, and most of each row) — this run evaluates afresh.
      const list = conns.length ? await this.read(() => this.db.units.listFor(conns, { light: true })) : [];
      this.rt.units = new Map(list.map((u) => [unitKey(u.connectionId, u.unitKey), u]));
      for (const u of list) this.rt.unitSaved.set(unitKey(u.connectionId, u.unitKey), decisionSig(u));
    });
    return this.rt.units!;
  }

  units = {
    list: async (connectionId: string) =>
      clone([...(await this.unitMap()).values()].filter((u) => u.connectionId === connectionId).sort((a, b) => a.unitKey.localeCompare(b.unitKey))),
    listFor: async (connectionIds: string[], _opts?: { light?: boolean }) => {
      const set = new Set(connectionIds);
      return clone([...(await this.unitMap()).values()].filter((u) => set.has(u.connectionId)));
    },
    get: async (connectionId: string, key: string) => clone((await this.unitMap()).get(unitKey(connectionId, key)) ?? null),
    upsert: async (s: UnitState) => this.units.upsertMany([s]),
    upsertMany: async (list: UnitState[]) => {
      const map = await this.unitMap();
      const save: UnitState[] = [];
      const at = this.iso();
      for (const s of list) {
        const k = unitKey(s.connectionId, s.unitKey);
        map.set(k, { ...clone(s), updatedAt: at });
        const sig = decisionSig(s);
        if (this.rt.unitSaved.get(k) !== sig) {
          save.push({ ...s, lastEvaluation: null }); // the trace stays in memory (Explain recreates it)
          this.rt.unitSaved.set(k, sig);
        }
      }
      if (save.length) this.q.push({ op: 'units.upsertMany', args: [save] });
    },
    clear: async (connectionId: string) => {
      await this.read(() => this.db.units.clear(connectionId));
      for (const k of [...(await this.unitMap()).keys()]) if (k.startsWith(`${connectionId}|`)) (this.rt.units!.delete(k), this.rt.unitSaved.delete(k));
    },
    clearMany: async (connectionIds: string[]) => {
      if (!connectionIds.length) return;
      await this.read(() => this.db.units.clearMany(connectionIds));
      const ids = new Set(connectionIds);
      for (const [k, u] of await this.unitMap()) if (ids.has(u.connectionId)) (this.rt.units!.delete(k), this.rt.unitSaved.delete(k));
    },
    disableMany: async (connectionIds: string[]) => {
      if (!connectionIds.length) return;
      await this.read(() => this.db.units.disableMany(connectionIds));
      const ids = new Set(connectionIds);
      for (const [k, u] of await this.unitMap()) {
        if (!ids.has(u.connectionId)) continue;
        const next = { ...u, state: 'DISABLED' as const };
        this.rt.units!.set(k, next);
        this.rt.unitSaved.set(k, decisionSig(next));
      }
    },
  };

  // ---- signals: alerting ones in Neon (their dedupe), suppressed ones in memory ----------------

  /** The filters alerts and signals share (as PgV2Store's recordWhere), on a record held in memory — the page cursor included. */
  private async recordMatches(
    f: RecordStoreFilters,
    r: { id: string; connectionId: string; strategyId: string; productId: string; triggerTimeframe: string; createdAt: string; trace?: ExprTrace },
  ): Promise<boolean> {
    const p = f.kinds?.length || f.markets?.length ? (await this.productList()).find((x) => x.id === r.productId) : undefined;
    const symbol = r.productId.split(':')[1] ?? '';
    return (
      (!f.connectionId || r.connectionId === f.connectionId) &&
      (!f.strategyId || r.strategyId === f.strategyId) &&
      (!f.strategyIds?.length || f.strategyIds.includes(r.strategyId)) &&
      (!f.kinds?.length || (!!p && f.kinds.includes(p.kind))) &&
      (!f.markets?.length || (!!p && f.markets.includes(p.market))) &&
      (!f.search?.trim() || symbol.toLowerCase().includes(f.search.trim().toLowerCase())) &&
      (!f.timeframes?.length || f.timeframes.includes(r.triggerTimeframe as never)) &&
      (!f.since || r.createdAt >= f.since) &&
      (!f.until || r.createdAt < f.until) &&
      (!f.groups?.length || (r.trace?.children ?? []).some((c) => c.result === 'TRUE' && f.groups!.includes(c.id))) &&
      (!f.before || olderThan(r.createdAt, r.id, f.before))
    );
  }

  signals = {
    insert: async (s: NewSignal) => {
      if (this.rt.alerted.has(s.identity) || this.rt.signals.some((x) => x.identity === s.identity)) return null;
      const out: V2Signal = { ...clone(s), id: s.id ?? crypto.randomUUID(), createdAt: this.iso() };
      if (s.outcome === 'ALERTED' || s.outcome === 'NO_CHANNEL') {
        // Saved (in the background) with only the top of the trace — its alert keeps the full evaluation.
        this.q.push({ op: 'signals.insert', args: [{ ...s, id: out.id, createdAt: out.createdAt, evaluation: { ...s.evaluation, trace: shallowTrace(s.evaluation.trace) } }], provides: out.id });
        this.rt.alerted.add(s.identity);
        if (this.rt.alerted.size > 20_000) for (const k of [...this.rt.alerted].slice(0, 10_000)) this.rt.alerted.delete(k);
        this.rt.seqOf.set(out.id, ++this.rt.signalSeq);
      }
      this.rt.signals.unshift(out);
      if (this.rt.signals.length > KEEP_SIGNALS) {
        // An alerting signal leaving memory: pages read before it was recorded no longer show it — read them again.
        for (const x of this.rt.signals.splice(KEEP_SIGNALS)) {
          if (!(x.outcome === 'ALERTED' || x.outcome === 'NO_CHANNEL')) continue;
          if (x.createdAt > this.rt.evictedSignalAt) this.rt.evictedSignalAt = x.createdAt;
          this.rt.evictedSignalSeq = Math.max(this.rt.evictedSignalSeq, this.rt.seqOf.get(x.id) ?? 0);
          this.rt.seqOf.delete(x.id);
        }
      }
      return clone(out);
    },
    /** A page: the stored signals (read once per filters + cursor) with this run's merged in. */
    list: async (f: SignalFilters): Promise<V2SignalItem[]> => {
      const limit = Math.min(f.limit ?? 100, 1000);
      const stored = await this.cachedList(`signals:${JSON.stringify({ ...f, limit })}`, this.rt.evictedSignalAt, () => this.db.signals.list({ ...f, limit }));
      const byId = new Map<string, V2SignalItem>();
      for (const s of this.rt.signals) {
        if ((f.outcomes?.length && !f.outcomes.includes(s.outcome)) || !(await this.recordMatches(f, { ...s, productId: s.evaluation.productId, trace: s.evaluation.trace }))) continue;
        byId.set(s.id, { ...clone(s), evaluation: stripTrace(clone(s.evaluation)) });
      }
      const identities = new Set([...byId.values()].map((x) => x.identity));
      for (const s of stored) if (!byId.has(s.id) && !identities.has(s.identity)) byId.set(s.id, s);
      return [...byId.values()].sort(byCreated).slice(0, limit);
    },
    /** Stored counts (read once per filters) + this run's signals not in them: suppressed ones, and alerting ones recorded since. */
    countByStrategy: async (f: SignalFilters): Promise<Record<string, number>> => {
      const g = { ...f, before: undefined, limit: undefined };
      const { rows, seq } = await this.cachedEntry(`signal-counts:${JSON.stringify(g)}`, '', () => this.db.signals.countByStrategy(g), { seq: () => this.rt.signalSeq, evicted: this.rt.evictedSignalSeq });
      const out = { ...rows };
      for (const s of this.rt.signals) {
        const stored = s.outcome === 'ALERTED' || s.outcome === 'NO_CHANNEL';
        if (stored && (this.rt.seqOf.get(s.id) ?? 0) <= seq) continue; // already in the stored count
        if ((f.outcomes?.length && !f.outcomes.includes(s.outcome)) || !(await this.recordMatches(g, { ...s, productId: s.evaluation.productId, trace: s.evaluation.trace }))) continue;
        out[s.strategyId] = (out[s.strategyId] ?? 0) + 1;
      }
      return out;
    },
  };

  // ---- alerts: in memory at once, saved in the background; list pages from Neon with this run's merged in ----

  /** The newest alerts for the alarm — read once, then kept up to date in memory. */
  private async feedList(): Promise<AlertFeedItem[]> {
    if (this.rt.feed) return this.rt.feed;
    const mine = () => [...this.rt.recent.values()].map(feedItem).sort(byCreated).slice(0, KEEP_FEED);
    if (this.rt.feedFailedAt !== null && this.clock() - this.rt.feedFailedAt < FEED_RETRY_MS) return mine();
    try {
      await this.once('feed', () => !!this.rt.feed, async () => {
        const rows = await this.read(() => this.db.alerts.feed(null, KEEP_FEED));
        const ids = new Set(rows.map((a) => a.id));
        this.rt.feed = [...rows, ...mine().filter((a) => !ids.has(a.id))].sort(byCreated).slice(0, KEEP_FEED);
        this.rt.feedFailedAt = null;
      });
      return this.rt.feed!;
    } catch {
      this.rt.feedFailedAt = this.clock(); // Neon unreachable: the alarm still rings for this run's alerts
      return mine();
    }
  }

  private async alertMatches(f: AlertFilters, a: V2Alert): Promise<boolean> {
    return (
      (!f.active || !a.acknowledgedAt) &&
      (!f.statuses?.length || f.statuses.includes(a.status)) &&
      (!f.sources?.length || f.sources.includes(a.evaluation.source ?? 'HISTORICAL')) &&
      (await this.recordMatches(f, { ...a, trace: a.evaluation.trace }))
    );
  }

  alerts = {
    insert: async (a: NewAlert) => {
      const out: V2Alert = { ...clone(a), id: a.id ?? crypto.randomUUID(), deliveries: [], acknowledgedAt: null, createdAt: this.iso() };
      this.q.push({ op: 'alerts.insert', args: [{ ...a, id: out.id, createdAt: out.createdAt }], provides: out.id, dependsOn: [a.signalId] });
      this.rt.recent.set(out.id, out);
      this.rt.seqOf.set(out.id, ++this.rt.alertSeq);
      if (this.rt.recent.size > KEEP_RECENT) {
        const [oldest] = this.rt.recent.values();
        this.rt.recent.delete(oldest!.id);
        // Pages read before that alert was recorded no longer show it — read them again.
        if (oldest!.createdAt > this.rt.evictedAlertAt) this.rt.evictedAlertAt = oldest!.createdAt;
        this.rt.evictedAlertSeq = Math.max(this.rt.evictedAlertSeq, this.rt.seqOf.get(oldest!.id) ?? 0);
        this.rt.seqOf.delete(oldest!.id);
      }
      if (this.rt.feed) {
        this.rt.feed.unshift(feedItem(out));
        if (this.rt.feed.length > KEEP_FEED) this.rt.feed.length = KEEP_FEED;
      }
      return clone(out);
    },
    addDelivery: async (id: string, d: Delivery) => {
      this.q.push({ op: 'alerts.addDelivery', args: [id, d], dependsOn: [id] });
      this.rt.recent.get(id)?.deliveries.push(clone(d));
    },
    setStatus: async (id: string, status: V2Alert['status']) => {
      this.q.push({ op: 'alerts.setStatus', args: [id, status], dependsOn: [id] });
      const a = this.rt.recent.get(id);
      if (a) a.status = status;
    },
    acknowledge: async (id: string, at: string) => {
      const out = await this.read(() => this.db.alerts.acknowledge(id, at));
      const a = this.rt.recent.get(id);
      if (a) {
        a.status = 'ACKNOWLEDGED';
        a.acknowledgedAt = at;
      }
      this.listsChanged(); // it leaves the active list
      return out;
    },
    /** This run's alerts from memory (in full); older ones from the database. */
    get: async (id: string) => {
      const mine = this.rt.recent.get(id);
      if (mine) return clone(mine);
      return this.read(() => this.db.alerts.get(id));
    },
    /** A page: the stored alerts (read once per filters + cursor) with this run's merged in (memory wins: deliveries, status). */
    list: async (f: AlertFilters): Promise<V2AlertItem[]> => {
      const limit = Math.min(f.limit ?? 200, 1000);
      const stored = await this.cachedList(`alerts:${JSON.stringify({ ...f, limit })}`, this.rt.evictedAlertAt, () => this.db.alerts.list({ ...f, limit }));
      const byId = new Map(stored.map((a) => [a.id, a]));
      for (const a of this.rt.recent.values()) if (await this.alertMatches(f, a)) byId.set(a.id, alertItem(a));
      return [...byId.values()].sort(byCreated).slice(0, limit);
    },
    /** Stored counts (read once per filters) + this run's alerts recorded since. */
    countByStrategy: async (f: AlertFilters): Promise<Record<string, number>> => {
      const g = { ...f, before: undefined, limit: undefined };
      const { rows, seq } = await this.cachedEntry(`alert-counts:${JSON.stringify(g)}`, '', () => this.db.alerts.countByStrategy(g), { seq: () => this.rt.alertSeq, evicted: this.rt.evictedAlertSeq });
      const out = { ...rows };
      for (const a of this.rt.recent.values()) if ((this.rt.seqOf.get(a.id) ?? 0) > seq && (await this.alertMatches(g, a))) out[a.strategyId] = (out[a.strategyId] ?? 0) + 1;
      return out;
    },
    feed: async (after: string | null, limit: number) =>
      clone(
        (await this.feedList())
          .filter((a) => !after || a.createdAt > after)
          .slice(0, Math.min(limit, 100)),
      ),
  };

  // ---- scanner cycles, lock, live status: memory -------------------------------------------------

  scanRuns = {
    insert: async (run: ScanRun) => {
      this.rt.runs.unshift(clone(run));
      if (this.rt.runs.length > KEEP_RUNS) this.rt.runs.length = KEEP_RUNS;
    },
    list: async (limit: number) => clone(this.rt.runs.slice(0, limit)),
    prune: async (before: string) => {
      this.rt.runs = this.rt.runs.filter((r) => r.startedAt >= before);
    },
  };

  locks = {
    acquire: async (name: string, leaseSeconds: number, minIntervalSeconds: number) => {
      const now = this.clock();
      const cur = this.rt.locks.get(name);
      if (cur && (cur.until > now || (cur.lastRun !== null && now - cur.lastRun < minIntervalSeconds * 1000))) return false;
      this.rt.locks.set(name, { until: now + leaseSeconds * 1000, lastRun: cur?.lastRun ?? null });
      return true;
    },
    release: async (name: string) => {
      const now = this.clock();
      this.rt.locks.set(name, { until: now, lastRun: now });
    },
  };

  live = {
    get: async () => clone(this.rt.live),
    save: async (status: LiveStatus) => {
      this.rt.live = { status: clone(status), offlineNotifiedAt: null };
    },
    markOfflineNotified: async (at: string) => {
      if (this.rt.live) this.rt.live.offlineNotifiedAt = at;
    },
  };

  contextStamp = async () => String(this.rt.stamp);

  maintenance = {
    /** Checked at most every 10 minutes (it wakes Neon). */
    size: async (): Promise<DatabaseSize> => {
      const now = this.clock();
      if (this.rt.size && now - this.rt.size.at < SIZE_FRESH_MS) return clone(this.rt.size.value);
      const value = await this.read(() => this.db.maintenance.size());
      this.rt.size = { at: now, value };
      return clone(value);
    },
    prune: async (before: string): Promise<PruneResult> => {
      const out = await this.read(() => this.db.maintenance.prune(before));
      this.rt.signals = this.rt.signals.filter((x) => x.createdAt >= before);
      this.rt.runs = this.rt.runs.filter((r) => r.startedAt >= before);
      for (const [id, a] of this.rt.recent) if (a.createdAt < before) this.rt.recent.delete(id);
      this.dropClosed((t) => !!t.exitAt && t.exitAt < before);
      this.rt.size = null;
      this.historyChanged();
      return out;
    },
  };

  // ---- paper trading -----------------------------------------------------------------------------

  /**
   * Every closed paper trade: read once, then kept in memory (a closed trade never changes) — the Paper tab
   * and its filters page through it without asking the database. Trades closed before the read wait in
   * `closedSince`. While the database can't be reached, those are what there is.
   */
  private async closedAll(): Promise<PaperTrade[]> {
    if (!this.rt.closedRead) {
      try {
        await this.once('closed', () => !!this.rt.closedRead, async () => {
          const rows = await this.read(() => this.db.paper.listTrades({ status: 'CLOSED', limit: KEEP_CLOSED }));
          const ids = new Set(rows.map((t) => t.id));
          this.rt.closedRead = [...this.rt.closedSince.filter((t) => !ids.has(t.id)), ...rows].sort(byEntry);
          this.rt.closedSince = [];
        });
      } catch (err) {
        if (!this.rt.closedSince.length) throw err;
        return this.rt.closedSince;
      }
    }
    return this.rt.closedRead!;
  }

  /** Forget closed trades (deleted with their strategy / connection, reset, the history clean-up). */
  private dropClosed(gone: (t: PaperTrade) => boolean): void {
    if (this.rt.closedRead) this.rt.closedRead = this.rt.closedRead.filter((t) => !gone(t));
    this.rt.closedSince = this.rt.closedSince.filter((t) => !gone(t));
    this.rt.closedVersion++;
  }

  private async planMap(): Promise<Map<string, PaperPlan>> {
    await this.once('plans', () => !!this.rt.plans, async () => {
      this.rt.plans = new Map((await this.read(() => this.db.paper.listPlans())).map((p) => [p.strategyId, p.plan]));
    });
    return this.rt.plans!;
  }

  private async overrideMap(): Promise<Map<string, PaperOverride>> {
    await this.once('overrides', () => !!this.rt.overrides, async () => {
      this.rt.overrides = new Map((await this.read(() => this.db.paper.listOverrides())).map((o) => [o.connectionId, o.override]));
    });
    return this.rt.overrides!;
  }

  private async openMap(): Promise<Map<string, PaperTrade>> {
    await this.once('open', () => !!this.rt.open, async () => {
      this.rt.open = new Map((await this.read(() => this.db.paper.listOpen())).map((t) => [t.id, t]));
    });
    return this.rt.open!;
  }

  paper = {
    getPlan: async (strategyId: string) => clone((await this.planMap()).get(strategyId) ?? null),
    savePlan: async (strategyId: string, plan: PaperPlan) => {
      const out = await this.read(() => this.db.paper.savePlan(strategyId, plan));
      (await this.planMap()).set(strategyId, clone(out));
      return out;
    },
    listPlans: async () => clone([...(await this.planMap())].map(([strategyId, plan]) => ({ strategyId, plan }))),
    insertTrade: async (t: NewPaperTrade) => {
      const open = await this.openMap();
      if ([...open.values()].some((x) => x.connectionId === t.connectionId && x.slot === t.slot)) return null; // one open trade per slot
      const trade: PaperTrade = { ...clone(t), id: t.id ?? crypto.randomUUID() };
      open.set(trade.id, trade);
      this.q.push({ op: 'paper.insertTrade', args: [trade], provides: trade.id, dependsOn: t.alertId ? [t.alertId] : undefined });
      return clone(trade);
    },
    openFor: async (connectionId: string, slot: string) => clone([...(await this.openMap()).values()].find((t) => t.connectionId === connectionId && t.slot === slot) ?? null),
    listOpen: async () => clone([...(await this.openMap()).values()].sort((a, b) => a.entryAt.localeCompare(b.entryAt))),
    closeTrade: async (id: string, patch: Pick<PaperTrade, 'exitAt' | 'exitPrice' | 'exitReason' | 'grossPnl' | 'charges' | 'netPnl' | 'lastPrice' | 'lastPriceAt'>) => {
      const open = await this.openMap();
      const t = open.get(id);
      if (!t) return null; // closed already
      const closed: PaperTrade = { ...t, ...clone(patch), status: 'CLOSED' };
      open.delete(id);
      this.q.push({ op: 'paper.closeTrade', args: [id, patch], dependsOn: [id] });
      const into = this.rt.closedRead ?? this.rt.closedSince;
      into.unshift(closed);
      into.sort(byEntry);
      if (into.length > KEEP_CLOSED) into.length = KEEP_CLOSED;
      this.rt.closedVersion++;
      return clone(closed);
    },
    /** Latest prices of open trades: memory only (saved with the trade when it closes). */
    updateMarks: async (marks: Array<{ id: string; lastPrice: number; at: string }>) => {
      const open = await this.openMap();
      for (const m of marks) {
        const t = open.get(m.id);
        if (t) open.set(m.id, { ...t, lastPrice: m.lastPrice, lastPriceAt: m.at });
      }
    },
    /** Open trades and every closed one from memory (closed ones read from the database once). */
    listTrades: async (f: { status?: 'OPEN' | 'CLOSED'; strategyId?: string; connectionId?: string; since?: string; limit?: number }) => {
      const limit = Math.min(f.limit ?? 1000, KEEP_CLOSED);
      const keep = (t: PaperTrade) => (!f.strategyId || t.strategyId === f.strategyId) && (!f.connectionId || t.connectionId === f.connectionId) && (!f.since || t.entryAt >= f.since);
      const open = f.status === 'CLOSED' ? [] : [...(await this.openMap()).values()].filter(keep);
      const closed = f.status === 'OPEN' ? [] : (await this.closedAll()).filter(keep);
      return clone([...open, ...closed].sort(byEntry).slice(0, limit));
    },
    getOverride: async (connectionId: string) => clone((await this.overrideMap()).get(connectionId) ?? null),
    saveOverride: async (connectionId: string, override: PaperOverride) => {
      const out = await this.read(() => this.db.paper.saveOverride(connectionId, override));
      const map = await this.overrideMap();
      if (out) map.set(connectionId, clone(out));
      else map.delete(connectionId);
      return out;
    },
    listOverrides: async () => clone([...(await this.overrideMap())].map(([connectionId, override]) => ({ connectionId, override }))),
    /** Only this process closes trades, so a counter replaces the database check. */
    closedVersion: async () => `runtime:${this.rt.closedVersion}`,
    reset: async (strategyId: string) => {
      const n = await this.read(() => this.db.paper.reset(strategyId));
      for (const [id, t] of await this.openMap()) if (t.strategyId === strategyId) this.rt.open!.delete(id);
      this.dropClosed((t) => t.strategyId === strategyId);
      return n;
    },
  };
}
