'use client';

/**
 * App shell. Classic look: a full-width brand header (logo + status + actions) above a collapsible sidebar and
 * the page (the sidebar state is remembered in this browser). Fresh look: a white header with the sections across
 * the top and a status strip, the page full width below.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { FreshHeader, Topbar } from './Topbar';
import { ActivityBar } from '../loaders';
import { AiPanel } from '../../ai/AiPanel';

const KEY = 'algo-hunt.sidebar-collapsed';

export function AppLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(KEY) === '1');
    } catch {
      /* storage unavailable (private mode) — default to expanded */
    }
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <div className="flex h-full flex-col">
      {/* Both looks are rendered; CSS shows the active one (src/client/theme/look.ts). */}
      <Topbar collapsed={collapsed} onToggleSidebar={toggle} />
      <FreshHeader />
      <div className="relative flex flex-1 min-h-0">
        <ActivityBar />
        <Sidebar collapsed={collapsed} />
        <main className="app-main flex-1 min-w-0 overflow-y-auto p-6">{children}</main>
      </div>
      <AiPanel />
    </div>
  );
}
