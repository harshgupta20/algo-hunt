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
 *                      paper history when you open it
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
import { offersKinds } from '@/shared/v2';
import type { AlertFilters, ProductFilters, RecordStoreFilters, SignalFilters, V2Store } from './V2Store';

const KEEP_SIGNALS = 1_000;
const KEEP_RUNS = 200;
const KEEP_FEED = 200;

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
}

const g = globalThis as unknown as { __ashRuntimeState?: RuntimeState };

/** Fresh, empty state (tests use their own). */
export function createRuntimeState(): RuntimeState {
  return { instruments: new Map(), closedVersion: 0, unitSaved: new Map(), signals: [], runs: [], live: null, locks: new Map(), stamp: 0, loading: new Map() };
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

export class RuntimeV2Store implements V2Store {
  constructor(
    private readonly db: V2Store,
    private readonly clock: () => number = Date.now,
    private readonly rt: RuntimeState = runtimeState(),
  ) {}

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
      this.rt.products = await this.db.products.list({ limit: 5000 });
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
      await this.db.instruments.replaceAll(list, products);
      this.rt.instruments.clear();
      this.rt.products = undefined;
      this.rt.instrumentCount = list.length;
      this.rt.syncedAt = undefined; // re-read once (the database's own sync time)
      this.changed();
    },
    forProduct: async (productId: string) => {
      const hit = this.rt.instruments.get(productId);
      if (hit) return hit;
      const list = await this.db.instruments.forProduct(productId);
      this.rt.instruments.set(productId, list);
      return list;
    },
    count: async () => {
      await this.once('instrumentCount', () => this.rt.instrumentCount !== undefined, async () => {
        this.rt.instrumentCount = await this.db.instruments.count();
      });
      return this.rt.instrumentCount!;
    },
    syncedAt: async () => {
      await this.once('syncedAt', () => this.rt.syncedAt !== undefined, async () => {
        this.rt.syncedAt = await this.db.instruments.syncedAt();
      });
      return this.rt.syncedAt ?? null;
    },
  };

  products = {
    list: async (f: ProductFilters = {}) =>
      clone(
        (await this.productList())
          .filter((p) => this.productMatches(p, f))
          .sort((a, b) => PRODUCT_ORDER[a.kind] - PRODUCT_ORDER[b.kind] || Number(b.hasOptions) - Number(a.hasOptions) || a.symbol.localeCompare(b.symbol))
          .slice(0, Math.min(f.limit ?? 5000, 5000)),
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
        this.rt.calendar = await this.db.calendar.list();
      });
      return clone(this.rt.calendar!);
    },
    replaceAll: async (entries: CalendarEntry[]) => {
      await this.db.calendar.replaceAll(entries);
      this.rt.calendar = clone(entries);
      this.changed();
    },
  };

  settings = {
    get: async () => {
      await this.once('settings', () => !!this.rt.settings, async () => {
        this.rt.settings = await this.db.settings.get();
      });
      return clone(this.rt.settings!);
    },
    save: async (s: V2Settings) => {
      const out = await this.db.settings.save(s);
      this.rt.settings = clone(out);
      this.changed();
      return out;
    },
  };

  // ---- strategies / connections ----------------------------------------------------------------

  private async strategyMap(): Promise<Map<string, V2Strategy>> {
    await this.once('strategies', () => !!this.rt.strategies, async () => {
      this.rt.strategies = new Map((await this.db.strategies.list()).map((s) => [s.id, s]));
    });
    return this.rt.strategies!;
  }

  private async connectionMap(): Promise<Map<string, V2Connection>> {
    await this.once('connections', () => !!this.rt.connections, async () => {
      this.rt.connections = new Map((await this.db.connections.list()).map((c) => [c.id, c]));
    });
    return this.rt.connections!;
  }

  strategies = {
    list: async () => clone([...(await this.strategyMap()).values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
    count: async () => (await this.strategyMap()).size,
    get: async (id: string) => clone((await this.strategyMap()).get(id) ?? null),
    create: async (definition: StrategyDefinition) => {
      const s = await this.db.strategies.create(definition);
      (await this.strategyMap()).set(s.id, s);
      this.changed();
      return clone(s);
    },
    update: async (id: string, definition: StrategyDefinition) => {
      const s = await this.db.strategies.update(id, definition);
      if (s) (await this.strategyMap()).set(s.id, s);
      this.changed();
      return clone(s);
    },
    remove: async (id: string) => {
      const ok = await this.db.strategies.remove(id);
      (await this.strategyMap()).delete(id);
      // The database removes its connections, alerts, paper plan and trades with it.
      const conns = await this.connectionMap();
      for (const [cid, c] of conns) if (c.strategyId === id) conns.delete(cid);
      this.rt.plans?.delete(id);
      for (const [tid, t] of this.rt.open ?? []) if (t.strategyId === id) this.rt.open!.delete(tid);
      this.rt.closedVersion++;
      this.rt.feed = undefined;
      this.changed();
      return ok;
    },
    versions: (id: string) => this.db.strategies.versions(id),
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
      const c = await this.db.connections.create(strategyId, productId, config);
      (await this.connectionMap()).set(c.id, c);
      this.changed();
      return clone(c);
    },
    update: async (id: string, config: ConnectionConfig) => {
      const c = await this.db.connections.update(id, config);
      if (c) (await this.connectionMap()).set(c.id, c);
      this.changed();
      return clone(c);
    },
    setEnabled: async (id: string, enabled: boolean, at: string) => {
      const c = await this.db.connections.setEnabled(id, enabled, at);
      if (c) (await this.connectionMap()).set(c.id, c);
      this.changed();
      return clone(c);
    },
    setEnabledMany: async (ids: string[], enabled: boolean, at: string) => {
      const n = await this.db.connections.setEnabledMany(ids, enabled, at);
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
      const ok = await this.db.connections.remove(id);
      (await this.connectionMap()).delete(id);
      for (const k of [...(this.rt.units?.keys() ?? [])]) if (k.startsWith(`${id}|`)) this.rt.units!.delete(k);
      this.rt.overrides?.delete(id);
      for (const [tid, t] of this.rt.open ?? []) if (t.connectionId === id) this.rt.open!.delete(tid);
      this.rt.closedVersion++;
      this.rt.feed = undefined;
      this.changed();
      return ok;
    },
  };

  // ---- unit states: memory; saved when an alert decision changes them ---------------------------

  private async unitMap(): Promise<Map<string, UnitState>> {
    await this.once('units', () => !!this.rt.units, async () => {
      const conns = [...(await this.connectionMap()).keys()];
      const list = conns.length ? await this.db.units.listFor(conns) : [];
      this.rt.units = new Map(list.map((u) => [unitKey(u.connectionId, u.unitKey), u]));
      for (const u of list) this.rt.unitSaved.set(unitKey(u.connectionId, u.unitKey), decisionSig(u));
    });
    return this.rt.units!;
  }

  units = {
    list: async (connectionId: string) =>
      clone([...(await this.unitMap()).values()].filter((u) => u.connectionId === connectionId).sort((a, b) => a.unitKey.localeCompare(b.unitKey))),
    listFor: async (connectionIds: string[]) => {
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
      if (save.length) await this.db.units.upsertMany(save);
    },
    clear: async (connectionId: string) => {
      await this.db.units.clear(connectionId);
      for (const k of [...(await this.unitMap()).keys()]) if (k.startsWith(`${connectionId}|`)) (this.rt.units!.delete(k), this.rt.unitSaved.delete(k));
    },
    clearMany: async (connectionIds: string[]) => {
      if (!connectionIds.length) return;
      await this.db.units.clearMany(connectionIds);
      const ids = new Set(connectionIds);
      for (const [k, u] of await this.unitMap()) if (ids.has(u.connectionId)) (this.rt.units!.delete(k), this.rt.unitSaved.delete(k));
    },
    disableMany: async (connectionIds: string[]) => {
      if (!connectionIds.length) return;
      await this.db.units.disableMany(connectionIds);
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

  /** The filters alerts and signals share, on a signal held in memory. */
  private async signalMatches(f: RecordStoreFilters, s: V2Signal): Promise<boolean> {
    const productId = s.evaluation.productId;
    const p = f.kinds?.length || f.markets?.length ? (await this.productList()).find((x) => x.id === productId) : undefined;
    const symbol = productId.split(':')[1] ?? '';
    return (
      (!f.connectionId || s.connectionId === f.connectionId) &&
      (!f.strategyId || s.strategyId === f.strategyId) &&
      (!f.kinds?.length || (!!p && f.kinds.includes(p.kind))) &&
      (!f.markets?.length || (!!p && f.markets.includes(p.market))) &&
      (!f.search?.trim() || symbol.toLowerCase().includes(f.search.trim().toLowerCase())) &&
      (!f.timeframes?.length || f.timeframes.includes(s.triggerTimeframe)) &&
      (!f.since || s.createdAt >= f.since) &&
      (!f.until || s.createdAt < f.until) &&
      (!f.groups?.length || (s.evaluation.trace?.children ?? []).some((c) => c.result === 'TRUE' && f.groups!.includes(c.id)))
    );
  }

  signals = {
    insert: async (s: Omit<V2Signal, 'id' | 'createdAt'>) => {
      let out: V2Signal | null;
      if (s.outcome === 'ALERTED' || s.outcome === 'NO_CHANNEL') {
        // Stored with only the top of the trace — its alert keeps the full evaluation.
        const saved = await this.db.signals.insert({ ...s, evaluation: { ...s.evaluation, trace: shallowTrace(s.evaluation.trace) } });
        out = saved ? { ...saved, evaluation: s.evaluation } : null;
      } else {
        if (this.rt.signals.some((x) => x.identity === s.identity)) return null;
        out = { ...clone(s), id: crypto.randomUUID(), createdAt: this.iso() };
      }
      if (out) {
        this.rt.signals.unshift(out);
        if (this.rt.signals.length > KEEP_SIGNALS) this.rt.signals.length = KEEP_SIGNALS;
      }
      return clone(out);
    },
    list: async (f: SignalFilters): Promise<V2SignalItem[]> => {
      const limit = Math.min(f.limit ?? 100, 1000);
      const stored = await this.db.signals.list({ ...f, limit });
      const recent: V2SignalItem[] = [];
      for (const s of this.rt.signals) if ((!f.outcomes?.length || f.outcomes.includes(s.outcome)) && (await this.signalMatches(f, s))) recent.push({ ...s, evaluation: stripTrace(s.evaluation) });
      const byId = new Map<string, V2SignalItem>();
      for (const s of [...recent, ...stored]) if (!byId.has(s.id) && ![...byId.values()].some((x) => x.identity === s.identity)) byId.set(s.id, s);
      return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    },
  };

  // ---- alerts: Neon; the new-alert feed from memory ---------------------------------------------

  private async feedList(): Promise<AlertFeedItem[]> {
    await this.once('feed', () => !!this.rt.feed, async () => {
      this.rt.feed = await this.db.alerts.feed(null, KEEP_FEED);
    });
    return this.rt.feed!;
  }

  alerts = {
    insert: async (a: Omit<V2Alert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'>) => {
      const out = await this.db.alerts.insert(a);
      const feed = await this.feedList();
      feed.unshift({ id: out.id, strategyName: out.strategyName, productId: out.productId, unit: out.unit, createdAt: out.createdAt });
      if (feed.length > KEEP_FEED) feed.length = KEEP_FEED;
      return out;
    },
    addDelivery: (id: string, d: Delivery) => this.db.alerts.addDelivery(id, d),
    setStatus: (id: string, status: V2Alert['status']) => this.db.alerts.setStatus(id, status),
    acknowledge: (id: string, at: string) => this.db.alerts.acknowledge(id, at),
    get: (id: string) => this.db.alerts.get(id),
    list: (f: AlertFilters): Promise<V2AlertItem[]> => this.db.alerts.list(f),
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

  // ---- paper trading -----------------------------------------------------------------------------

  private async planMap(): Promise<Map<string, PaperPlan>> {
    await this.once('plans', () => !!this.rt.plans, async () => {
      this.rt.plans = new Map((await this.db.paper.listPlans()).map((p) => [p.strategyId, p.plan]));
    });
    return this.rt.plans!;
  }

  private async overrideMap(): Promise<Map<string, PaperOverride>> {
    await this.once('overrides', () => !!this.rt.overrides, async () => {
      this.rt.overrides = new Map((await this.db.paper.listOverrides()).map((o) => [o.connectionId, o.override]));
    });
    return this.rt.overrides!;
  }

  private async openMap(): Promise<Map<string, PaperTrade>> {
    await this.once('open', () => !!this.rt.open, async () => {
      this.rt.open = new Map((await this.db.paper.listOpen()).map((t) => [t.id, t]));
    });
    return this.rt.open!;
  }

  paper = {
    getPlan: async (strategyId: string) => clone((await this.planMap()).get(strategyId) ?? null),
    savePlan: async (strategyId: string, plan: PaperPlan) => {
      const out = await this.db.paper.savePlan(strategyId, plan);
      (await this.planMap()).set(strategyId, clone(out));
      return out;
    },
    listPlans: async () => clone([...(await this.planMap())].map(([strategyId, plan]) => ({ strategyId, plan }))),
    insertTrade: async (t: Omit<PaperTrade, 'id'>) => {
      const out = await this.db.paper.insertTrade(t);
      if (out) (await this.openMap()).set(out.id, clone(out));
      return out;
    },
    openFor: async (connectionId: string, slot: string) => clone([...(await this.openMap()).values()].find((t) => t.connectionId === connectionId && t.slot === slot) ?? null),
    listOpen: async () => clone([...(await this.openMap()).values()].sort((a, b) => a.entryAt.localeCompare(b.entryAt))),
    closeTrade: async (id: string, patch: Pick<PaperTrade, 'exitAt' | 'exitPrice' | 'exitReason' | 'grossPnl' | 'charges' | 'netPnl' | 'lastPrice' | 'lastPriceAt'>) => {
      const out = await this.db.paper.closeTrade(id, patch);
      (await this.openMap()).delete(id);
      this.rt.closedVersion++;
      return out;
    },
    /** Latest prices of open trades: memory only (saved with the trade when it closes). */
    updateMarks: async (marks: Array<{ id: string; lastPrice: number; at: string }>) => {
      const open = await this.openMap();
      for (const m of marks) {
        const t = open.get(m.id);
        if (t) open.set(m.id, { ...t, lastPrice: m.lastPrice, lastPriceAt: m.at });
      }
    },
    listTrades: async (f: { status?: 'OPEN' | 'CLOSED'; strategyId?: string; connectionId?: string; since?: string; limit?: number }) => {
      const limit = Math.min(f.limit ?? 1000, 50_000);
      const keep = (t: PaperTrade) => (!f.strategyId || t.strategyId === f.strategyId) && (!f.connectionId || t.connectionId === f.connectionId) && (!f.since || t.entryAt >= f.since);
      const open = [...(await this.openMap()).values()].filter(keep);
      if (f.status === 'OPEN') return clone(open.sort((a, b) => b.entryAt.localeCompare(a.entryAt)).slice(0, limit));
      const closed = await this.db.paper.listTrades({ ...f, status: 'CLOSED', limit });
      if (f.status === 'CLOSED') return closed;
      return [...clone(open), ...closed].sort((a, b) => b.entryAt.localeCompare(a.entryAt)).slice(0, limit);
    },
    getOverride: async (connectionId: string) => clone((await this.overrideMap()).get(connectionId) ?? null),
    saveOverride: async (connectionId: string, override: PaperOverride) => {
      const out = await this.db.paper.saveOverride(connectionId, override);
      const map = await this.overrideMap();
      if (out) map.set(connectionId, clone(out));
      else map.delete(connectionId);
      return out;
    },
    listOverrides: async () => clone([...(await this.overrideMap())].map(([connectionId, override]) => ({ connectionId, override }))),
    /** Only this process closes trades, so a counter replaces the database check. */
    closedVersion: async () => `runtime:${this.rt.closedVersion}`,
    reset: async (strategyId: string) => {
      const n = await this.db.paper.reset(strategyId);
      for (const [id, t] of await this.openMap()) if (t.strategyId === strategyId) this.rt.open!.delete(id);
      this.rt.closedVersion++;
      return n;
    },
  };
}
