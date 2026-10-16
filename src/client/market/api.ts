/**
 * Typed client for the market eagle view (/api/market/*).
 */
import type { CalendarData, CompanyData, GlobalData, MarketMap, MarketOverview, MoversData, NewsData, OptionsData, Universe } from '@/shared/market/types';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/market${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const marketApi = {
  overview: () => get<MarketOverview>('/overview'),
  map: (universe: Universe) => get<MarketMap>(`/map?universe=${universe}`),
  movers: () => get<MoversData>('/movers'),
  options: () => get<OptionsData>('/options'),
  global: () => get<GlobalData>('/global'),
  news: () => get<NewsData>('/news'),
  calendar: () => get<CalendarData>('/calendar'),
  company: (symbol: string) => get<CompanyData>(`/company/${encodeURIComponent(symbol)}`),
};
