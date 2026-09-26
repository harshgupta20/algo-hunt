/**
 * Typed client for the MCX V2 API (/api/mcx/v2/*). Kept separate from the V1
 * client so the two subsystems never share request/response types.
 */
import type {
  CalendarEntry,
  ExprTrace,
  McxAlert,
  McxInstrument,
  McxProduct,
  McxScanRun,
  McxSettings,
  McxSignal,
  McxStrategy,
  McxStrategyDefinition,
  McxStrategyVersion,
  McxTimeframe,
  McxUnit,
  SignalOutcome,
  TriState,
  UnitEvaluation,
  UnitState,
  Universe,
  UniverseResolution,
  ValidationIssue,
} from '@/shared/mcx';

const BASE = '/api/mcx/v2';

/** An API error with the server's validation issues (if any). */
export class McxApiError extends Error {
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
    throw new McxApiError(message, res.status, issues);
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

export interface McxStatus {
  now: number;
  market: { open: boolean; today: { date: string; trading: boolean; openMin: number; closeMin: number; note?: string }; sessionStart: number | null; sessionEnd: number | null };
  kiteConnected: boolean;
  instruments: { count: number; syncedAt: string | null };
  strategies: { total: number; enabled: number };
  lastRun: McxScanRun | null;
  channels: ChannelStatus;
}

export interface ProductRow extends McxProduct {
  futures: Array<{ id: string; symbol: string; expiry: string | null }>;
  optionExpiries: Array<{ expiry: string; strikes: number }>;
}

export interface Quote {
  ltp: number;
  volume?: number;
  oi?: number;
  change?: number;
}

export interface UniversePreview extends UniverseResolution {
  cap: number;
  /** Live quotes keyed by instrument id (every leg of the shown units). */
  quotes: Record<string, Quote>;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  valid: boolean;
  summary: string;
  resolvedTargets?: number;
}

export interface ExplainUnit {
  unit: McxUnit;
  evaluation?: UnitEvaluation;
  prevResult: TriState | null;
  outcome?: SignalOutcome;
  state: UnitState | null;
  error?: string;
}

export interface ExplainResult {
  evaluatedAt: number;
  triggerCandle: number;
  at: number;
  resolution: { errors: string[]; notes: string[]; expiries: string[]; references: Array<{ symbol: string; ltp?: number }> };
  units: ExplainUnit[];
  requests: number;
  errors: string[];
}

export interface ReplayRow {
  candleTime: number;
  at: number;
  result: TriState;
  outcome?: SignalOutcome;
  prices: UnitEvaluation['prices'];
  failing: string[];
  trace?: ExprTrace;
}

export interface ReplayResult {
  from: string;
  to: string;
  triggerTimeframe: McxTimeframe;
  candles: number;
  units: Array<{ unit: McxUnit; rows: ReplayRow[]; signals: number }>;
  notes: string[];
  errors: string[];
  requests: number;
}

export interface ScanResult {
  run: McxScanRun;
  skipped?: string;
}

export const mcxApi = {
  status: () => request<McxStatus>('/status'),
  products: () => request<ProductRow[]>('/products'),
  instruments: (q: { underlying?: string; expiry?: string; type?: string; search?: string; limit?: number }) => {
    const p = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k, String(v)]])));
    return request<{ total: number; items: McxInstrument[] }>(`/instruments?${p}`);
  },
  syncInstruments: () => post<{ count: number; syncedAt: string }>('/instruments/sync'),
  previewUniverse: (universe: Universe) => post<UniversePreview>('/universe/preview', { universe }),
  validate: (definition: McxStrategyDefinition, opts: { forEnable?: boolean; resolve?: boolean } = {}) => post<ValidationResult>('/validate', { definition, ...opts }),
  explainDraft: (definition: McxStrategyDefinition, unitKey?: string) => post<ExplainResult>('/explain', { definition, unitKey }),
  explain: (id: string, unitKey?: string) => post<ExplainResult>(`/strategies/${id}/explain`, { unitKey }),
  replay: (body: { strategyId?: string; definition?: McxStrategyDefinition; from: string; to: string; unitKeys?: string[] }) => post<ReplayResult>('/replay', body),

  strategies: () => request<McxStrategy[]>('/strategies'),
  strategy: (id: string) => request<McxStrategy>(`/strategies/${id}`),
  createStrategy: (definition: McxStrategyDefinition) => post<McxStrategy>('/strategies', { definition }),
  updateStrategy: (id: string, definition: McxStrategyDefinition) => put<McxStrategy>(`/strategies/${id}`, { definition }),
  deleteStrategy: (id: string) => request<void>(`/strategies/${id}`, { method: 'DELETE' }),
  duplicateStrategy: (id: string) => post<McxStrategy>(`/strategies/${id}/duplicate`),
  enable: (id: string) => post<McxStrategy>(`/strategies/${id}/enable`),
  disable: (id: string) => post<McxStrategy>(`/strategies/${id}/disable`),
  versions: (id: string) => request<McxStrategyVersion[]>(`/strategies/${id}/versions`),
  units: (id: string) => request<UnitState[]>(`/strategies/${id}/units`),

  alerts: (q: { strategyId?: string; active?: boolean; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.strategyId) p.set('strategyId', q.strategyId);
    if (q.active) p.set('active', '1');
    if (q.limit) p.set('limit', String(q.limit));
    return request<McxAlert[]>(`/alerts?${p}`);
  },
  acknowledge: (id: string) => post<McxAlert>(`/alerts/${id}/acknowledge`),
  signals: (q: { strategyId?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.strategyId) p.set('strategyId', q.strategyId);
    if (q.limit) p.set('limit', String(q.limit));
    return request<McxSignal[]>(`/signals?${p}`);
  },

  scan: (force = false) => post<ScanResult>('/scan', { force }),
  scanRuns: (limit = 100) => request<McxScanRun[]>(`/scan-runs?limit=${limit}`),

  settings: () => request<McxSettings>('/settings'),
  saveSettings: (s: McxSettings) => put<McxSettings>('/settings', s),
  calendar: () => request<CalendarEntry[]>('/calendar'),
  saveCalendar: (entries: CalendarEntry[]) => put<CalendarEntry[]>('/calendar', { entries }),
  channels: () => request<ChannelStatus>('/channels'),
  testChannel: (channel: 'telegram' | 'email') => post<{ ok: boolean }>('/channels/test', { channel }),
};
