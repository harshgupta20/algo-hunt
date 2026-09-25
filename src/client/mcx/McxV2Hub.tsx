'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BellRing, Boxes, LayoutGrid, Settings, Workflow } from 'lucide-react';
import { Tooltip } from '../components/Tooltip';
import { Badge, PageHeader, Tabs } from '../components/ui';
import { mcxApi } from './api';
import { AlertsTab } from './AlertsTab';
import { DashboardTab } from './DashboardTab';
import { H } from './help';
import { InstrumentsTab } from './InstrumentsTab';
import { ScannerTab } from './ScannerTab';
import { SettingsTab } from './SettingsTab';
import { StrategiesTab } from './StrategiesTab';

type Tab = 'dashboard' | 'strategies' | 'alerts' | 'scanner' | 'instruments' | 'settings';
const TABS = [
  { value: 'dashboard' as const, label: 'Dashboard', icon: LayoutGrid, help: H.tabs.dashboard },
  { value: 'strategies' as const, label: 'Strategies', icon: Workflow, help: H.tabs.strategies },
  { value: 'alerts' as const, label: 'Alerts', icon: BellRing, help: H.tabs.alerts },
  { value: 'scanner' as const, label: 'Scanner', icon: Activity, help: H.tabs.scanner },
  { value: 'instruments' as const, label: 'Instruments', icon: Boxes, help: H.tabs.instruments },
  { value: 'settings' as const, label: 'Settings', icon: Settings, help: H.tabs.settings },
];

/**
 * While this page is open during market hours, ask the server to scan once a
 * minute (the DB lease makes it a no-op when the cron already ran).
 */
function useDashboardScan(marketOpen: boolean | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!marketOpen) return;
    const tick = () =>
      mcxApi
        .scan(false)
        .then((r) => {
          if (!r.skipped) {
            qc.invalidateQueries({ queryKey: ['mcx2-alerts'] });
            qc.invalidateQueries({ queryKey: ['mcx2-runs'] });
            qc.invalidateQueries({ queryKey: ['mcx2-units'] });
            qc.invalidateQueries({ queryKey: ['mcx2-status'] });
          }
        })
        .catch(() => undefined);
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [marketOpen, qc]);
}

export function McxV2Hub() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.value === raw) ? raw! : 'dashboard';
  const status = useQuery({ queryKey: ['mcx2-status'], queryFn: mcxApi.status, refetchInterval: 30_000 });
  useDashboardScan(status.data?.market.open);

  return (
    <div>
      <PageHeader
        title="MCX V2"
        subtitle="Independent MCX alerting: explicit contracts, multi-timeframe conditions, Telegram + Email alerts, and explanations for every signal."
        actions={
          <Tooltip content={H.nav}>
            <Badge tone="warn">beta</Badge>
          </Tooltip>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={(t) => router.push(t === 'dashboard' ? '/mcx-v2' : `/mcx-v2?tab=${t}`)} items={TABS} />
        {status.data?.market.open && (
          <Tooltip content={H.status.autoScan}>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="w-2 h-2 rounded-full bg-bull animate-pulse" /> scanning while open
            </span>
          </Tooltip>
        )}
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'strategies' && <StrategiesTab />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'scanner' && <ScannerTab />}
      {tab === 'instruments' && <InstrumentsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}
