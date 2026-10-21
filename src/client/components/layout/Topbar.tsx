'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, BellOff, Link2, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Sun, Wifi } from 'lucide-react';
import { v2Api, type MarketStatus } from '../../v2/api';
import { useKiteStatus } from '../../hooks/useKiteStatus';
import { api } from '../../lib/api';
import { canNotify, requestNotificationPermission } from '../../lib/notify';
import { useThemePreference } from '../../theme/useThemePreference';
import { Logo } from '../Logo';
import { Tooltip } from '../Tooltip';
import { IconButton } from '../ui';
import { HELP } from '../../lib/help';
import { AiTopbar } from '../../ai/AiTopbar';

const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Minutes since midnight in IST (sessions are IST). */
const istMinute = (ms: number) => Math.floor((ms / 60_000 + 330) % 1440);

/**
 * A market's state at a glance: a solid green pill with a pulsing dot while it's open ("Open · till 15:30"), a grey
 * one while it's shut ("Closed · opens 09:15", "Closed", "Holiday", "Weekend"). Green here means "live market" —
 * the top bar's one exception to green = up. Fixed colours: the header is brand blue in both themes.
 */
function Market({ name, m, now, help }: { name: string; m: MarketStatus; now: number; help: { title: string; body: string } }) {
  const t = m.today;
  const [label, detail] = m.open
    ? ['Open', `till ${clock(t.closeMin)}`]
    : !t.trading
      ? [t.note ? 'Holiday' : 'Weekend', null]
      : istMinute(now) < t.openMin
        ? ['Closed', `opens ${clock(t.openMin)}`]
        : ['Closed', null];
  const hours = t.trading ? `Today: ${clock(t.openMin)}–${clock(t.closeMin)} IST${t.note ? ` (${t.note})` : ''}.` : `${t.note ?? 'Weekend'} — no session today.`;
  return (
    <Tooltip side="bottom" content={{ title: `${help.title} — ${label}${detail ? ` ${detail}` : ''}`, body: help.body, note: hours }}>
      <span
        className={clsx(
          'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 cursor-help whitespace-nowrap',
          m.open ? 'bg-green-600 ring-1 ring-white/50 text-white shadow-sm' : 'bg-gray-500 text-white/90',
        )}
        tabIndex={0}
      >
        {m.open ? (
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-white" />
          </span>
        ) : (
          <span className="w-2 h-2 rounded-full border-2 border-white/70" />
        )}
        <span className="font-semibold">{name}</span>
        <span className={clsx('uppercase tracking-wide text-[10px]', m.open ? 'font-bold' : 'font-medium')}>{label}</span>
        {detail && <span className={clsx('text-[10px]', m.open ? 'text-white/90' : 'text-white/75')}>· {detail}</span>}
      </span>
    </Tooltip>
  );
}

