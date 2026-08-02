import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Bell, BellOff, Link2, Wifi } from 'lucide-react';
import type { ProviderStatus } from '@ash/shared';
import { useLive } from '../../context/LiveContext';
import { useKiteStatus } from '../../hooks/useKiteStatus';
import { api } from '../../lib/api';
import { canNotify, requestNotificationPermission } from '../../lib/notify';

const STATUS_STYLE: Record<ProviderStatus, { label: string; dot: string; text: string }> = {
  connected: { label: 'Live', dot: 'bg-bull', text: 'text-bull' },
  connecting: { label: 'Connecting', dot: 'bg-warn animate-pulse', text: 'text-warn' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-warn animate-pulse', text: 'text-warn' },
  disconnected: { label: 'Offline', dot: 'bg-bear', text: 'text-bear' },
};

export function Topbar() {
  const { status } = useLive();
  const kite = useKiteStatus();
  const [perm, setPerm] = useState<NotificationPermission>(canNotify() ? Notification.permission : 'denied');
  const s = STATUS_STYLE[status];

  useEffect(() => {
    if (canNotify()) setPerm(Notification.permission);
  }, []);

  const enable = async () => setPerm(await requestNotificationPermission());
  const needsKiteLogin = kite.data?.enabled && kite.data.needsLogin;

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
      <div className="flex items-center gap-2 text-xs">
        <Wifi className="w-4 h-4 text-slate-500" />
        <span className={clsx('flex items-center gap-1.5 font-medium', s.text)}>
          <span className={clsx('w-2 h-2 rounded-full', s.dot)} />
          {s.label}
        </span>
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
    </header>
  );
}
