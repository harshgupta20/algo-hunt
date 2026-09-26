'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, BellOff, Link2, LogOut, Moon, Sun, Wifi } from 'lucide-react';
import { v2Api, type MarketStatus } from '../../v2/api';
import { useKiteStatus } from '../../hooks/useKiteStatus';
import { api } from '../../lib/api';
import { canNotify, requestNotificationPermission } from '../../lib/notify';
import { useThemePreference } from '../../theme/useThemePreference';
import { Tooltip } from '../Tooltip';
import { IconButton } from '../ui';
import { HELP } from '../../lib/help';

const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "NSE/BSE ● Open" / "MCX ● Closed" with today's session in the tooltip. */
function Market({ name, m, help }: { name: string; m: MarketStatus; help: { title: string; body: string } }) {
  const hours = m.today.trading ? `Today: ${clock(m.today.openMin)}–${clock(m.today.closeMin)} IST.` : (m.today.note ?? 'No session today.');
  return (
    <Tooltip side="bottom" content={{ title: `${help.title} — ${m.open ? 'Open' : 'Closed'}`, body: help.body, note: hours }}>
      <span className="flex items-center gap-1.5 cursor-help" tabIndex={0}>
        <span className="font-semibold text-slate-200">{name}</span>
        <span className={clsx('w-2 h-2 rounded-full', m.open ? 'bg-bull' : 'bg-slate-500')} />
        <span className={clsx('font-medium', m.open ? 'text-bull' : 'text-slate-500')}>{m.open ? 'Open' : 'Closed'}</span>
      </span>
    </Tooltip>
  );
}

export function Topbar() {
  const status = useQuery({ queryKey: ['v2-status'], queryFn: v2Api.status, refetchInterval: 30_000 });
  const live = useQuery({ queryKey: ['v2-live'], queryFn: v2Api.live, refetchInterval: 30_000 });
  const kite = useKiteStatus();
  const { theme, setTheme } = useThemePreference();
  const [perm, setPerm] = useState<NotificationPermission>('default');

  useEffect(() => {
    setPerm(canNotify() ? Notification.permission : 'denied');
  }, []);

  const enable = async () => setPerm(await requestNotificationPermission());
  const needsKiteLogin = kite.data?.enabled && kite.data.needsLogin;
  const s = status.data;
  const worker = live.data?.health.covering;

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <header className="h-16 shrink-0 border-b border-ink-700/60 bg-ink-900/60 backdrop-blur flex items-center justify-end gap-3 px-6">
      {needsKiteLogin && (
        <Tooltip content={HELP.topbar.connectKite} side="bottom">
          <button
            className="btn bg-warn/15 text-warn border border-warn/30 hover:bg-warn/25 text-xs"
            onClick={() => {
              window.location.href = api.kiteLoginUrl;
            }}
          >
            <Link2 className="w-4 h-4" /> Connect Kite
          </button>
        </Tooltip>
      )}
      <div className="flex items-center gap-3 text-xs">
        <Wifi className="w-4 h-4 text-slate-500" />
        {!s ? (
          <Tooltip content={HELP.topbar.connecting} side="bottom">
            <span className="flex items-center gap-1.5 font-medium text-warn cursor-help" tabIndex={0}>
              <span className="w-2 h-2 rounded-full bg-warn animate-pulse" /> Connecting
            </span>
          </Tooltip>
        ) : (
          <>
            {!s.kiteConnected && (
              <>
                <Tooltip content={HELP.topbar.kiteOffline} side="bottom">
                  <span className="flex items-center gap-1.5 font-medium text-bear cursor-help" tabIndex={0}>
                    <span className="w-2 h-2 rounded-full bg-bear" /> Kite offline
                  </span>
                </Tooltip>
                <span aria-hidden className="h-4 w-px bg-ink-700" />
              </>
            )}
            <Market name="NSE/BSE" m={s.markets.NSE} help={HELP.topbar.nseMarket} />
            <span aria-hidden className="h-4 w-px bg-ink-700" />
            <Market name="MCX" m={s.markets.MCX} help={HELP.topbar.mcxMarket} />
            {s.connections.enabled > 0 && (
              <>
                <span aria-hidden className="h-4 w-px bg-ink-700" />
                <Tooltip content={worker ? HELP.topbar.liveWorker : HELP.topbar.scanner} side="bottom">
                  <span className="hidden lg:flex items-center gap-1.5 cursor-help text-slate-400" tabIndex={0}>
                    <span className={clsx('w-2 h-2 rounded-full', worker ? 'bg-bull' : 'border-2 border-slate-500')} />
                    {worker ? 'Live feed' : 'Scanner'}
                  </span>
                </Tooltip>
              </>
            )}
          </>
        )}
      </div>
      {perm === 'granted' ? (
        <Tooltip content={HELP.topbar.notificationsOn} side="bottom">
          <span className="flex items-center gap-1.5 text-xs text-bull cursor-help" tabIndex={0}>
            <Bell className="w-4 h-4" /> Notifications on
          </span>
        </Tooltip>
      ) : (
        <Tooltip content={HELP.topbar.notificationsOff} side="bottom">
          <button className="btn-ghost text-xs" onClick={enable}>
            <BellOff className="w-4 h-4" /> Enable notifications
          </button>
        </Tooltip>
      )}
      <IconButton
        help={theme === 'dark' ? HELP.topbar.toLight : HELP.topbar.toDark}
        side="bottom"
        className="btn-ghost text-xs"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </IconButton>
      <IconButton help={HELP.topbar.signOut} side="bottom" className="btn-ghost text-xs" onClick={signOut}>
        <LogOut className="w-4 h-4" />
      </IconButton>
    </header>
  );
}
