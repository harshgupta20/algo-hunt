'use client';

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Alert, LiveStatus, UserPreferences } from '@ash/shared';
import { api } from '../lib/api';
import { playChime, showNotification } from '../lib/notify';

/** How the dashboard stays live on a serverless backend (no WebSocket). */
const STATUS_POLL_MS = 20_000;
const ALERT_POLL_MS = 10_000;
/** While open during market hours, the dashboard also drives the evaluator (the server dedupes). */
const TICK_MS = 30_000;
/** A run older than this during market hours means the scheduler isn't firing. */
export const STALE_RUN_MS = 3 * 60_000;

export type LiveHealth = 'live' | 'stale' | 'market-closed' | 'kite-offline' | 'unknown';

interface LiveValue {
  status: LiveStatus | undefined;
  health: LiveHealth;
}

const LiveContext = createContext<LiveValue | null>(null);

function healthOf(s: LiveStatus | undefined): LiveHealth {
  if (!s) return 'unknown';
  if (!s.kiteConnected) return 'kite-offline';
  if (!s.marketOpen) return 'market-closed';
  if (s.activeMonitors > 0 && (!s.lastRunAt || Date.now() - Date.parse(s.lastRunAt) > STALE_RUN_MS)) return 'stale';
  return 'live';
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const seen = useRef<Set<string> | null>(null);

  const status = useQuery({ queryKey: ['live-status'], queryFn: api.liveStatus, refetchInterval: STATUS_POLL_MS });

  // New-alert detection: diff the latest alerts against what this tab has seen.
  const latest = useQuery({
    queryKey: ['alerts', 'latest'],
    queryFn: () => api.listAlerts({ limit: 25 }),
    refetchInterval: ALERT_POLL_MS,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const list = latest.data;
    if (!list) return;
    if (!seen.current) {
      seen.current = new Set(list.map((a) => a.id)); // first load: don't notify history
      return;
    }
    const fresh: Alert[] = list.filter((a) => !seen.current!.has(a.id));
    if (fresh.length === 0) return;
    fresh.forEach((a) => seen.current!.add(a.id));
    void qc.invalidateQueries({ queryKey: ['alerts'], predicate: (q) => q.queryKey[1] !== 'latest' });
    void qc.invalidateQueries({ queryKey: ['analytics'] });
    void qc.invalidateQueries({ queryKey: ['snapshots'] });
    const prefs = qc.getQueryData<UserPreferences>(['preferences']);
    for (const a of fresh.slice(0, 3)) {
      if (prefs?.browserNotifications !== false) {
        const detail = a.scenario ? `Scenario ${a.scenario}` : (a.variant ?? a.strategyName ?? 'Triggered');
        showNotification(a.title, `${detail} · ${a.underlying} ${a.strike} · ${a.timeframe}`);
      }
    }
    if (prefs?.soundEnabled !== false) playChime();
  }, [latest.data, qc]);

  // Dashboard-driven evaluation fallback (works even without an external cron).
  const canTick = Boolean(status.data?.kiteConnected && status.data.marketOpen && status.data.activeMonitors > 0);
  useEffect(() => {
    if (!canTick) return;
    const tick = async () => {
      try {
        const r = await api.liveTick();
        if (r.ran) {
          void qc.invalidateQueries({ queryKey: ['snapshots'] });
          void qc.invalidateQueries({ queryKey: ['live-status'] });
          if (r.alerts > 0) void latest.refetch();
        }
      } catch {
        /* transient — the next interval retries */
      }
    };
    void tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTick, qc]);

  const value = useMemo<LiveValue>(() => ({ status: status.data, health: healthOf(status.data) }), [status.data]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const v = useContext(LiveContext);
  if (!v) throw new Error('useLive must be used within LiveProvider');
  return v;
}
