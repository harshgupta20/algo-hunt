/**
 * Typed client for the app-level API (/api/*): Kite login, preferences, health.
 * V2 has its own client (src/client/v2/api.ts).
 */
import type { KiteAuthStatus, UserPreferences } from '@ash/shared';

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

export const api = {
  health: () => request<HealthInfo>('/health'),

  // UI preferences (theme, desktop notifications, sound)
  getPreferences: () => request<UserPreferences>('/preferences'),
  savePreferences: (prefs: UserPreferences) => request<UserPreferences>('/preferences', { method: 'PUT', body: JSON.stringify(prefs) }),

  // Kite broker login
  kiteStatus: () => request<KiteAuthStatus>('/kite/status'),
  kiteLogout: () => request<{ ok: boolean }>('/kite/logout', { method: 'POST' }),
  /** The Kite login URL (open in a popup/new tab). */
  kiteGetLoginUrl: () => request<{ url: string }>('/kite/login-url'),
  /** Complete login by submitting the request_token (or the full redirected URL). */
  kiteSubmitToken: (token: string) => request<{ ok: boolean }>('/kite/session', { method: 'POST', body: JSON.stringify({ token }) }),
  /** Full-page redirect into Kite login; Kite returns to /zerodhaRedirection (or /api/kite/callback). */
  kiteLoginUrl: '/api/kite/login',
};
