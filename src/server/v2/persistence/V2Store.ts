/**
 * V2 persistence boundary. The V2 module depends only on these interfaces;
 * PgV2Store implements them on the v2_* tables (migration 007) and tests use
 * an in-memory fake with the same dedupe semantics.
 */
import type {
  AlertFeedItem,
  AlertStatus,
  CalendarEntry,
  ConnectionConfig,
  EvaluationSource,
  Market,
  SignalOutcome,
  Timeframe,
  LegKind,
  LiveStatus,
  PaperOverride,
  PaperPlan,
  PaperTrade,
  ProductKind,
  Delivery,
  ScanRun,
  StrategyDefinition,
  UnitState,
  V2Alert,
  V2AlertItem,
  V2SignalItem,
  V2Connection,
  V2Instrument,
  V2Product,
  V2Settings,
  V2Signal,
  V2Strategy,
  V2StrategyVersion,
  PendingWrites,
} from '@/shared/v2';

/** Filters shared by alerts and signals (times as ISO instants; `groups` = ids of the top-level groups that fired). */
export interface RecordStoreFilters {
  connectionId?: string;
  strategyId?: string;
  kinds?: ProductKind[];
  markets?: Market[];
  search?: string;
  timeframes?: Timeframe[];
  since?: string;
  until?: string;
  groups?: string[];
  limit?: number;
}

export interface AlertFilters extends RecordStoreFilters {
  active?: boolean;
  statuses?: AlertStatus[];
  sources?: EvaluationSource[];
}

export interface SignalFilters extends RecordStoreFilters {
  outcomes?: SignalOutcome[];
}

/** A new signal / alert / paper trade. The memory layer passes its own id and time (the record exists before it's saved). */
export type NewSignal = Omit<V2Signal, 'id' | 'createdAt'> & { id?: string; createdAt?: string };
export type NewAlert = Omit<V2Alert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'> & { id?: string; createdAt?: string };
export type NewPaperTrade = Omit<PaperTrade, 'id'> & { id?: string };

/** What a history clean-up removed. */
export interface PruneResult {
  alerts: number;
  signals: number;
  paperTrades: number;
  scanRuns: number;
}

/** How big the database is (`limitBytes` = the plan's storage, when known — Neon free: 0.5 GB). */
export interface DatabaseSize {
  engine: 'postgres' | 'memory';
  bytes: number | null;
  limitBytes: number | null;
  /** Largest tables first. */
  tables: Array<{ name: string; bytes: number }>;
}

export interface ProductFilters {
  search?: string;
  kind?: string;
  market?: string;
  ids?: string[];
  /** Only products offering every one of these legs (what a strategy needs). */
  needs?: LegKind[];
  limit?: number;
}

