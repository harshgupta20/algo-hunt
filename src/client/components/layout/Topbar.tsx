'use client';

/**
 * The app header, in two looks (src/client/theme/look.ts) that show the same things:
 *   classic  one brand-blue bar (sidebar toggle, logo, status, actions) above the sidebar
 *   fresh    a white bar with the navigation across the top + a thin status strip under it (no sidebar)
 * Both are rendered; CSS shows the one for the active look (`.look-classic` / `.look-fresh`).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, BellOff, Link2, LogOut, Moon, Palette, PanelLeftClose, PanelLeftOpen, Sun, Wifi } from 'lucide-react';
import { v2Api, type MarketStatus } from '../../v2/api';
import { useKiteStatus } from '../../hooks/useKiteStatus';
import { api } from '../../lib/api';
import { canNotify, requestNotificationPermission } from '../../lib/notify';
import { useThemePreference } from '../../theme/useThemePreference';
import { setLook } from '../../theme/look';
import { Logo } from '../Logo';
import { Tooltip } from '../Tooltip';
import { IconButton } from '../ui';
import { HELP } from '../../lib/help';
import { AiTopbar } from '../../ai/AiTopbar';
import { NAV } from './Sidebar';

const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Minutes since midnight in IST (sessions are IST). */
const istMinute = (ms: number) => Math.floor((ms / 60_000 + 330) % 1440);

type Variant = 'brand' | 'plain';

/** Classes per look: on the brand-blue bar (classic) or on the light status strip (fresh). */
const V = {
  brand: {
    chip: 'bg-white/15 border border-white/25 text-white',
    text: 'text-white',
    dim: 'text-white/85',
    sep: 'bg-white/30',
    dotRing: 'ring-2 ring-white/70',
    icon: 'text-white/70',
    btn: 'btn-glass',
    liveOn: 'bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.3)]',
    liveOff: 'border-2 border-white/60',
    connecting: 'bg-white/80',
    kite: 'btn bg-white text-warn border border-white hover:bg-white/90 text-xs font-semibold',
  },
  plain: {
    chip: 'bg-ink-900 border border-ink-700 text-slate-200',
    text: 'text-slate-200',
    dim: 'text-slate-400',
    sep: 'bg-ink-600',
    dotRing: 'ring-2 ring-ink-900',
    icon: 'text-slate-500',
    btn: 'btn-ghost',
    liveOn: 'bg-accent shadow-[0_0_0_3px_rgb(var(--accent)/0.2)]',
    liveOff: 'border-2 border-slate-500',
    connecting: 'bg-slate-500',
    kite: 'btn-ghost py-1 text-xs font-semibold text-warn border-warn/40',
  },
} satisfies Record<Variant, Record<string, string>>;

/**
 * A market's state at a glance: a solid green pill with a pulsing dot while it's open ("Open · till 15:30"), a grey
 * one while it's shut ("Closed · opens 09:15", "Closed", "Holiday", "Weekend"). Green here means "live market" —
 * the header's one exception to green = up. Fixed colours, so it reads the same on the blue bar and the light strip.
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

/** Status the header shows: markets, Kite, the live feed, saves waiting for the database. */
function useShellStatus() {
  const status = useQuery({ queryKey: ['v2-status'], queryFn: v2Api.status, refetchInterval: 30_000 });
  const live = useQuery({ queryKey: ['v2-live'], queryFn: v2Api.live, refetchInterval: 30_000 });
  const kite = useKiteStatus();
  const s = status.data;
  // Records the app is holding because the database can't be reached (a moment of catching up isn't shown).
  const waiting = !!s?.database && s.database.count > 0 && (s.database.failingSince !== null || (s.database.oldestAt !== null && s.now - Date.parse(s.database.oldestAt) > 30_000));
  return { s, worker: live.data?.health.covering, waiting, needsKiteLogin: kite.data?.enabled && kite.data.needsLogin };
}

