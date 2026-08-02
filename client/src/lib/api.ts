import type {
  Alert,
  AlertConfiguration,
  AlertConfigurationInput,
  AlertHistoryFilters,
  AnalyticsSummary,
  AnalyzerParams,
  BacktestResult,
  BuilderCatalog,
  ChartWindow,
  ConfigRuntimeSnapshot,
  KiteAuthStatus,
  StrategyDef,
  StrategyDefInput,
  StrategyDefinition,
  StrategyStats,
  StrategyVersion,
  TimeframeDef,
  UnderlyingDef,
  UserPreferences,
} from '@ash/shared';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface HealthInfo {
  status: string;
  provider: string;
  store: string;
}

export interface ExpiryOption {
  type: 'current-weekly' | 'next-weekly' | 'monthly';
  date: string;
  label: string;
}

export interface ConfigMeta {
  timeframes: TimeframeDef[];
  strikeSelections: string[];
  expiryTypes: Array<{ type: string; label: string }>;
}

function buildQuery(filters: AlertHistoryFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

export const api = {
  health: () => request<HealthInfo>('/health'),

  // Instruments / metadata
  underlyings: () => request<UnderlyingDef[]>('/instruments/underlyings'),
  expiries: (underlying: string) => request<ExpiryOption[]>(`/instruments/${underlying}/expiries`),
  strikes: (underlying: string, expiry: string) =>
    request<number[]>(`/instruments/${underlying}/strikes?expiry=${encodeURIComponent(expiry)}`),
  meta: () => request<ConfigMeta>('/instruments/meta'),

  // Configs
  listConfigs: () => request<AlertConfiguration[]>('/configs'),
  createConfig: (input: AlertConfigurationInput) =>
    request<AlertConfiguration>('/configs', { method: 'POST', body: JSON.stringify(input) }),
  deleteConfig: (id: string) => request<void>(`/configs/${id}`, { method: 'DELETE' }),
  activateConfig: (id: string) => request<AlertConfiguration>(`/configs/${id}/activate`, { method: 'POST' }),
  deactivateConfig: (id: string) => request<AlertConfiguration>(`/configs/${id}/deactivate`, { method: 'POST' }),
  snapshots: () => request<ConfigRuntimeSnapshot[]>('/configs/snapshots'),

  // Alerts / analytics
  listAlerts: (filters: AlertHistoryFilters = {}) => request<Alert[]>(`/alerts${buildQuery(filters)}`),
  analytics: () => request<AnalyticsSummary>('/analytics/summary'),

  // Strategies
  strategies: () => request<StrategyDefinition[]>('/strategies'),

  // Preferences
  getPreferences: () => request<UserPreferences>('/preferences'),
  savePreferences: (prefs: UserPreferences) =>
    request<UserPreferences>('/preferences', { method: 'PUT', body: JSON.stringify(prefs) }),

  // Dev / demo
  simulate: (configId: string, scenario: 1 | 2) =>
    request<{ fired: boolean }>('/simulate/trigger', {
      method: 'POST',
      body: JSON.stringify({ configId, scenario }),
    }),

  // Historical Strategy Analyzer
  analyzerRun: (params: AnalyzerParams) =>
    request<BacktestResult>('/analyzer/run', { method: 'POST', body: JSON.stringify(params) }),
  analyzerChart: (params: AnalyzerParams, center: number, span?: number) =>
    request<ChartWindow>('/analyzer/chart', {
      method: 'POST',
      body: JSON.stringify({ params, center, span }),
    }),

  // Strategy Builder
  builderCatalog: () => request<BuilderCatalog>('/builder/catalog'),
  builderTemplate: () => request<StrategyDef>('/builder/template'),
  listStrategies: () => request<StrategyDef[]>('/custom-strategies'),
  getStrategy: (id: string) => request<StrategyDef>(`/custom-strategies/${id}`),
  createStrategy: (input: StrategyDefInput) =>
    request<StrategyDef>('/custom-strategies', { method: 'POST', body: JSON.stringify(input) }),
  updateStrategy: (id: string, input: StrategyDefInput) =>
    request<StrategyDef>(`/custom-strategies/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteStrategy: (id: string) => request<void>(`/custom-strategies/${id}`, { method: 'DELETE' }),
  duplicateStrategy: (id: string) => request<StrategyDef>(`/custom-strategies/${id}/duplicate`, { method: 'POST' }),
  publishStrategy: (id: string) => request<StrategyDef>(`/custom-strategies/${id}/publish`, { method: 'POST' }),
  disableStrategy: (id: string) => request<StrategyDef>(`/custom-strategies/${id}/disable`, { method: 'POST' }),
  strategyVersions: (id: string) => request<StrategyVersion[]>(`/custom-strategies/${id}/versions`),
  strategyStats: (id: string) => request<StrategyStats>(`/custom-strategies/${id}/stats`),

  // Kite broker login
  kiteStatus: () => request<KiteAuthStatus>('/kite/status'),
  kiteLogout: () => request<{ ok: boolean }>('/kite/logout', { method: 'POST' }),
  /** The Kite login URL (open in a popup/new tab). */
  kiteGetLoginUrl: () => request<{ url: string }>('/kite/login-url'),
  /** Complete login by submitting the request_token (or the full redirected URL). */
  kiteSubmitToken: (token: string) =>
    request<{ ok: boolean }>('/kite/session', { method: 'POST', body: JSON.stringify({ token }) }),
  /** Full-page redirect into Kite login (used when the Redirect URL points at /api/kite/callback). */
  kiteLoginUrl: '/api/kite/login',
};
