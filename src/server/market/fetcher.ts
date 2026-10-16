/**
 * HTTP for the market view's free sources (NSE, Yahoo, news feeds): browser-like headers, timeouts, a polite
 * gap between NSE requests, and a record of how each source is doing (shown on the page).
 */
import type { SourceState } from '@/shared/market/types';

export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

// ---- source health --------------------------------------------------------------------------------

const LABELS: Record<string, string> = {
  'nse-indices': 'NSE indices',
  'nse-status': 'NSE market status',
  'nse-flows': 'NSE FII / DII',
  'nse-52w': 'NSE 52-week highs / lows',
  'nse-participants': 'NSE participant OI',
  'nse-futures': 'NSE index futures',
  'nse-heatmap': 'NSE sector stocks',
  'nse-movers': 'NSE movers',
  'nse-oi': 'NSE OI changes',
  'nse-deals': 'NSE bulk / block deals',
  'nse-preopen': 'NSE pre-open',
  'nse-calendar': 'NSE results calendar',
  'nse-actions': 'NSE corporate actions',
  'nse-announcements': 'NSE announcements',
  'nse-lists': 'NSE index constituents',
  'kite-quotes': 'Kite quotes',
  'kite-options': 'Kite option chain',
  yahoo: 'Yahoo Finance',
  news: 'News feeds',
  'google-news': 'Google News',
};

const health = new Map<string, SourceState>();

export function markSource(id: string, ok: boolean, error?: string): void {
  const prev = health.get(id);
  health.set(id, { id, label: LABELS[id] ?? id, ok, at: ok ? new Date().toISOString() : (prev?.at ?? null), ...(ok ? {} : { error }) });
}

export function sourceStates(ids: string[]): SourceState[] {
  return ids.map((id) => health.get(id) ?? { id, label: LABELS[id] ?? id, ok: true, at: null });
}

// ---- requests -----------------------------------------------------------------------------------------

const NSE_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/',
};

/** One request at a time per NSE host, ≥ 300 ms apart — NSE is a public website, not an API service. */
const queues = new Map<string, { tail: Promise<unknown>; last: number }>();
const NSE_GAP_MS = 300;

async function polite<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const q = queues.get(host) ?? { tail: Promise.resolve(), last: 0 };
  queues.set(host, q);
  const run = q.tail.then(async () => {
    const wait = q.last + NSE_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      q.last = Date.now();
    }
  });
  q.tail = run.catch(() => undefined);
  return run;
}

export async function getText(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, ...opts.headers }, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000), cache: 'no-store' });
  } catch (err) {
    throw new SourceError(err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : `unreachable (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) throw new SourceError(res.status === 429 ? 'rate-limited (429)' : `HTTP ${res.status}`, res.status);
  return res.text();
}

export async function getJson<T>(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
  const text = await getText(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceError('not JSON (the site may be blocking automated requests)');
  }
}

export const nseJson = <T>(path: string) => polite('www', () => getJson<T>(`https://www.nseindia.com/api/${path}`, { headers: NSE_HEADERS }));
export const nseArchive = (path: string) => polite('archives', () => getText(`https://archives.nseindia.com/${path}`, { headers: { 'User-Agent': BROWSER_UA } }));