function StatusItems({ v }: { v: Variant }) {
  const c = V[v];
  const { s, worker, waiting, needsKiteLogin } = useShellStatus();
  return (
    <>
      {needsKiteLogin && (
        <Tooltip content={HELP.topbar.connectKite} side="bottom">
          <button
            className={c.kite}
            onClick={() => {
              window.location.href = api.kiteLoginUrl;
            }}
          >
            <Link2 className="w-4 h-4" /> Connect Kite
          </button>
        </Tooltip>
      )}
      <div className="flex items-center gap-3 text-xs">
        <Wifi className={clsx('w-4 h-4', c.icon)} />
        {!s ? (
          <Tooltip content={HELP.topbar.connecting} side="bottom">
            <span className={clsx('flex items-center gap-1.5 font-medium cursor-help', c.text)} tabIndex={0}>
              <span className={clsx('w-2 h-2 rounded-full animate-pulse', c.connecting)} /> Connecting
            </span>
          </Tooltip>
        ) : (
          <>
            {waiting && s.database && (
              <>
                <Tooltip
                  content={{
                    ...HELP.topbar.savesWaiting,
                    note:
                      s.database.blocked > 0 && s.database.failingSince === null
                        ? `${s.database.blocked} record(s) the database refuses because its tables are older than the app${s.database.lastError ? ` (${s.database.lastError})` : ''} — restart the app (or run npm run db:migrate) to update them. Everything else is saved as usual. Settings → Database shows the details.`
                        : `${s.database.count} record(s) waiting${s.database.failingSince ? ` since ${new Date(s.database.failingSince).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST` : ''}${s.database.lastError ? ` — ${s.database.lastError}` : ''}. Settings → Database shows the details.`,
                  }}
                  side="bottom"
                >
                  <span className={clsx('flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium cursor-help', c.chip)} tabIndex={0}>
                    <span className={clsx('w-2 h-2 rounded-full bg-warn', c.dotRing)} /> {s.database.count} not saved yet
                  </span>
                </Tooltip>
                <span aria-hidden className={clsx('h-4 w-px', c.sep)} />
              </>
            )}
            {!s.kiteConnected && (
              <>
                <Tooltip content={HELP.topbar.kiteOffline} side="bottom">
                  <span className={clsx('flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium cursor-help', c.chip)} tabIndex={0}>
                    <span className={clsx('w-2 h-2 rounded-full bg-bear', c.dotRing)} /> Kite offline
                  </span>
                </Tooltip>
                <span aria-hidden className={clsx('h-4 w-px', c.sep)} />
              </>
            )}
            <Market name="NSE/BSE" m={s.markets.NSE} now={s.now} help={HELP.topbar.nseMarket} />
            <Market name="MCX" m={s.markets.MCX} now={s.now} help={HELP.topbar.mcxMarket} />
            {s.connections.enabled > 0 && (
              <>
                <span aria-hidden className={clsx('h-4 w-px', c.sep)} />
                <Tooltip content={worker ? HELP.topbar.liveWorker : HELP.topbar.scanner} side="bottom">
                  <span className={clsx('hidden lg:flex items-center gap-1.5 cursor-help', c.dim)} tabIndex={0}>
                    <span className={clsx('w-2 h-2 rounded-full', worker ? c.liveOn : c.liveOff)} />
                    {worker ? 'Live feed' : 'Scanner'}
                  </span>
                </Tooltip>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Desktop notifications: on (a label) or a button to allow them. */
function NotifyControl({ v, compact }: { v: Variant; compact?: boolean }) {
  const [perm, setPerm] = useState<NotificationPermission>('default');
  useEffect(() => {
    setPerm(canNotify() ? Notification.permission : 'denied');
  }, []);
  const enable = async () => setPerm(await requestNotificationPermission());
  if (perm === 'granted') {
    return (
      <Tooltip content={HELP.topbar.notificationsOn} side="bottom">
        <span className={clsx('flex items-center gap-1.5 text-xs font-medium cursor-help', V[v].text)} tabIndex={0}>
          <Bell className="w-4 h-4" /> {compact ? <span className="sr-only">Notifications on</span> : 'Notifications on'}
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={HELP.topbar.notificationsOff} side="bottom">
      <button className={clsx(V[v].btn, 'text-xs', v === 'plain' && 'py-1.5')} onClick={enable}>
        <BellOff className="w-4 h-4" /> {compact ? <span className="hidden xl:inline">Notify me</span> : 'Enable notifications'}
        {compact && <span className="sr-only xl:hidden">Enable notifications</span>}
      </button>
    </Tooltip>
  );
}

function ThemeButton({ v }: { v: Variant }) {
  const { theme, setTheme } = useThemePreference();
  return (
    <IconButton help={theme === 'dark' ? HELP.topbar.toLight : HELP.topbar.toDark} side="bottom" className={clsx(V[v].btn, 'text-xs', v === 'plain' && 'px-2 py-1.5')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </IconButton>
  );
}

const signOut = async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
};

/** Classic: the brand-blue bar above the sidebar. */
export function Topbar({ collapsed, onToggleSidebar }: { collapsed: boolean; onToggleSidebar: () => void }) {
  return (
    <header className="look-classic bg-brand h-16 shrink-0 shadow-sm flex items-center justify-between gap-4 pl-3 pr-6 text-white">
      <div className="flex items-center gap-3 min-w-0">
        <IconButton help={collapsed ? HELP.nav.expand : HELP.nav.collapse} side="bottom" className="btn-glass px-2" onClick={onToggleSidebar}>
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </IconButton>
        <Logo onBrand height={30} />
      </div>
      <div className="flex items-center justify-end gap-3 min-w-0">
        <StatusItems v="brand" />
        <AiTopbar />
        <NotifyControl v="brand" />
        <Tooltip content={HELP.topbar.lookFresh} side="bottom">
          <button type="button" className="btn-glass text-xs" onClick={() => setLook('fresh')}>
            <Palette className="w-4 h-4" /> New look
          </button>
        </Tooltip>
        <ThemeButton v="brand" />
        <IconButton help={HELP.topbar.signOut} side="bottom" className="btn-glass text-xs" onClick={signOut}>
          <LogOut className="w-4 h-4" />
        </IconButton>
      </div>
    </header>
  );
}

/** Fresh: a white bar with the sections across the top, and a thin status strip under it. */
export function FreshHeader() {
  const pathname = usePathname();
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  return (
    <header className="look-fresh shrink-0 border-b border-ink-700 bg-ink-900">
      <div className="flex h-14 min-w-0 items-stretch gap-3 px-5 lg:gap-6">
        <Link href="/v2" aria-label="Algo Hunt — home" className="flex shrink-0 items-center">
          <Logo height={28} />
        </Link>
        <nav aria-label="Sections" className="flex min-w-0 items-stretch gap-0.5 lg:gap-1">
          {NAV.map(({ to, label, icon: Icon, help }) => {
            const on = isActive(to);
            return (
              <Tooltip key={to} content={help} side="bottom" className="flex">
                <Link
                  href={to}
                  aria-current={on ? 'page' : undefined}
                  className={clsx(
                    'flex items-center gap-2 whitespace-nowrap border-b-2 px-2.5 text-sm transition-colors lg:px-3',
                    on ? 'border-accent font-semibold text-accent' : 'border-transparent text-slate-300 hover:border-ink-600 hover:text-fg',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {/* Icons only on narrow screens; the tooltip names the section. */}
                  <span className="hidden lg:inline">{label}</span>
                  <span className="sr-only lg:hidden">{label}</span>
                </Link>
              </Tooltip>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap">
          <AiTopbar variant="plain" />
          <NotifyControl v="plain" compact />
          <ThemeButton v="plain" />
          <IconButton help={HELP.topbar.signOut} side="bottom" className="btn-ghost px-2 py-1.5 text-xs" onClick={signOut}>
            <LogOut className="w-4 h-4" />
          </IconButton>
        </div>
      </div>
      <div className="flex h-10 min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-ink-700/70 bg-gradient-to-r from-accent/[0.07] via-accent/[0.03] to-transparent px-5">
        <StatusItems v="plain" />
      </div>
    </header>
  );
}
