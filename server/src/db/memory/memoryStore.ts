/**
 * In-memory DataStore. Keeps the platform fully functional with no database:
 * alert history and analytics live for the process lifetime.
 */
import { randomUUID } from 'node:crypto';
import type {
  Alert,
  AlertConfiguration,
  AlertConfigurationInput,
  AlertHistoryFilters,
  AnalyticsSummary,
  StrategyDef,
  StrategyDefInput,
  StrategyStatus,
  StrategyVersion,
  UnderlyingGroup,
  UnderlyingGroupInput,
  UserPreferences,
} from '@ash/shared';
import { DEFAULT_USER_PREFERENCES } from '@ash/shared';
import type {
  AlertRepository,
  ConfigRepository,
  DataStore,
  GroupRepository,
  NotificationLogRepository,
  PreferencesRepository,
  StrategyRepository,
} from '../store.js';
import {
  BUILTIN_INDICES_GROUP_ID,
  applyAlertFilters,
  buildConfiguration,
  buildGroup,
  buildStrategy,
  indicesGroup,
  summarize,
} from '../store.js';
import type { NewAlert, NewNotificationLog, NotificationLog } from '../types.js';

class MemoryAlertRepository implements AlertRepository {
  private readonly alerts: Alert[] = [];
  private readonly dedupe = new Set<string>();

  async insert(alert: NewAlert): Promise<Alert | null> {
    const key = `${alert.configId}|${alert.bucket}|${alert.scenario}`;
    if (this.dedupe.has(key)) return null;
    this.dedupe.add(key);
    const full: Alert = { ...alert, id: randomUUID() };
    this.alerts.push(full);
    return full;
  }

  async getById(id: string): Promise<Alert | null> {
    return this.alerts.find((a) => a.id === id) ?? null;
  }

  async list(filters: AlertHistoryFilters): Promise<Alert[]> {
    return applyAlertFilters(this.alerts, filters);
  }

  async analytics(): Promise<AnalyticsSummary> {
    return summarize(this.alerts);
  }
}

class MemoryConfigRepository implements ConfigRepository {
  private readonly configs = new Map<string, AlertConfiguration>();

  async create(input: AlertConfigurationInput): Promise<AlertConfiguration> {
    const cfg = buildConfiguration(input);
    this.configs.set(cfg.id, cfg);
    return cfg;
  }

  async update(id: string, patch: Partial<AlertConfigurationInput>): Promise<AlertConfiguration | null> {
    const cfg = this.configs.get(id);
    if (!cfg) return null;
    const updated: AlertConfiguration = {
      ...cfg,
      ...patch,
      params: { ...cfg.params, ...patch.params },
      updatedAt: new Date().toISOString(),
    };
    this.configs.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.configs.delete(id);
  }

  async getById(id: string): Promise<AlertConfiguration | null> {
    return this.configs.get(id) ?? null;
  }