export function Topbar({ collapsed, onToggleSidebar }: { collapsed: boolean; onToggleSidebar: () => void }) {
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
  // Records the app is holding because the database can't be reached (a moment of catching up isn't shown).
  const waiting = !!s?.database && s.database.count > 0 && (s.database.failingSince !== null || (s.database.oldestAt !== null && s.now - Date.parse(s.database.oldestAt) > 30_000));

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <header className="bg-brand h-16 shrink-0 shadow-sm flex items-center justify-between gap-4 pl-3 pr-6 text-white">
      <div className="flex items-center gap-3 min-w-0">
        <IconButton help={collapsed ? HELP.nav.expand : HELP.nav.collapse} side="bottom" className="btn-glass px-2" onClick={onToggleSidebar}>
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </IconButton>
        <Logo onBrand height={30} />
      </div>
      <div className="flex items-center justify-end gap-3 min-w-0">
      {needsKiteLogin && (
        <Tooltip content={HELP.topbar.connectKite} side="bottom">
          <button
            className="btn bg-white text-warn border border-white hover:bg-white/90 text-xs font-semibold"
            onClick={() => {
              window.location.href = api.kiteLoginUrl;
            }}
          >
            <Link2 className="w-4 h-4" /> Connect Kite
          </button>
        </Tooltip>
      )}
      <div className="flex items-center gap-3 text-xs">
        <Wifi className="w-4 h-4 text-white/70" />
        {!s ? (
          <Tooltip content={HELP.topbar.connecting} side="bottom">
            <span className="flex items-center gap-1.5 font-medium text-white cursor-help" tabIndex={0}>
              <span className="w-2 h-2 rounded-full bg-white/80 animate-pulse" /> Connecting
            </span>
          </Tooltip>
        ) : (
          <>
            {waiting && s.database && (
              <>
                <Tooltip
                  content={{
                    ...HELP.topbar.savesWaiting,
                    note: s.database.blocked > 0 && s.database.failingSince === null
                      ? `${s.database.blocked} record(s) the database refuses because its tables are older than the app${s.database.lastError ? ` (${s.database.lastError})` : ''} — restart the app (or run npm run db:migrate) to update them. Everything else is saved as usual. Settings → Database shows the details.`
                      : `${s.database.count} record(s) waiting${s.database.failingSince ? ` since ${new Date(s.database.failingSince).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST` : ''}${s.database.lastError ? ` — ${s.database.lastError}` : ''}. Settings → Database shows the details.`,
                  }}
                  side="bottom"
                >
                  <span className="flex items-center gap-1.5 rounded-full bg-white/15 border border-white/25 px-2 py-0.5 font-medium text-white cursor-help" tabIndex={0}>
                    <span className="w-2 h-2 rounded-full bg-warn ring-2 ring-white/70" /> {s.database.count} not saved yet
                  </span>
                </Tooltip>
                <span aria-hidden className="h-4 w-px bg-white/30" />
              </>
            )}
            {!s.kiteConnected && (
              <>
                <Tooltip content={HELP.topbar.kiteOffline} side="bottom">
                  <span className="flex items-center gap-1.5 rounded-full bg-white/15 border border-white/25 px-2 py-0.5 font-medium text-white cursor-help" tabIndex={0}>
                    <span className="w-2 h-2 rounded-full bg-bear ring-2 ring-white/70" /> Kite offline
                  </span>
                </Tooltip>
                <span aria-hidden className="h-4 w-px bg-white/30" />
              </>
            )}
            <Market name="NSE/BSE" m={s.markets.NSE} now={s.now} help={HELP.topbar.nseMarket} />
            <Market name="MCX" m={s.markets.MCX} now={s.now} help={HELP.topbar.mcxMarket} />
            {s.connections.enabled > 0 && (
              <>
                <span aria-hidden className="h-4 w-px bg-white/30" />
                <Tooltip content={worker ? HELP.topbar.liveWorker : HELP.topbar.scanner} side="bottom">
                  <span className="hidden lg:flex items-center gap-1.5 cursor-help text-white/85" tabIndex={0}>
                    <span className={clsx('w-2 h-2 rounded-full', worker ? 'bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.3)]' : 'border-2 border-white/60')} />
                    {worker ? 'Live feed' : 'Scanner'}
                  </span>
                </Tooltip>
              </>
            )}
          </>
        )}
      </div>
      <AiTopbar />
      {perm === 'granted' ? (
        <Tooltip content={HELP.topbar.notificationsOn} side="bottom">
          <span className="flex items-center gap-1.5 text-xs font-medium text-white cursor-help" tabIndex={0}>
            <Bell className="w-4 h-4" /> Notifications on
          </span>
        </Tooltip>
      ) : (
        <Tooltip content={HELP.topbar.notificationsOff} side="bottom">
          <button className="btn-glass text-xs" onClick={enable}>
            <BellOff className="w-4 h-4" /> Enable notifications
          </button>
        </Tooltip>
      )}
      <IconButton
        help={theme === 'dark' ? HELP.topbar.toLight : HELP.topbar.toDark}
        side="bottom"
        className="btn-glass text-xs"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </IconButton>
      <IconButton help={HELP.topbar.signOut} side="bottom" className="btn-glass text-xs" onClick={signOut}>
        <LogOut className="w-4 h-4" />
      </IconButton>
      </div>
    </header>
  );
}
