/**
 * V2 persistence boundary. The V2 module depends only on these interfaces;
 * PgV2Store implements them on the v2_* tables (migration 007) and tests use
 * an in-memory fake with the same dedupe semantics.
 */
import type {
  CalendarEntry,
  ConnectionConfig,
  Delivery,
  ScanRun,
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
} from '@/shared/v2';

export interface AlertFilters {
  connectionId?: string;
  strategyId?: string;
  active?: boolean;
  limit?: number;
}

export interface ProductFilters {
  search?: string;
  kind?: string;
  market?: string;
  ids?: string[];
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
  };
  calendar: {
    list(): Promise<CalendarEntry[]>;
    replaceAll(entries: CalendarEntry[]): Promise<void>;
  };
  strategies: {
    list(): Promise<V2Strategy[]>;
    get(id: string): Promise<V2Strategy | null>;
    create(definition: StrategyDefinition): Promise<V2Strategy>;
    /** Saves a new immutable version and makes it current. */
    update(id: string, definition: StrategyDefinition): Promise<V2Strategy | null>;
    remove(id: string): Promise<boolean>;
    versions(id: string): Promise<V2StrategyVersion[]>;
  };
  connections: {
    list(strategyId?: string): Promise<V2Connection[]>;
    get(id: string): Promise<V2Connection | null>;
    create(strategyId: string, productId: string, config: ConnectionConfig): Promise<V2Connection>;
    update(id: string, config: ConnectionConfig): Promise<V2Connection | null>;
    setEnabled(id: string, enabled: boolean, at: string): Promise<V2Connection | null>;
    remove(id: string): Promise<boolean>;
  };
  units: {
    list(connectionId: string): Promise<UnitState[]>;
    get(connectionId: string, unitKey: string): Promise<UnitState | null>;
    upsert(state: UnitState): Promise<void>;
    clear(connectionId: string): Promise<void>;
  };
  signals: {
    /** Returns null when a signal with the same identity already exists (dedupe). */
    insert(signal: Omit<V2Signal, 'id' | 'createdAt'>): Promise<V2Signal | null>;
    list(f: { connectionId?: string; strategyId?: string; limit?: number }): Promise<V2Signal[]>;
  };
  alerts: {
    insert(alert: Omit<V2Alert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'>): Promise<V2Alert>;
    addDelivery(alertId: string, delivery: Delivery): Promise<void>;
    setStatus(alertId: string, status: V2Alert['status']): Promise<void>;
    acknowledge(alertId: string, at: string): Promise<V2Alert | null>;
    get(id: string): Promise<V2Alert | null>;
    list(filters: AlertFilters): Promise<V2Alert[]>;
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
}
