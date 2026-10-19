/** Typed client for the Equity API (/api/equity/*). */
import type {
  EqBacktestJob,
  EqBacktestRequest,
  EqPreset,
  EqPresetInfo,
  EqScreenJob,
  EqScreenRequest,
  EqStock,
  EqStrategy,
  EqStrategyDefinition,
  EqTemplate,
  EqWatchlist,
  ValidationIssue,
} from '@/shared/equity';

const BASE = '/api/equity';

export class EqApiError extends Error {
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
      /* not JSON */
    }
    throw new EqApiError(message, res.status, issues);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const send = <T>(method: string, path: string, body?: unknown) => request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const eqApi = {
  stocks: (q: { search?: string; preset?: EqPreset; symbols?: string[]; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.search) p.set('search', q.search);
    if (q.preset) p.set('preset', q.preset);
    if (q.symbols?.length) p.set('symbols', q.symbols.join(','));
    if (q.limit) p.set('limit', String(q.limit));
    return request<{ total: number; stocks: EqStock[] }>(`/stocks?${p}`);
  },
  presets: () => request<EqPresetInfo[]>('/presets'),
  templates: () => request<EqTemplate[]>('/templates'),

  strategies: () => request<EqStrategy[]>('/strategies'),
  strategy: (id: string) => request<EqStrategy>(`/strategies/${id}`),
  createStrategy: (d: EqStrategyDefinition) => send<EqStrategy>('POST', '/strategies', d),
  updateStrategy: (id: string, d: EqStrategyDefinition) => send<EqStrategy>('PUT', `/strategies/${id}`, d),
  duplicateStrategy: (id: string) => send<EqStrategy>('POST', `/strategies/${id}/duplicate`),
  removeStrategy: (id: string) => send<void>('DELETE', `/strategies/${id}`),

  watchlists: () => request<EqWatchlist[]>('/watchlists'),
  createWatchlist: (w: { name: string; symbols: string[] }) => send<EqWatchlist>('POST', '/watchlists', w),
  updateWatchlist: (id: string, w: { name: string; symbols: string[] }) => send<EqWatchlist>('PUT', `/watchlists/${id}`, w),
  removeWatchlist: (id: string) => send<void>('DELETE', `/watchlists/${id}`),

  startBacktest: (r: EqBacktestRequest) => send<EqBacktestJob>('POST', '/backtests', r),
  latestBacktest: () => request<EqBacktestJob | null>('/backtests/latest'),
  backtestJob: (id: string) => request<EqBacktestJob>(`/backtests/${id}`),
  cancelBacktest: (id: string) => send<EqBacktestJob>('DELETE', `/backtests/${id}`),

  startScreen: (r: EqScreenRequest) => send<EqScreenJob>('POST', '/screens', r),
  latestScreen: () => request<EqScreenJob | null>('/screens/latest'),
  screenJob: (id: string) => request<EqScreenJob>(`/screens/${id}`),
  cancelScreen: (id: string) => send<EqScreenJob>('DELETE', `/screens/${id}`),
};
