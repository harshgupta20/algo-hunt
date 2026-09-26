/**
 * Typed client for the V2 API (/api/v2/*).
 */
import type {
  CalendarEntry,
  CompareResult,
  ConnectionConfig,
  ScanRun,
  SignalOutcome,
  StrategyDefinition,
  TriState,
  UnitEvaluation,
  UnitResolution,
  UnitState,
  V2Alert,
  V2Connection,
  V2Product,
  V2Settings,
  V2Signal,
  V2Strategy,
  V2StrategyVersion,
  V2Unit,
  ValidationIssue,
} from '@/shared/v2';

const BASE = '/api/v2';

export class V2ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    let message = `Request failed (${res.status})`;
    let issues: ValidationIssue[] | undefined;
    try {
      const body = (await res.json()) as { error?: string; issues?: ValidationIssue[] };
      if (body.error) message = body.error;
      issues = body.issues;
    } catch {
      /* ignore */
    }
    throw new V2ApiError(message, res.status, issues);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export interface ChannelStatus {
  telegram: { configured: boolean; detail: string };
  email: { configured: boolean; detail: string };
}

export interface MarketStatus {
  open: boolean;
  today: { date: string; trading: boolean; openMin: number; closeMin: number; note?: string };
}

export interface V2Status {
  now: number;
  markets: { NSE: MarketStatus; MCX: MarketStatus };
  kiteConnected: boolean;
  instruments: { count: number; products: number; syncedAt: string | null };
  strategies: number;
  connections: { total: number; enabled: number };
  lastRun: ScanRun | null;
  channels: ChannelStatus;
}

export type StrategyRow = V2Strategy & { connections: number; enabledConnections: number };
export type ConnectionRow = V2Connection & { strategyName: string; product: V2Product | null };

export interface Quote {
  ltp: number;
  volume?: number;
  oi?: number;
}

export interface ConnectionPreview extends UnitResolution {
  quotes: Record<string, Quote>;
  product: V2Product;
}

export interface ExplainUnit {
  unit: V2Unit;
  evaluation?: UnitEvaluation;
  prevResult: TriState | null;
  outcome?: SignalOutcome;
  state: UnitState | null;
  error?: string;
}

export interface ExplainResult {
  productId: string;
  evaluatedAt: number;
  triggerCandle: number;
  at: number;
  references: Array<{ symbol: string; ltp?: number }>;
  errors: string[];
  notes: string[];
  units: ExplainUnit[];
  requests: number;
}

export interface CompareInput {
  strategyId?: string;
  definition?: StrategyDefinition;
  products: string[];
  from: string;
  to: string;
  expiry?: ConnectionConfig['expiry'];
  strikeShift?: number;
  trigger?: 'ON_TRANSITION' | 'WHILE_TRUE';
  cooldownMinutes?: number | null;
}

export const v2Api = {
  status: () => request<V2Status>('/status'),
  products: (q: { search?: string; kind?: string; market?: string; ids?: string[]; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.search) p.set('search', q.search);
    if (q.kind) p.set('kind', q.kind);
    if (q.market) p.set('market', q.market);
    if (q.ids?.length) p.set('ids', q.ids.join(','));
    if (q.limit) p.set('limit', String(q.limit));
    return request<V2Product[]>(`/products?${p}`);
  },
  syncProducts: () => post<{ instruments: number; products: number; syncedAt: string }>('/products/sync'),

  strategies: () => request<StrategyRow[]>('/strategies'),
  strategy: (id: string) => request<V2Strategy>(`/strategies/${id}`),
  createStrategy: (definition: StrategyDefinition) => post<V2Strategy>('/strategies', { definition }),
  updateStrategy: (id: string, definition: StrategyDefinition) => put<V2Strategy>(`/strategies/${id}`, { definition }),
  deleteStrategy: (id: string) => request<void>(`/strategies/${id}`, { method: 'DELETE' }),
  duplicateStrategy: (id: string) => post<V2Strategy>(`/strategies/${id}/duplicate`),
  versions: (id: string) => request<V2StrategyVersion[]>(`/strategies/${id}/versions`),
  validateStrategy: (definition: StrategyDefinition) => post<{ issues: ValidationIssue[]; valid: boolean; summary: string }>('/strategies/validate', { definition }),

  connections: (strategyId?: string) => request<ConnectionRow[]>(`/connections${strategyId ? `?strategyId=${strategyId}` : ''}`),
  createConnections: (strategyId: string, productIds: string[], config: ConnectionConfig) => post<V2Connection[]>('/connections', { strategyId, productIds, config }),
  updateConnection: (id: string, config: ConnectionConfig) => put<V2Connection>(`/connections/${id}`, { config }),
  deleteConnection: (id: string) => request<void>(`/connections/${id}`, { method: 'DELETE' }),
  enableConnection: (id: string) => post<V2Connection>(`/connections/${id}/enable`),
  disableConnection: (id: string) => post<V2Connection>(`/connections/${id}/disable`),
  units: (id: string) => request<UnitState[]>(`/connections/${id}/units`),
  previewConnection: (body: { strategyId?: string; definition?: StrategyDefinition; productId: string; config: ConnectionConfig }) => post<ConnectionPreview>('/connections/preview', body),
  explainConnection: (id: string) => post<ExplainResult>(`/connections/${id}/explain`),
  explainDraft: (definition: StrategyDefinition, productId: string, config?: ConnectionConfig) => post<ExplainResult>('/connections/explain', { definition, productId, config }),

  compare: (body: CompareInput) => post<CompareResult>('/compare', body),

  alerts: (q: { connectionId?: string; strategyId?: string; active?: boolean; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.connectionId) p.set('connectionId', q.connectionId);
    if (q.strategyId) p.set('strategyId', q.strategyId);
    if (q.active) p.set('active', '1');
    if (q.limit) p.set('limit', String(q.limit));
    return request<V2Alert[]>(`/alerts?${p}`);
  },
  acknowledge: (id: string) => post<V2Alert>(`/alerts/${id}/acknowledge`),
  signals: (q: { connectionId?: string; strategyId?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.connectionId) p.set('connectionId', q.connectionId);
    if (q.strategyId) p.set('strategyId', q.strategyId);
    if (q.limit) p.set('limit', String(q.limit));
    return request<V2Signal[]>(`/signals?${p}`);
  },

  scan: (force = false) => post<{ run: ScanRun; skipped?: string }>('/scan', { force }),
  scanRuns: (limit = 100) => request<ScanRun[]>(`/scan-runs?limit=${limit}`),

  settings: () => request<V2Settings>('/settings'),
  saveSettings: (s: V2Settings) => put<V2Settings>('/settings', s),
  calendar: () => request<CalendarEntry[]>('/calendar'),
  saveCalendar: (entries: CalendarEntry[]) => put<CalendarEntry[]>('/calendar', { entries }),
  channels: () => request<ChannelStatus>('/channels'),
  testChannel: (channel: 'telegram' | 'email') => post<{ ok: boolean }>('/channels/test', { channel }),
};
