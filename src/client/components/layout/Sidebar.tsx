'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from '../Tooltip';
import { HELP } from '../../lib/help';
import clsx from 'clsx';
import { Layers, Settings } from 'lucide-react';

const NAV = [
  // V2: strategies connected to any product (NSE / BSE / MCX) → alerts.
  { to: '/v2', label: 'V2', icon: Layers, help: HELP.nav.v2 },
  // Kite login, appearance and desktop notifications.
  { to: '/settings', label: 'Settings', icon: Settings, help: HELP.nav.settings },
];

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  return (
    <aside className={clsx('shrink-0 border-r border-ink-700/60 bg-ink-900 flex flex-col transition-[width] duration-200', collapsed ? 'w-16' : 'w-60')}>
      <nav className={clsx('flex-1 space-y-1', collapsed ? 'p-2' : 'p-3')}>
        {NAV.map(({ to, label, icon: Icon, help }) => (
          <Tooltip key={to} content={help} side="right" className="flex">
          <Link
            href={to}
            className={clsx(
              'flex-1 flex items-center gap-3 rounded-lg py-2 text-sm transition-colors',
              collapsed ? 'justify-center px-0' : 'px-3',
              isActive(to) ? 'bg-accent/10 text-accent-soft font-medium' : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200',
            )}
          >
            <Icon className={clsx('shrink-0', collapsed ? 'w-5 h-5' : 'w-4 h-4')} />
            {collapsed ? <span className="sr-only">{label}</span> : label}
          </Link>
          </Tooltip>
        ))}
      </nav>
      {!collapsed && <div className="p-4 text-[10px] text-slate-600 border-t border-ink-700/60 whitespace-nowrap">Strategy + Product = Alert</div>}
    </aside>
  );
}
