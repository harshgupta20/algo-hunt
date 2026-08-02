/**
 * Persistence abstraction. The rest of the app depends on these repository
 * interfaces, never on a concrete database. A Postgres-backed store is used
 * when DATABASE_URL is set; otherwise an in-memory store keeps the platform
 * fully runnable (history/analytics simply reset on restart).
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
  StrategyStats,
  StrategyStatus,
  StrategyVersion,
  UserPreferences,
} from '@ash/shared';
import { DEFAULT_RSI_SYNC_PARAMS } from '@ash/shared';
import type { NewAlert, NewNotificationLog, NotificationLog } from './types.js';

export interface AlertRepository {
  /** Insert an alert. Returns null if an alert for the same
   *  (config, bucket, scenario) already exists (dedupe). */
  insert(alert: NewAlert): Promise<Alert | null>;
  getById(id: string): Promise<Alert | null>;
  list(filters: AlertHistoryFilters): Promise<Alert[]>;
  analytics(): Promise<AnalyticsSummary>;
}

export interface ConfigRepository {
  create(input: AlertConfigurationInput): Promise<AlertConfiguration>;
  update(id: string, patch: Partial<AlertConfigurationInput>): Promise<AlertConfiguration | null>;
  delete(id: string): Promise<boolean>;
  getById(id: string): Promise<AlertConfiguration | null>;
  list(): Promise<AlertConfiguration[]>;
  listActive(): Promise<AlertConfiguration[]>;
  setActive(id: string, active: boolean, expiryDate?: string): Promise<AlertConfiguration | null>;
}

export interface NotificationLogRepository {
  insert(log: NewNotificationLog): Promise<NotificationLog>;
  list(limit?: number): Promise<NotificationLog[]>;
}

export interface PreferencesRepository {
  get(): Promise<UserPreferences>;
  save(prefs: UserPreferences): Promise<UserPreferences>;
}

export interface StrategyRepository {
  create(input: StrategyDefInput): Promise<StrategyDef>;
  update(id: string, patch: Partial<StrategyDefInput>): Promise<StrategyDef | null>;
  get(id: string): Promise<StrategyDef | null>;
  list(): Promise<StrategyDef[]>;
  delete(id: string): Promise<boolean>;
  setStatus(id: string, status: StrategyStatus): Promise<StrategyDef | null>;
  duplicate(id: string): Promise<StrategyDef | null>;
  versions(id: string): Promise<StrategyVersion[]>;
}

export interface DataStore {
  readonly kind: 'postgres' | 'memory';
  init(): Promise<void>;
  close(): Promise<void>;
  readonly alerts: AlertRepository;
  readonly configs: ConfigRepository;
  readonly notifications: NotificationLogRepository;
  readonly preferences: PreferencesRepository;
  readonly strategies: StrategyRepository;
}

/** Build a fresh custom strategy from builder input. */
export function buildStrategy(input: StrategyDefInput): StrategyDef {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    category: input.category,
    notes: input.notes,
    status: input.status ?? 'draft',
    version: 1,
    builtin: false,
    scope: input.scope,
    underlying: input.underlying,
    expiryType: input.expiryType,
    strikeSelection: input.strikeSelection,
    timeframe: input.timeframe,
    root: input.root,
    createdAt: now,
    updatedAt: now,
  };
}

