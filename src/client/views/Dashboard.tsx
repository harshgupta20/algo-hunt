'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ConfigRuntimeSnapshot, Leg } from '@ash/shared';
import { api } from '../lib/api';
import { formatDistanceToNowStrict } from 'date-fns';
import clsx from 'clsx';
import { LEG_ORDER } from '../lib/signals';
import { SignalLegend } from '../components/signal';
import { Card, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui';
import { RsiGauge } from '../components/RsiGauge';
import { AlertItem } from '../components/AlertItem';

const TRIGGER_SIDE: Record<Leg, 'above' | 'below'> = { future: 'above', call: 'above', put: 'below' };

function ActiveConfigCard({ snap }: { snap: ConfigRuntimeSnapshot }) {
  const legs = snap.legs;
  const status = snap.lastError ? 'error' : snap.evaluatedAt ? 'live' : 'waiting';
  const metCount = LEG_ORDER.filter((leg) => {
    const r = legs[leg].rsi;
    return r != null && (TRIGGER_SIDE[leg] === 'above' ? r >= legs[leg].level : r <= legs[leg].level);
  }).length;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'w-2 h-2 rounded-full',
                status === 'live' ? 'bg-bull' : status === 'error' ? 'bg-bear' : 'bg-slate-500 animate-pulse',
              )}
              title={status === 'live' ? 'Monitoring' : status === 'error' ? 'Last evaluation failed' : 'Awaiting first evaluation'}
            />
            <span className="text-fg font-semibold">{snap.underlying}</span>
            <span className="text-xs text-slate-400">
              {snap.strike || '—'} · {snap.timeframe} · exp {snap.expiry || '—'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {snap.evaluatedAt ? `updated ${formatDistanceToNowStrict(snap.evaluatedAt)} ago` : 'awaiting first evaluation'}
            {legs.future.ltp != null && <> · FUT {legs.future.ltp.toFixed(2)}</>}
          </div>
        </div>
        <span
          className={clsx(
            'shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums',
            metCount === 3 ? 'bg-bull/15 text-bull' : 'bg-ink-800 text-slate-400',
          )}
          title="Legs currently meeting their condition"
        >
          {metCount}/3 met
        </span>
      </div>
      {snap.lastError && <div className="text-xs text-bear -mt-2">{snap.lastError}</div>}
      <div className="space-y-3">
        {LEG_ORDER.map((leg) => (
          <RsiGauge
            key={leg}
            leg={leg}
            detail={leg === 'future' ? undefined : `ATM ${snap.strike || '—'}`}
            rsi={legs[leg].rsi}
            level={legs[leg].level}
            triggerSide={TRIGGER_SIDE[leg]}
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
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-slate-300">Active Monitors</h2>
            <SignalLegend />
          </div>
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
