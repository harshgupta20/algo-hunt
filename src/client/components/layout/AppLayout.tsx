'use client';

/**
 * App shell: a full-width brand header (logo + status + actions) above a collapsible
 * sidebar and the page. The sidebar state is remembered in this browser.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ActivityBar } from '../loaders';

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
      <Topbar collapsed={collapsed} onToggleSidebar={toggle} />
      <div className="relative flex flex-1 min-h-0">
        <ActivityBar />
        <Sidebar collapsed={collapsed} />
        <main className="flex-1 min-w-0 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
