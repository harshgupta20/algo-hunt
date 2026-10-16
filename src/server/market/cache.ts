/**
 * In-memory cache for the market view (nothing goes to the database): a value is reused until it's older than its
 * TTL, then served once more while a background refresh runs (stale-while-revalidate); concurrent requests share
 * one fetch; when a source fails the last good value is served (marked with the error) while the source is left
 * alone for a short back-off.
 */
import { markSource } from './fetcher';

interface Entry {
  value?: unknown;
  at: number;
  error?: string;
  failedAt?: number;
  inflight?: Promise<unknown>;
}

const RETRY_AFTER_FAIL_MS = 30_000;
const g = globalThis as unknown as { __ashMarketCache?: Map<string, Entry> };
const store = (g.__ashMarketCache ??= new Map<string, Entry>());

export interface Cached<T> {
  value: T | undefined;
  /** ms epoch of the value (0 when none). */
  at: number;
  error?: string;
}

/**
 * The value for `key`, loading it when missing or older than `ttlMs`. `source` names the source in the page's
 * health list. Never throws: a failure without any earlier value returns `value: undefined` with the error.
 * After a failure the source is left alone for `retryMs` (default 30 s).
 */
export async function cached<T>(key: string, ttlMs: number, source: string, load: () => Promise<T>, opts: { retryMs?: number } = {}): Promise<Cached<T>> {
  const now = Date.now();
  const e = store.get(key) ?? { at: 0 };
  store.set(key, e);
  const fresh = e.value !== undefined && now - e.at < ttlMs;
  const backingOff = e.failedAt !== undefined && now - e.failedAt < (opts.retryMs ?? RETRY_AFTER_FAIL_MS);
  if (fresh || (backingOff && !e.inflight)) return { value: e.value as T | undefined, at: e.at, error: e.error };
  if (!e.inflight) {
    e.inflight = load()
      .then((v) => {
        e.value = v;
        e.at = Date.now();
        e.error = undefined;
        e.failedAt = undefined;
        markSource(source, true);
        return v;
      })
      .catch((err: unknown) => {
        e.error = err instanceof Error ? err.message : String(err);
        e.failedAt = Date.now();
        markSource(source, false, e.error);
      })
      .finally(() => {
        e.inflight = undefined;
      });
  }
  // Stale but usable: answer now, the refresh lands for the next request (NSE can take seconds).
  if (e.value !== undefined && now - e.at < Math.max(ttlMs * 10, 10 * 60_000)) return { value: e.value as T, at: e.at, error: e.error };
  await e.inflight;
  return { value: e.value as T | undefined, at: e.at, error: e.error };
}

/** Test helper. */
export function clearMarketCache(): void {
  store.clear();
}
