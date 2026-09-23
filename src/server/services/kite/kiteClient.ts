/**
 * Thin helpers around the `kiteconnect` SDK: client construction, error
 * normalization, and rate-limit-aware retries. Kite's SDK rejects with plain
 * objects ({ message, error_type }) rather than Error instances.
 */
import { requireKiteCredentials } from '../../config/index';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type KiteClient = any;

/** Instrument dumps are several MB; the SDK's 7s default is too tight on a cold function. */
const REQUEST_TIMEOUT_MS = 30_000;

export async function createKiteClient(accessToken?: string): Promise<KiteClient> {
  const { apiKey } = requireKiteCredentials();
  const { KiteConnect } = await import('kiteconnect');
  const kc = new KiteConnect({
    api_key: apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    // Optional override (proxies / integration testing). Leave unset for https://api.kite.trade.
    ...(process.env.KITE_API_ROOT ? { root: process.env.KITE_API_ROOT } : {}),
  });
  if (accessToken) kc.setAccessToken(accessToken);
  return kc;
}

export function kiteErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Kite request failed';
}

/** True when Kite rejected the access token (expired, revoked, or never valid). */
export function isKiteTokenError(err: unknown): boolean {
  if (err && typeof err === 'object' && (err as { error_type?: unknown }).error_type === 'TokenException') return true;
  return /incorrect `api_key` or `access_token`|token is invalid|session expired|tokenexception/i.test(kiteErrorMessage(err));
}

export function isKiteRateLimit(err: unknown): boolean {
  return /too many requests|rate limit|429/i.test(kiteErrorMessage(err));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry a Kite REST call on 429 with linear backoff. */
export async function withKiteRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isKiteRateLimit(err) && attempt < retries) {
        await delay(1000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

/** Error thrown when an operation needs a live Kite session and there isn't one. */
export class KiteNotConnectedError extends Error {
  constructor(message = 'Zerodha Kite is not connected. Open Settings → Broker Connection and log in.') {
    super(message);
    this.name = 'KiteNotConnectedError';
  }
}
