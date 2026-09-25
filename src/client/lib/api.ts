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
  ExpiryType,
  KiteAuthStatus,
  LiveStatus,
  McxProductInfo,
  Segment,
  StrategyDef,
  UnderlyingGroup,
  UnderlyingGroupInput,
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
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      // Session cookie expired → back to the login page.
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
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
  store: string;
  kite: string;
}

export interface ExpiryOption {
  type: ExpiryType;
  date: string;
  label: string;
}

export interface ConfigMeta {
  timeframes: TimeframeDef[];
  strikeSelections: string[];
  expiryTypes: Array<{ type: ExpiryType; label: string }>;
}

export interface InstrumentStatus {
  count: number;
  syncedAt?: string;
  segments?: Record<Segment, { count: number; syncedAt?: string }>;
}

/** `?segment=MCX` for the MCX market; NSE/BSE is the default. */
const seg = (segment?: Segment) => (segment === 'MCX' ? '?segment=MCX' : '');

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
  underlyings: (segment?: Segment) => request<UnderlyingDef[]>(`/instruments/underlyings${seg(segment)}`),
  expiries: (underlying: string) => request<ExpiryOption[]>(`/instruments/${underlying}/expiries`),
  strikes: (underlying: string, expiry: string) =>
    request<number[]>(`/instruments/${underlying}/strikes?expiry=${encodeURIComponent(expiry)}`),
  meta: (segment?: Segment) => request<ConfigMeta>(`/instruments/meta${seg(segment)}`),
  mcxProducts: () => request<McxProductInfo[]>('/mcx/products'),

  // Configs
  listConfigs: () => request<AlertConfiguration[]>('/configs'),
  createConfig: (input: AlertConfigurationInput) =>
    request<AlertConfiguration>('/configs', { method: 'POST', body: JSON.stringify(input) }),
  deleteConfig: (id: string) => request<void>(`/configs/${id}`, { method: 'DELETE' }),
  activateConfig: (id: string) => request<AlertConfiguration>(`/configs/${id}/activate`, { method: 'POST' }),
  deactivateConfig: (id: string) => request<AlertConfiguration>(`/configs/${id}/deactivate`, { method: 'POST' }),
  snapshots: () => request<ConfigRuntimeSnapshot[]>('/configs/snapshots'),

  // Underlying groups
  listGroups: () => request<UnderlyingGroup[]>('/groups'),
  createGroup: (input: UnderlyingGroupInput) =>
    request<UnderlyingGroup>('/groups', { method: 'POST', body: JSON.stringify(input) }),
  deleteGroup: (id: string) => request<void>(`/groups/${id}`, { method: 'DELETE' }),

  // Group monitors (one config per member)
  createConfigGroup: (input: {
    members: string[];
    groupName?: string;
    expiryType: string;
    strikeSelection: string;
    timeframe: string;
    strategy: string;
    params?: Record<string, number>;
  }) => request<{ groupId: string; configs: AlertConfiguration[] }>('/config-groups', { method: 'POST', body: JSON.stringify(input) }),
  activateConfigGroup: (groupId: string) =>
    request<{ activated: number; total: number; errors: string[] }>(`/config-groups/${groupId}/activate`, { method: 'POST' }),
  deactivateConfigGroup: (groupId: string) =>
    request<{ deactivated: number }>(`/config-groups/${groupId}/deactivate`, { method: 'POST' }),
  deleteConfigGroup: (groupId: string) => request<void>(`/config-groups/${groupId}`, { method: 'DELETE' }),

  // Alerts / analytics
  listAlerts: (filters: AlertHistoryFilters = {}) => request<Alert[]>(`/alerts${buildQuery(filters)}`),
  analytics: (segment?: Segment) => request<AnalyticsSummary>(`/analytics/summary${segment ? `?segment=${segment}` : ''}`),

  // Strategies
  strategies: () => request<StrategyDefinition[]>('/strategies'),

  // Preferences
  getPreferences: () => request<UserPreferences>('/preferences'),
  savePreferences: (prefs: UserPreferences) =>
    request<UserPreferences>('/preferences', { method: 'PUT', body: JSON.stringify(prefs) }),

  // Live monitoring (serverless evaluator)
  liveStatus: () => request<LiveStatus>('/live/status'),
  liveTick: () => request<{ ran: boolean; reason?: string; at: string; alerts: number }>('/live/tick', { method: 'POST' }),

  // Historical Strategy Analyzer
  /** Fields the strategy fixes may be omitted — the server applies its market profile. */
  analyzerRun: (params: Partial<AnalyzerParams> & Pick<AnalyzerParams, 'strategy' | 'preset'>) =>
    request<BacktestResult>('/analyzer/run', { method: 'POST', body: JSON.stringify(params) }),
  analyzerChart: (params: Partial<AnalyzerParams> & Pick<AnalyzerParams, 'strategy' | 'preset'>, center: number, span?: number) =>
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
  /** Full-page redirect into Kite login; Kite returns to /zerodhaRedirection (or /api/kite/callback). */
  kiteLoginUrl: '/api/kite/login',
  kiteInstruments: () => request<InstrumentStatus>('/kite/instruments'),
  kiteSyncInstruments: () => request<{ count: number; syncedAt: string }>('/kite/instruments/sync', { method: 'POST' }),
};
