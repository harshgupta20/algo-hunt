'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ConfigRuntimeSnapshot, Leg } from '@ash/shared';
import { api } from '../lib/api';
import { formatDistanceToNowStrict } from 'date-fns';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import { LEG_ORDER } from '../lib/signals';
import { SignalLegend } from '../components/signal';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { PerformanceSection } from '../components/PerformanceSection';
import { HELP } from '../lib/help';
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
            <Tooltip content={HELP.monitor[status]}>
              <span
                tabIndex={0}
                aria-label={HELP.monitor[status].title}
                className={clsx(
                  'w-2.5 h-2.5 rounded-full cursor-help',
                  status === 'live' ? 'bg-bull' : status === 'error' ? 'bg-bear' : 'bg-slate-500 animate-pulse',
                )}
              />
            </Tooltip>
            <span className="text-fg font-semibold">{snap.underlying}</span>
            <span className="text-xs text-slate-400">
              {snap.strike || '—'} · {snap.timeframe} · exp {snap.expiry || '—'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {snap.evaluatedAt ? `updated ${formatDistanceToNowStrict(snap.evaluatedAt)} ago` : 'awaiting first evaluation'}
            {legs.future.ltp != null && (
              <>
                {' · '}
                <Tooltip content={HELP.monitor.ltp}>
                  <span className="cursor-help">FUT {legs.future.ltp.toFixed(2)}</span>
                </Tooltip>
              </>
            )}
          </div>
        </div>
        <Tooltip content={HELP.monitor.metCount} className="shrink-0">
          <span
            tabIndex={0}
            className={clsx(
              'rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums cursor-help',
              metCount === 3 ? 'bg-bull/15 text-bull' : 'bg-ink-800 text-slate-400',
            )}
          >
            {metCount}/3 met
          </span>
        </Tooltip>
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

/**
 * The trading overview: headline numbers, live monitors next to the latest
 * alerts, and performance analytics — one page, no hunting across tabs.
 */
export function Dashboard() {
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, refetchInterval: 15_000 });
  const alerts = useQuery({ queryKey: ['alerts', { limit: 6 }], queryFn: () => api.listAlerts({ limit: 6 }) });
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: api.analytics });

  const active = snapshots.data ?? [];
  const a = analytics.data;

  // Deep link (/#performance, e.g. from the old /analytics URL): scroll once the
  // content above has loaded, otherwise the late-arriving cards push it out of view.
  const loaded = !snapshots.isLoading && !alerts.isLoading && !analytics.isLoading;
  const scrolled = useRef(false);
  useEffect(() => {
    if (!loaded || scrolled.current || window.location.hash !== '#performance') return;
    scrolled.current = true;
    requestAnimationFrame(() => document.getElementById('performance')?.scrollIntoView({ block: 'start' }));
  }, [loaded]);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Live monitors, latest alerts and performance — at a glance." />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="Active Monitors" value={active.length} tone="accent" help={HELP.stats.activeMonitors} />
        <StatCard label="Alerts Today" value={a?.alertsToday ?? '—'} tone={a?.alertsToday ? 'bull' : undefined} help={HELP.stats.alertsToday} />
        <StatCard label="This Week" value={a?.alertsThisWeek ?? '—'} help={HELP.stats.alertsThisWeek} />
        <StatCard label="All Time" value={a?.totalAlerts ?? '—'} help={HELP.stats.totalAlerts} />
        <StatCard label="Scenario 1" value={a?.scenario1Count ?? '—'} tone="bull" help={HELP.scenario[1]} />
        <StatCard label="Scenario 2" value={a?.scenario2Count ?? '—'} tone="bull" help={HELP.scenario[2]} />
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
              <EmptyState title="No active monitors" hint="Create and activate a monitor to begin live monitoring." />
              <div className="text-center">
                <Tooltip content={HELP.dashboard.goConfigure}>
                  <Link href="/configuration" className="btn-primary">
                    Go to Configuration
                  </Link>
                </Tooltip>
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-300">Latest Alerts</h2>
            <Tooltip content={HELP.dashboard.viewAll} side="left">
              <Link href="/alerts" className="inline-flex items-center gap-1 text-xs font-medium text-accent-soft hover:underline">
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </Tooltip>
          </div>
          {alerts.isLoading ? (
            <Spinner />
          ) : (alerts.data?.length ?? 0) === 0 ? (
            <Card>
              <EmptyState title="No alerts yet" hint="Alerts appear here the moment a strategy triggers." />
            </Card>
          ) : (
            <div className="space-y-3">
              {alerts.data!.slice(0, 5).map((al) => (
                <AlertItem key={al.id} alert={al} />
              ))}
            </div>
          )}
        </div>
      </div>

      <section id="performance" className="mt-10 scroll-mt-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
          Performance <InfoTip content={HELP.dashboard.performance} />
        </h2>
        {analytics.isLoading ? <Spinner /> : a ? <PerformanceSection data={a} /> : <EmptyState title="No analytics available" />}
      </section>
    </div>
  );
}
