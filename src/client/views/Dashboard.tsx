'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ConfigRuntimeSnapshot, Leg } from '@ash/shared';
import { api } from '../lib/api';
import { formatDistanceToNowStrict } from 'date-fns';
import { Card, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui';
import { RsiGauge } from '../components/RsiGauge';
import { AlertItem } from '../components/AlertItem';

const LEG_META: Record<Leg, { label: string; side: 'above' | 'below' }> = {
  future: { label: 'Future', side: 'above' },
  call: { label: 'Call (ATM)', side: 'above' },
  put: { label: 'Put (ATM)', side: 'below' },
};

function ActiveConfigCard({ snap }: { snap: ConfigRuntimeSnapshot }) {
  const legs = snap.legs;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-fg font-semibold">{snap.underlying}</div>
          <div className="text-xs text-slate-400">
            {snap.strike || '—'} · {snap.timeframe} · exp {snap.expiry || '—'}
          </div>
        </div>
        <div className="text-[10px] text-right text-slate-500">
          {snap.evaluatedAt ? `updated ${formatDistanceToNowStrict(snap.evaluatedAt)} ago` : 'awaiting first evaluation'}
          {legs.future.ltp != null && <div className="text-slate-400">FUT {legs.future.ltp.toFixed(2)}</div>}
        </div>
      </div>
      {snap.lastError && <div className="text-xs text-bear -mt-2">{snap.lastError}</div>}
      <div className="space-y-3">
        {(['future', 'call', 'put'] as Leg[]).map((leg) => (
          <RsiGauge
            key={leg}
            label={LEG_META[leg].label}
            rsi={legs[leg].rsi}
            level={legs[leg].level}
            triggerSide={LEG_META[leg].side}
          />
        ))}
      </div>
    </Card>
  );
}

export function Dashboard() {
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, refetchInterval: 15_000 });
  const alerts = useQuery({ queryKey: ['alerts', {}], queryFn: () => api.listAlerts() });
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: api.analytics });

  const active = snapshots.data ?? [];

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Live synchronized-RSI monitoring across Future, Call and Put." />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Monitors" value={active.length} tone="accent" />
        <StatCard label="Total Alerts" value={analytics.data?.totalAlerts ?? '—'} />
        <StatCard label="Scenario 1" value={analytics.data?.scenario1Count ?? '—'} tone="bull" />
        <StatCard label="Scenario 2" value={analytics.data?.scenario2Count ?? '—'} tone="bull" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Active Monitors</h2>
          {snapshots.isLoading ? (
            <Spinner />
          ) : active.length === 0 ? (
            <Card>
              <EmptyState
                title="No active monitors"
                hint="Create and activate a configuration to begin live monitoring."
              />
              <div className="text-center">
                <Link href="/configuration" className="btn-primary">
                  Go to Configuration
                </Link>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {active.map((s) => (
                <ActiveConfigCard key={s.configId} snap={s} />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Recent Alerts</h2>
          {alerts.isLoading ? (
            <Spinner />
          ) : (alerts.data?.length ?? 0) === 0 ? (
            <Card>
              <EmptyState title="No alerts yet" hint="Alerts appear here the moment the strategy triggers." />
            </Card>
          ) : (
            <div className="space-y-3">
              {alerts.data!.slice(0, 6).map((a) => (
                <AlertItem key={a.id} alert={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