export interface V2Store {
  instruments: {
    replaceAll(list: V2Instrument[], products: V2Product[]): Promise<void>;
    forProduct(productId: string): Promise<V2Instrument[]>;
    count(): Promise<number>;
    syncedAt(): Promise<string | null>;
  };
  products: {
    list(f?: ProductFilters): Promise<V2Product[]>;
    get(id: string): Promise<V2Product | null>;
    count(): Promise<number>;
    /** Products per type matching the search / market (for filter counts). */
    countByKind(f?: Pick<ProductFilters, 'search' | 'market' | 'needs'>): Promise<Record<ProductKind, number>>;
  };
  calendar: {
    list(): Promise<CalendarEntry[]>;
    replaceAll(entries: CalendarEntry[]): Promise<void>;
  };
  strategies: {
    list(): Promise<V2Strategy[]>;
    count(): Promise<number>;
    get(id: string): Promise<V2Strategy | null>;
    create(definition: StrategyDefinition): Promise<V2Strategy>;
    /** Saves a new immutable version and makes it current. */
    update(id: string, definition: StrategyDefinition): Promise<V2Strategy | null>;
    remove(id: string): Promise<boolean>;
    versions(id: string): Promise<V2StrategyVersion[]>;
  };
  connections: {
    list(strategyId?: string): Promise<V2Connection[]>;
    counts(): Promise<{ total: number; enabled: number }>;
    get(id: string): Promise<V2Connection | null>;
    create(strategyId: string, productId: string, config: ConnectionConfig): Promise<V2Connection>;
    update(id: string, config: ConnectionConfig): Promise<V2Connection | null>;
    setEnabled(id: string, enabled: boolean, at: string): Promise<V2Connection | null>;
    /** Switch several connections at once; returns how many changed. */
    setEnabledMany(ids: string[], enabled: boolean, at: string): Promise<number>;
    remove(id: string): Promise<boolean>;
  };
  units: {
    list(connectionId: string): Promise<UnitState[]>;
    /** Unit states of several connections in one query (live worker, per trigger candle). */
    listFor(connectionIds: string[]): Promise<UnitState[]>;
    get(connectionId: string, unitKey: string): Promise<UnitState | null>;
    upsert(state: UnitState): Promise<void>;
    /** Batched upsert (one statement). */
    upsertMany(states: UnitState[]): Promise<void>;
    clear(connectionId: string): Promise<void>;
    clearMany(connectionIds: string[]): Promise<void>;
    /** Mark every unit of these connections DISABLED (switched off). */
    disableMany(connectionIds: string[]): Promise<void>;
  };
  signals: {
    /** Returns null when a signal with the same identity already exists (dedupe). */
    insert(signal: NewSignal): Promise<V2Signal | null>;
    list(f: SignalFilters): Promise<V2SignalItem[]>;
  };
  alerts: {
    insert(alert: NewAlert): Promise<V2Alert>;
    addDelivery(alertId: string, delivery: Delivery): Promise<void>;
    setStatus(alertId: string, status: V2Alert['status']): Promise<void>;
    acknowledge(alertId: string, at: string): Promise<V2Alert | null>;
    get(id: string): Promise<V2Alert | null>;
    /** Newest first, without the condition traces (fetch one alert for its trace). */
    list(filters: AlertFilters): Promise<V2AlertItem[]>;
    /** Alerts recorded after `after` (ISO), newest first — tiny rows for the new-alert alarm. */
    feed(after: string | null, limit: number): Promise<AlertFeedItem[]>;
  };
  scanRuns: {
    insert(run: ScanRun): Promise<void>;
    list(limit: number): Promise<ScanRun[]>;
    prune(before: string): Promise<void>;
  };
  settings: {
    get(): Promise<V2Settings>;
    save(settings: V2Settings): Promise<V2Settings>;
  };
  locks: {
    acquire(name: string, leaseSeconds: number, minIntervalSeconds: number): Promise<boolean>;
    release(name: string): Promise<void>;
  };
  /** Paper trading: a plan per strategy + the simulated trades its alerts open. */
  paper: {
    getPlan(strategyId: string): Promise<PaperPlan | null>;
    savePlan(strategyId: string, plan: PaperPlan): Promise<PaperPlan>;
    listPlans(): Promise<Array<{ strategyId: string; plan: PaperPlan }>>;
    /** Null when the slot already has an open trade. */
    insertTrade(t: NewPaperTrade): Promise<PaperTrade | null>;
    openFor(connectionId: string, slot: string): Promise<PaperTrade | null>;
    listOpen(): Promise<PaperTrade[]>;
    /** Close a trade that is still open; null when it was already closed (another process got there first). */
    closeTrade(id: string, patch: Pick<PaperTrade, 'exitAt' | 'exitPrice' | 'exitReason' | 'grossPnl' | 'charges' | 'netPnl' | 'lastPrice' | 'lastPriceAt'>): Promise<PaperTrade | null>;
    updateMarks(marks: Array<{ id: string; lastPrice: number; at: string }>): Promise<void>;
    /** Newest first; `since` = entered at or after (ISO). */
    listTrades(f: { status?: 'OPEN' | 'CLOSED'; strategyId?: string; connectionId?: string; since?: string; limit?: number }): Promise<PaperTrade[]>;
    /** A connection's own values over its strategy's plan (null = none). */
    getOverride(connectionId: string): Promise<PaperOverride | null>;
    /** Save a connection's own values; an empty override removes them. */
    saveOverride(connectionId: string, override: PaperOverride): Promise<PaperOverride | null>;
    listOverrides(): Promise<Array<{ connectionId: string; override: PaperOverride }>>;
    /** Changes whenever a trade closes or trades are deleted (count + last update) — to reuse closed trades already read. */
    closedVersion(): Promise<string>;
    /** Delete a strategy's paper trades (start over). */
    reset(strategyId: string): Promise<number>;
  };
  /** One short value that changes when connections, strategies, settings, the calendar or products change (to skip reloading them). */
  contextStamp(): Promise<string>;

  /** Housekeeping: database size, and removing history older than the trader chose to keep. */
  maintenance: {
    size(): Promise<DatabaseSize>;
    /** Delete alerts (+ deliveries), signals and closed paper trades created before `before` (ISO), and scanner cycles. Open trades are kept. */
    prune(before: string): Promise<PruneResult>;
  };

  /** Records waiting to be saved (memory layer only — the others save before returning). */
  pendingWrites?(): PendingWrites;

  /** Live worker heartbeat / status (single row). */
  live: {
    get(): Promise<{ status: LiveStatus; offlineNotifiedAt: string | null } | null>;
    save(status: LiveStatus): Promise<void>;
    markOfflineNotified(at: string): Promise<void>;
  };
}
