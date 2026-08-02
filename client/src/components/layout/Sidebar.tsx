import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity,
  BarChart3,
  BellRing,
  Blocks,
  CandlestickChart,
  History,
  LayoutDashboard,
  Library,
  Settings,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/alerts', label: 'Live Alerts', icon: BellRing },
  { to: '/builder', label: 'Strategy Builder', icon: Blocks },
  { to: '/library', label: 'Strategy Library', icon: Library },
  { to: '/analyzer', label: 'Strategy Analyzer', icon: CandlestickChart },
  { to: '/history', label: 'Alert History', icon: History },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/configuration', label: 'Configuration', icon: SlidersHorizontal },
  { to: '/strategies', label: 'Strategies', icon: Workflow },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="w-60 shrink-0 border-r border-ink-700/60 bg-ink-900 flex flex-col">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-ink-700/60">
        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
          <Activity className="w-5 h-5 text-accent-soft" />
        </div>
        <div>
          <div className="text-white font-semibold leading-tight">ASH</div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Alert Platform</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-accent/15 text-white' : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200',
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 text-[10px] text-slate-600 border-t border-ink-700/60">
        RSI Synchronized Strategy · v0.1
      </div>
    </aside>
  );
}
