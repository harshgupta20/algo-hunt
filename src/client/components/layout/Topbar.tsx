'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { formatDistanceToNowStrict } from 'date-fns';
import { Bell, BellOff, Link2, LogOut, Moon, Sun, Wifi } from 'lucide-react';
import type { LiveStatus, Segment } from '@ash/shared';
import { STALE_RUN_MS, useLive } from '../../context/LiveContext';
import { useKiteStatus } from '../../hooks/useKiteStatus';
import { api } from '../../lib/api';
import { canNotify, requestNotificationPermission } from '../../lib/notify';
import { useThemePreference } from '../../theme/useThemePreference';
import { Tooltip, type TooltipContent } from '../Tooltip';
import { IconButton } from '../ui';
import { HELP } from '../../lib/help';

/**
 * Per-market state: is the session open, and are your monitors on it running?
 *  live    = open, monitors evaluated recently
 *  stale   = open with monitors, but no recent evaluation (scheduler idle)
 *  paused  = open with monitors, but Kite is offline
 *  unused  = open, no active monitor on this market
 *  closed  = outside the session
 */
type MarketState = 'live' | 'stale' | 'paused' | 'unused' | 'closed';

const MARKET_STYLE: Record<MarketState, { dot: string; text: string }> = {
  live: { dot: 'bg-bull', text: 'text-bull' },
  stale: { dot: 'bg-warn animate-pulse', text: 'text-warn' },
  paused: { dot: 'bg-warn', text: 'text-warn' },
  // Open but nothing running: hollow ring.
  unused: { dot: 'border-2 border-bull', text: 'text-slate-300' },
  closed: { dot: 'bg-slate-500', text: 'text-slate-500' },
};

const MARKET_INFO: Record<Segment, TooltipContent> = { NSE: HELP.topbar.nseMarket, MCX: HELP.topbar.mcxMarket };

function marketState(s: LiveStatus, segment: Segment): MarketState {
  const open = s.sessions?.[segment]?.open ?? (segment === 'NSE' && s.marketOpen);
  const active = s.activeBySegment?.[segment] ?? 0;
  if (!open) return 'closed';
  if (active === 0) return 'unused';
  if (!s.kiteConnected) return 'paused';
  if (!s.lastRunAt || Date.now() - Date.parse(s.lastRunAt) > STALE_RUN_MS) return 'stale';
  return 'live';
}

const istClock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });

/** "NSE/BSE ● Closed" / "MCX ● Live · 2 monitors" with its own explanation. */
function MarketStatus({ status, segment }: { status: LiveStatus; segment: Segment }) {
  const state = marketState(status, segment);
  const active = status.activeBySegment?.[segment] ?? 0;
  const monitors = `${active} monitor${active === 1 ? '' : 's'}`;
  const label =
    state === 'live'
      ? `Live · ${monitors}`
      : state === 'stale'
        ? `Open · ${monitors} · scheduler idle`
        : state === 'paused'
          ? `Open · ${monitors} paused`
          : state === 'unused'
            ? 'Open · no monitors'
            : active > 0
              ? `Closed · ${monitors} waiting`
              : 'Closed';
  const session = status.sessions?.[segment];
  const info = MARKET_INFO[segment];
  const style = MARKET_STYLE[state];
  return (
    <Tooltip
      side="bottom"
      content={{
        title: `${info.title} — ${label}`,
        body: HELP.topbar.marketState[state],
        note: [
          info.body,
          session && `Today: ${istClock(session.opensAt)}–${istClock(session.closesAt)} IST.`,
          `Active monitors here: ${active}.`,
        ]
          .filter(Boolean)
          .join(' '),
      }}
    >
      <span className="flex items-center gap-1.5 cursor-help" tabIndex={0}>
        <span className="font-semibold text-slate-200">{info.title}</span>
        <span className={clsx('w-2 h-2 rounded-full', style.dot)} />
        <span className={clsx('font-medium', style.text)}>{label}</span>
      </span>
    </Tooltip>
  );
}

export function Topbar() {
  const { status } = useLive();
  const kite = useKiteStatus();
  const { theme, setTheme } = useThemePreference();
  const [perm, setPerm] = useState<NotificationPermission>('default');

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
        {!status ? (
          <Tooltip content={HELP.topbar.connecting} side="bottom">
            <span className="flex items-center gap-1.5 font-medium text-warn cursor-help" tabIndex={0}>
              <span className="w-2 h-2 rounded-full bg-warn animate-pulse" /> Connecting
            </span>
          </Tooltip>
        ) : (
          <>
            {!status.kiteConnected && (
              <>
                <Tooltip content={HELP.topbar.kiteOffline} side="bottom">
                  <span className="flex items-center gap-1.5 font-medium text-bear cursor-help" tabIndex={0}>
                    <span className="w-2 h-2 rounded-full bg-bear" /> Kite offline
                  </span>
                </Tooltip>
                <span aria-hidden className="h-4 w-px bg-ink-700" />
              </>
            )}
            <MarketStatus status={status} segment="NSE" />
            <span aria-hidden className="h-4 w-px bg-ink-700" />
            <MarketStatus status={status} segment="MCX" />
            {status.activeMonitors > 0 && (
              <Tooltip content={HELP.topbar.lastRun} side="bottom">
                <span className="text-slate-500 hidden lg:inline cursor-help" tabIndex={0}>
                  · {lastRun}
                </span>
              </Tooltip>
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
