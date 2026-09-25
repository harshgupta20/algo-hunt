'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from '../Tooltip';
import { HELP } from '../../lib/help';
import clsx from 'clsx';
import { Activity, BellRing, Coins, Gem, LayoutDashboard, Settings, SlidersHorizontal, Workflow } from 'lucide-react';

const NAV = [
  // Overview: live monitors, latest alerts and performance analytics.
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, help: HELP.nav.dashboard },
  // Live feed + full history (Feed / Table views).
  { to: '/alerts', label: 'Alerts', icon: BellRing, help: HELP.nav.alerts },
  // Library, Builder and Backtest (tabs).
  { to: '/strategies', label: 'Strategies', icon: Workflow, help: HELP.nav.strategies },
  { to: '/configuration', label: 'Configuration', icon: SlidersHorizontal, help: HELP.nav.configuration },
  // MCX commodities: products, commodity monitors and backtests in their own session.
  { to: '/mcx', label: 'MCX', icon: Coins, help: HELP.nav.mcx },
  // MCX V2 (beta): the independent MCX alerting subsystem, alongside the current MCX tab.
  { to: '/mcx-v2', label: 'MCX V2 · beta', icon: Gem, help: HELP.nav.mcxV2 },
  { to: '/settings', label: 'Settings', icon: Settings, help: HELP.nav.settings },
]

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (to: string, end?: boolean) => (end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`));
  return (
    <aside className="w-60 shrink-0 border-r border-ink-700/60 bg-ink-900 flex flex-col">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-ink-700/60">
        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
          <Activity className="w-5 h-5 text-accent-soft" />
        </div>
        <div>
          <div className="text-fg font-semibold leading-tight">Algo Hunt</div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Alert Platform</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(({ to, label, icon: Icon, end, help }) => (
          <Tooltip key={to} content={help} side="right" className="flex">
          <Link
            href={to}
            className={clsx(
              'flex-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive(to, end) ? 'bg-accent/15 text-fg' : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
          </Tooltip>
        ))}
      </nav>
      <div className="p-4 text-[10px] text-slate-600 border-t border-ink-700/60">
        RSI Synchronized Strategy · v0.2
      </div>
    </aside>
  );
}
