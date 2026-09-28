'use client';

/**
 * New V2 alerts while the app is open: the alert alarm (tune repeating until stopped, per Settings →
 * Notifications), a sticky desktop notification, a flashing tab title and an alert card at the top of
 * the page with View / Stop. Also refreshes the V2 alert lists.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Volume2, VolumeX } from 'lucide-react';
import type { UserPreferences } from '@ash/shared';
import { unitText } from '@/shared/v2';
import { v2Api } from '../../v2/api';
import { api } from '../../lib/api';
import { HELP } from '../../lib/help';
import { playAlarmNow, raiseAlarm, showNotification, stopAlarm, subscribeAlarm, unlockAudio, type AlarmState } from '../../lib/notify';
import { Tooltip } from '../Tooltip';

const POLL_MS = 5_000;
const symbolOf = (productId: string) => productId.split(':')[1] ?? productId;

export function AlertNotifier() {
  const qc = useQueryClient();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  /** Newest alert time seen: each poll asks only for alerts after it (usually none — a few bytes). */
  const cursor = useRef<string | null>(null);
  const [alarm, setAlarm] = useState<AlarmState>({ active: false, blocked: false, items: [] });
  useQuery({ queryKey: ['preferences'], queryFn: api.getPreferences });
  const latest = useQuery({
    queryKey: ['v2-alerts', 'notify'],
    queryFn: () => v2Api.alertFeed(cursor.current, seen.current ? 25 : 1),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });

  useEffect(() => subscribeAlarm(setAlarm), []);

  // Browsers allow sound only after an interaction: unlock on the first click / key press.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    const list = latest.data;
    if (!list) return;
    if (list[0] && (!cursor.current || list[0].createdAt > cursor.current)) cursor.current = list[0].createdAt;
    if (!seen.current) {
      seen.current = new Set(list.map((a) => a.id)); // first load: don't ring for history
      return;
    }
    const fresh = list.filter((a) => !seen.current!.has(a.id));
    if (!fresh.length) return;
    fresh.forEach((a) => seen.current!.add(a.id));
    void qc.invalidateQueries({ queryKey: ['v2-alerts'], predicate: (q) => q.queryKey[1] !== 'notify' });
    void qc.invalidateQueries({ queryKey: ['v2-paper'] }); // an alert opens a paper trade
    const prefs = qc.getQueryData<UserPreferences>(['preferences']);
    const items = fresh.map((a) => ({ id: a.id, title: a.strategyName, detail: unitText(a.unit, symbolOf(a.productId)) }));
    raiseAlarm(items, { sound: prefs?.soundEnabled !== false, repeat: prefs?.soundRepeat !== false });
    if (prefs?.browserNotifications !== false) {
      for (const i of items.slice(0, 3)) showNotification(`🔔 ${i.title}`, i.detail, { sticky: true, tag: i.id, onClick: stopAlarm });
    }
  }, [latest.data, qc]);

  if (!alarm.active) return null;
  const n = alarm.items.length;
  const view = () => {
    stopAlarm();
    router.push('/v2?tab=alerts');
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
      <div role="alert" aria-live="assertive" className="alarm-card pointer-events-auto w-full max-w-xl rounded-xl border-2 border-warn bg-ink-900 p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="alarm-bell mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn text-white">
            <BellRing className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-fg">{n === 1 ? 'New alert' : `${n} new alerts`}</p>
            {alarm.items.slice(0, 3).map((i) => (
              <p key={i.id} className="truncate text-sm text-slate-300">
                <span className="font-semibold text-slate-200">{i.title}</span> · {i.detail}
              </p>
            ))}
            {n > 3 && <p className="text-xs text-slate-500">+{n - 3} more</p>}
            {alarm.blocked && <p className="mt-1 text-xs font-medium text-warn">Your browser blocked the sound — press “Play sound”.</p>}
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <Tooltip content={HELP.alarm.view} side="left">
              <button type="button" className="btn-primary text-xs justify-center" onClick={view}>
                <BellRing className="h-4 w-4" /> View
              </button>
            </Tooltip>
            {alarm.blocked ? (
              <Tooltip content={HELP.alarm.play} side="left">
                <button type="button" className="btn text-xs justify-center bg-warn text-white hover:bg-warn/90" onClick={playAlarmNow}>
                  <Volume2 className="h-4 w-4" /> Play sound
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={HELP.alarm.stop} side="left">
                <button type="button" className="btn-ghost text-xs justify-center" onClick={stopAlarm}>
                  <VolumeX className="h-4 w-4" /> Stop
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
