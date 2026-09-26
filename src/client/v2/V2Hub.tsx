'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BarChart3, BellRing, Boxes, LayoutGrid, Link2, Settings, Workflow } from 'lucide-react';
import { Tooltip } from '../components/Tooltip';
import { Badge, PageHeader, Tabs } from '../components/ui';
import { v2Api } from './api';
import { AlertsTab } from './AlertsTab';
import { CompareTab } from './compare/CompareTab';
import { ConnectionsTab } from './connections/ConnectionsTab';
import { DashboardTab } from './DashboardTab';
import { H } from './help';
import { ProductsTab } from './ProductsTab';
import { ScannerTab } from './ScannerTab';
import { SettingsTab } from './SettingsTab';
import { StrategiesTab } from './strategies/StrategiesTab';

type Tab = 'dashboard' | 'strategies' | 'connections' | 'compare' | 'alerts' | 'products' | 'scanner' | 'settings';
const TABS = [
  { value: 'dashboard' as const, label: 'Dashboard', icon: LayoutGrid, help: H.tabs.dashboard },
  { value: 'strategies' as const, label: 'Strategies', icon: Workflow, help: H.tabs.strategies },
  { value: 'connections' as const, label: 'Connections', icon: Link2, help: H.tabs.connections },
  { value: 'compare' as const, label: 'Compare', icon: BarChart3, help: H.tabs.compare },
  { value: 'alerts' as const, label: 'Alerts', icon: BellRing, help: H.tabs.alerts },
  { value: 'products' as const, label: 'Products', icon: Boxes, help: H.tabs.products },
  { value: 'scanner' as const, label: 'Scanner', icon: Activity, help: H.tabs.scanner },
  { value: 'settings' as const, label: 'Settings', icon: Settings, help: H.tabs.settings },
];

/** While this page is open and a market is open, ask the server to scan once a minute (the lease makes it a no-op when the cron already ran). */
function useDashboardScan(anyOpen: boolean | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!anyOpen) return;
    const tick = () =>
      v2Api
        .scan(false)
        .then((r) => {
          if (!r.skipped) for (const k of ['v2-alerts', 'v2-runs', 'v2-units', 'v2-status']) qc.invalidateQueries({ queryKey: [k] });
        })
        .catch(() => undefined);
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [anyOpen, qc]);
}

export function V2Hub() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.value === raw) ? raw! : 'dashboard';
  const strategy = params.get('strategy') ?? undefined;
  const status = useQuery({ queryKey: ['v2-status'], queryFn: v2Api.status, refetchInterval: 30_000 });
  const anyOpen = status.data ? status.data.markets.NSE.open || status.data.markets.MCX.open : undefined;
  useDashboardScan(anyOpen);
  const go = (t: Tab, strategyId?: string) => router.push(t === 'dashboard' ? '/v2' : `/v2?tab=${t}${strategyId ? `&strategy=${strategyId}` : ''}`);

  return (
    <div>
      <PageHeader
        title="V2 · Strategy + Product = Alert"
        subtitle="Build product-agnostic strategies (1–4 legs), connect them to NSE indices, stocks or MCX commodities, and compare which products they fire on."
        actions={
          <Tooltip content={H.nav}>
            <Badge tone="warn">beta</Badge>
          </Tooltip>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={(t) => go(t)} items={TABS} />
        {anyOpen && (
          <Tooltip content={H.status.autoScan}>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="w-2 h-2 rounded-full bg-bull animate-pulse" /> scanning while open
            </span>
          </Tooltip>
        )}
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'strategies' && <StrategiesTab onGo={(t, id) => go(t, id)} />}
      {tab === 'connections' && <ConnectionsTab initialStrategyId={strategy} />}
      {tab === 'compare' && <CompareTab initialStrategyId={strategy} />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'scanner' && <ScannerTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}
