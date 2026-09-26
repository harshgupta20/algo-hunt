'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from '../Tooltip';
import { HELP } from '../../lib/help';
import clsx from 'clsx';
import { Activity, Layers, Settings } from 'lucide-react';

const NAV = [
  // V2: strategies connected to any product (NSE / BSE / MCX) → alerts.
  { to: '/v2', label: 'V2', icon: Layers, help: HELP.nav.v2 },
  // Kite login, appearance and desktop notifications.
  { to: '/settings', label: 'Settings', icon: Settings, help: HELP.nav.settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
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
        {NAV.map(({ to, label, icon: Icon, help }) => (
          <Tooltip key={to} content={help} side="right" className="flex">
          <Link
            href={to}
            className={clsx(
              'flex-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive(to) ? 'bg-accent/15 text-fg' : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
          </Tooltip>
        ))}
      </nav>
      <div className="p-4 text-[10px] text-slate-600 border-t border-ink-700/60">
        Strategy + Product = Alert
      </div>
    </aside>
  );
}
