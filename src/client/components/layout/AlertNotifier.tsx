'use client';

/**
 * Desktop notification + chime for every new V2 alert while the app is open
 * (per Settings → Notifications). Also refreshes the V2 alert lists.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserPreferences } from '@ash/shared';
import { unitText } from '@/shared/v2';
import { v2Api } from '../../v2/api';
import { api } from '../../lib/api';
import { playChime, showNotification } from '../../lib/notify';

const POLL_MS = 10_000;
const symbolOf = (productId: string) => productId.split(':')[1] ?? productId;

export function AlertNotifier() {
  const qc = useQueryClient();
  const seen = useRef<Set<string> | null>(null);
  useQuery({ queryKey: ['preferences'], queryFn: api.getPreferences });
  const latest = useQuery({ queryKey: ['v2-alerts', 'notify'], queryFn: () => v2Api.alerts({ limit: 25 }), refetchInterval: POLL_MS, refetchIntervalInBackground: true });

  useEffect(() => {
    const list = latest.data;
    if (!list) return;
    if (!seen.current) {
      seen.current = new Set(list.map((a) => a.id)); // first load: don't notify history
      return;
    }
    const fresh = list.filter((a) => !seen.current!.has(a.id));
    if (!fresh.length) return;
    fresh.forEach((a) => seen.current!.add(a.id));
    void qc.invalidateQueries({ queryKey: ['v2-alerts'], predicate: (q) => q.queryKey[1] !== 'notify' });
    const prefs = qc.getQueryData<UserPreferences>(['preferences']);
    if (prefs?.browserNotifications !== false) {
      for (const a of fresh.slice(0, 3)) showNotification(`🔔 ${a.strategyName}`, unitText(a.unit, symbolOf(a.productId)));
    }
    if (prefs?.soundEnabled !== false) playChime();
  }, [latest.data, qc]);

  return null;
}
