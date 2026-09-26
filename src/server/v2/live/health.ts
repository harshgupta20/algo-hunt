/**
 * How healthy the live worker is, from its heartbeat row. Shared by the cron
 * scanner (step aside / back it up) and the API (status card).
 */
import type { LiveStatus } from '@/shared/v2';

/** No heartbeat for this long = the worker is gone. */
export const LIVE_STALE_MS = 45_000;
/** Warn (once) when the worker has been silent this long during market hours. */
export const LIVE_OFFLINE_WARN_MS = 2 * 60_000;

export interface LiveHealth {
  online: boolean;
  /** Online and streaming (or warming up): the connections it covers need no cron scan. */
  covering: boolean;
  uncovered: string[];
  /** Went silent without a clean stop (crash, sleep, network). */
  crashed: boolean;
  silentMs: number | null;
}

export function liveHealth(row: { status: LiveStatus } | null, now: number): LiveHealth {
  if (!row) return { online: false, covering: false, uncovered: [], crashed: false, silentMs: null };
  const silentMs = now - Date.parse(row.status.heartbeatAt);
  const online = silentMs < LIVE_STALE_MS && row.status.state !== 'STOPPED';
  return {
    online,
    covering: online && (row.status.state === 'LIVE' || row.status.state === 'WARMING_UP'),
    uncovered: row.status.connections.uncovered,
    crashed: !online && row.status.state !== 'STOPPED',
    silentMs,
  };
}