/** Per-strategy performance statistics from that strategy's alerts. */
export function computeStrategyStats(alerts: Alert[], strategyId: string, nowMs = Date.now()): StrategyStats {
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const weekAgo = nowMs - 7 * 86_400_000;
  const monthAgo = nowMs - 30 * 86_400_000;
  const days = new Set<string>();
  const weeks = new Set<string>();
  const symbols = new Map<string, number>();
  let today = 0;
  let week = 0;
  let month = 0;
  let last: string | undefined;

  for (const a of alerts) {
    const t = Date.parse(a.triggeredAt);
    if (a.triggeredAt.slice(0, 10) === todayStr) today++;
    if (t >= weekAgo) week++;
    if (t >= monthAgo) month++;
    days.add(a.triggeredAt.slice(0, 10));
    weeks.add(isoWeek(a.triggeredAt));
    const sym = `${a.underlying} ${a.strike}`;
    symbols.set(sym, (symbols.get(sym) ?? 0) + 1);
    if (!last || a.triggeredAt > last) last = a.triggeredAt;
  }
  const mostActive = [...symbols.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    strategyId,
    totalAlerts: alerts.length,
    alertsToday: today,
    alertsThisWeek: week,
    alertsThisMonth: month,
    avgPerDay: round2(alerts.length / Math.max(1, days.size)),
    avgPerWeek: round2(alerts.length / Math.max(1, weeks.size)),
    lastTriggered: last,
    mostActiveSymbol: mostActive,
  };
}

/** Build a fully-formed configuration from user input (shared by both stores). */
export function buildConfiguration(input: AlertConfigurationInput): AlertConfiguration {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    underlying: input.underlying,
    expiryType: input.expiryType,
    strikeSelection: input.strikeSelection,
    customStrike: input.customStrike,
    timeframe: input.timeframe,
    strategy: input.strategy,
    params: { ...DEFAULT_RSI_SYNC_PARAMS, ...input.params },
    active: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Compute the analytics summary from an in-memory alert array. */
export function summarize(alerts: Alert[]): AnalyticsSummary {
  const byDay = new Map<string, number>();
  const byWeek = new Map<string, number>();
  const byUnderlying = new Map<string, number>();
  const byExpiry = new Map<string, number>();
  const bySymbol = new Map<string, number>();
  let s1 = 0;
  let s2 = 0;

  for (const a of alerts) {
    const day = a.triggeredAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    byWeek.set(isoWeek(a.triggeredAt), (byWeek.get(isoWeek(a.triggeredAt)) ?? 0) + 1);
    byUnderlying.set(a.underlying, (byUnderlying.get(a.underlying) ?? 0) + 1);
    byExpiry.set(a.expiry, (byExpiry.get(a.expiry) ?? 0) + 1);
    const sym = `${a.underlying} ${a.strike}`;
    bySymbol.set(sym, (bySymbol.get(sym) ?? 0) + 1);
    if (a.scenario === 1) s1++;
    else if (a.scenario === 2) s2++;
  }

  const toBuckets = (m: Map<string, number>) =>
    [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key));

  return {
    totalAlerts: alerts.length,
    scenario1Count: s1,
    scenario2Count: s2,
    alertsPerDay: toBuckets(byDay),
    alertsPerWeek: toBuckets(byWeek),
    alertsPerUnderlying: toBuckets(byUnderlying).sort((a, b) => b.count - a.count),
    alertsPerExpiry: toBuckets(byExpiry),
    mostActiveSymbols: toBuckets(bySymbol)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

/** ISO year-week label, e.g. "2026-W31". */
export function isoWeek(iso: string): string {
  const d = new Date(iso);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Filter alerts in memory per the history filters. */
export function applyAlertFilters(alerts: Alert[], f: AlertHistoryFilters): Alert[] {
  let out = alerts.filter((a) => {
    if (f.from && a.triggeredAt < f.from) return false;
    if (f.to && a.triggeredAt > f.to) return false;
    if (f.underlying && a.underlying !== f.underlying) return false;
    if (f.expiry && a.expiry !== f.expiry) return false;
    if (f.timeframe && a.timeframe !== f.timeframe) return false;
    if (f.scenario && a.scenario !== f.scenario) return false;
    if (f.strategyId && a.strategyId !== f.strategyId) return false;
    return true;
  });
  out = out.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt)); // newest first
  const offset = f.offset ?? 0;
  const limit = f.limit ?? 100;
  return out.slice(offset, offset + limit);
}