  async list(): Promise<AlertConfiguration[]> {
    return [...this.configs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listActive(): Promise<AlertConfiguration[]> {
    return [...this.configs.values()].filter((c) => c.active);
  }

  async setActive(id: string, active: boolean, expiryDate?: string): Promise<AlertConfiguration | null> {
    const cfg = this.configs.get(id);
    if (!cfg) return null;
    const updated: AlertConfiguration = {
      ...cfg,
      active,
      expiryDate: expiryDate ?? cfg.expiryDate,
      updatedAt: new Date().toISOString(),
    };
    this.configs.set(id, updated);
    return updated;
  }
}

class MemoryNotificationLogRepository implements NotificationLogRepository {
  private readonly logs: NotificationLog[] = [];

  async insert(log: NewNotificationLog): Promise<NotificationLog> {
    const full: NotificationLog = { ...log, id: randomUUID(), sentAt: new Date().toISOString() };
    this.logs.unshift(full);
    return full;
  }

  async list(limit = 100): Promise<NotificationLog[]> {
    return this.logs.slice(0, limit);
  }
}

class MemoryPreferencesRepository implements PreferencesRepository {
  private prefs: UserPreferences = { ...DEFAULT_USER_PREFERENCES };

  async get(): Promise<UserPreferences> {
    return this.prefs;
  }

  async save(prefs: UserPreferences): Promise<UserPreferences> {
    this.prefs = prefs;
    return this.prefs;
  }
}

class MemoryStrategyRepository implements StrategyRepository {
  private readonly strategies = new Map<string, StrategyDef>();
  private readonly history = new Map<string, StrategyVersion[]>();

  private snapshot(def: StrategyDef): void {
    const arr = this.history.get(def.id) ?? [];
    arr.push({ version: def.version, createdAt: def.updatedAt, def });
    this.history.set(def.id, arr);
  }

  async create(input: StrategyDefInput): Promise<StrategyDef> {
    const def = buildStrategy(input);
    this.strategies.set(def.id, def);
    this.snapshot(def);
    return def;
  }

  async update(id: string, patch: Partial<StrategyDefInput>): Promise<StrategyDef | null> {
    const cur = this.strategies.get(id);
    if (!cur) return null;
    const updated: StrategyDef = {
      ...cur,
      ...patch,
      root: patch.root ?? cur.root,
      version: cur.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.strategies.set(id, updated);
    this.snapshot(updated);
    return updated;
  }

  async get(id: string): Promise<StrategyDef | null> {
    return this.strategies.get(id) ?? null;
  }

  async list(): Promise<StrategyDef[]> {
    return [...this.strategies.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<boolean> {
    this.history.delete(id);
    return this.strategies.delete(id);
  }

  async setStatus(id: string, status: StrategyStatus): Promise<StrategyDef | null> {
    const cur = this.strategies.get(id);
    if (!cur) return null;
    const updated = { ...cur, status, updatedAt: new Date().toISOString() };
    this.strategies.set(id, updated);
    return updated;
  }

  async duplicate(id: string): Promise<StrategyDef | null> {
    const cur = this.strategies.get(id);
    if (!cur) return null;
    const copy = buildStrategy({ ...cur, name: `${cur.name} (copy)`, status: 'draft' });
    this.strategies.set(copy.id, copy);
    this.snapshot(copy);
    return copy;
  }

  async versions(id: string): Promise<StrategyVersion[]> {
    return [...(this.history.get(id) ?? [])].sort((a, b) => b.version - a.version);
  }
}

class MemoryGroupRepository implements GroupRepository {
  private readonly groups = new Map<string, UnderlyingGroup>();

  async create(input: UnderlyingGroupInput): Promise<UnderlyingGroup> {
    const g = buildGroup(input);
    this.groups.set(g.id, g);
    return g;
  }

  async update(id: string, patch: Partial<UnderlyingGroupInput>): Promise<UnderlyingGroup | null> {
    const cur = this.groups.get(id);
    if (!cur) return null;
    const updated: UnderlyingGroup = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.groups.set(id, updated);
    return updated;
  }

  async get(id: string): Promise<UnderlyingGroup | null> {
    if (id === BUILTIN_INDICES_GROUP_ID) return indicesGroup();
    return this.groups.get(id) ?? null;
  }

  async list(): Promise<UnderlyingGroup[]> {
    return [indicesGroup(), ...[...this.groups.values()].sort((a, b) => a.name.localeCompare(b.name))];
  }

  async delete(id: string): Promise<boolean> {
    return this.groups.delete(id);
  }
}

export class MemoryDataStore implements DataStore {
  readonly kind = 'memory' as const;
  readonly alerts = new MemoryAlertRepository();
  readonly configs = new MemoryConfigRepository();
  readonly notifications = new MemoryNotificationLogRepository();
  readonly preferences = new MemoryPreferencesRepository();
  readonly strategies = new MemoryStrategyRepository();
  readonly groups = new MemoryGroupRepository();

  async init(): Promise<void> {
    /* nothing to initialize */
  }

  async close(): Promise<void> {
    /* nothing to close */
  }
}
