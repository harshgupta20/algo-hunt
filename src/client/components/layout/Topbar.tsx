'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { formatDistanceToNowStrict } from 'date-fns';
import { Bell, BellOff, Link2, LogOut, Moon, Sun, Wifi } from 'lucide-react';
import { useLive, type LiveHealth } from '../../context/LiveContext';
import { useKiteStatus } from '../../hooks/useKiteStatus';
import { api } from '../../lib/api';
import { canNotify, requestNotificationPermission } from '../../lib/notify';
import { useThemePreference } from '../../theme/useThemePreference';

const HEALTH_STYLE: Record<LiveHealth, { label: string; dot: string; text: string }> = {
  live: { label: 'Live', dot: 'bg-bull', text: 'text-bull' },
  stale: { label: 'Scheduler idle', dot: 'bg-warn animate-pulse', text: 'text-warn' },
  'market-closed': { label: 'Market closed', dot: 'bg-slate-500', text: 'text-slate-400' },
  'kite-offline': { label: 'Kite offline', dot: 'bg-bear', text: 'text-bear' },
  unknown: { label: 'Connecting', dot: 'bg-warn animate-pulse', text: 'text-warn' },
};

export function Topbar() {
  const { status, health } = useLive();
  const kite = useKiteStatus();
  const { theme, setTheme } = useThemePreference();
  const [perm, setPerm] = useState<NotificationPermission>('default');
  const s = HEALTH_STYLE[health];

  useEffect(() => {
    setPerm(canNotify() ? Notification.permission : 'denied');
  }, []);

  const enable = async () => setPerm(await requestNotificationPermission());
  const needsKiteLogin = kite.data?.enabled && kite.data.needsLogin;
  const lastRun = status?.lastRunAt ? `last run ${formatDistanceToNowStrict(new Date(status.lastRunAt))} ago` : 'no runs yet';

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <header className="h-16 shrink-0 border-b border-ink-700/60 bg-ink-900/60 backdrop-blur flex items-center justify-end gap-3 px-6">
      {needsKiteLogin && (
        <button
          className="btn bg-warn/15 text-warn border border-warn/30 hover:bg-warn/25 text-xs"
          onClick={() => {
            window.location.href = api.kiteLoginUrl;
          }}
        >
          <Link2 className="w-4 h-4" /> Connect Kite
        </button>
      )}
      <div className="flex items-center gap-2 text-xs" title={lastRun}>
        <Wifi className="w-4 h-4 text-slate-500" />
        <span className={clsx('flex items-center gap-1.5 font-medium', s.text)}>
          <span className={clsx('w-2 h-2 rounded-full', s.dot)} />
          {s.label}
        </span>
        {status && status.activeMonitors > 0 && <span className="text-slate-500 hidden md:inline">· {lastRun}</span>}
      </div>
      {perm === 'granted' ? (
        <span className="flex items-center gap-1.5 text-xs text-bull">
          <Bell className="w-4 h-4" /> Notifications on
        </span>
      ) : (
        <button className="btn-ghost text-xs" onClick={enable}>
          <BellOff className="w-4 h-4" /> Enable notifications
        </button>
      )}
      <button
        className="btn-ghost text-xs"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
      <button className="btn-ghost text-xs" onClick={signOut} title="Sign out">
        <LogOut className="w-4 h-4" />
      </button>
    </header>
  );
}
