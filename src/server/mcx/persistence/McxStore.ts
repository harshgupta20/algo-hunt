/**
 * MCX V2 persistence boundary. The MCX module depends only on these
 * interfaces; PgMcxStore implements them on the mcx_* tables (migration 006)
 * and tests use an in-memory fake with the same dedupe semantics.
 */
import type {
  CalendarEntry,
  McxAlert,
  McxDelivery,
  McxInstrument,
  McxScanRun,
  McxSettings,
  McxSignal,
  McxStrategy,
  McxStrategyDefinition,
  McxStrategyVersion,
  UnitState,
} from '@/shared/mcx';

export interface AlertFilters {
  strategyId?: string;
  /** Only alerts not acknowledged yet. */
  active?: boolean;
  limit?: number;
}

export interface McxStore {
  instruments: {
    replaceAll(list: McxInstrument[]): Promise<void>;
    list(): Promise<McxInstrument[]>;
    count(): Promise<number>;
    /** When the instrument master was last synced (ISO), null if never. */
    syncedAt(): Promise<string | null>;
  };
  calendar: {
    list(): Promise<CalendarEntry[]>;
    replaceAll(entries: CalendarEntry[]): Promise<void>;
  };
  strategies: {
    list(): Promise<McxStrategy[]>;
    get(id: string): Promise<McxStrategy | null>;
    create(definition: McxStrategyDefinition): Promise<McxStrategy>;
    /** Saves a new immutable version and makes it current. */
    update(id: string, definition: McxStrategyDefinition): Promise<McxStrategy | null>;
    setEnabled(id: string, enabled: boolean, at: string): Promise<McxStrategy | null>;
    remove(id: string): Promise<boolean>;
    versions(id: string): Promise<McxStrategyVersion[]>;
  };
  units: {
    list(strategyId?: string): Promise<UnitState[]>;
    get(strategyId: string, unitKey: string): Promise<UnitState | null>;
    upsert(state: UnitState): Promise<void>;
    clear(strategyId: string): Promise<void>;
  };
  signals: {
    /** Returns null when a signal with the same identity already exists (dedupe). */
    insert(signal: Omit<McxSignal, 'id' | 'createdAt'>): Promise<McxSignal | null>;
    list(strategyId?: string, limit?: number): Promise<McxSignal[]>;
  };
  alerts: {
    insert(alert: Omit<McxAlert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'>): Promise<McxAlert>;
    addDelivery(alertId: string, delivery: McxDelivery): Promise<void>;
    setStatus(alertId: string, status: McxAlert['status']): Promise<void>;
    acknowledge(alertId: string, at: string): Promise<McxAlert | null>;
    get(id: string): Promise<McxAlert | null>;
    list(filters: AlertFilters): Promise<McxAlert[]>;
  };
  scanRuns: {
    insert(run: McxScanRun): Promise<void>;
    list(limit: number): Promise<McxScanRun[]>;
    get(id: string): Promise<McxScanRun | null>;
    /** Delete runs older than the given ISO time. */
    prune(before: string): Promise<void>;
  };
  settings: {
    get(): Promise<McxSettings>;
    save(settings: McxSettings): Promise<McxSettings>;
  };
  locks: {
    acquire(name: string, leaseSeconds: number, minIntervalSeconds: number): Promise<boolean>;
    release(name: string): Promise<void>;
  };
}
