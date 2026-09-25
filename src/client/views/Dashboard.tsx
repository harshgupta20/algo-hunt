'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Coins } from 'lucide-react';
import { isMcx } from '@ash/shared';
import { api } from '../lib/api';
import { useLive } from '../context/LiveContext';
import { SignalLegend } from '../components/signal';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { PerformanceSection } from '../components/PerformanceSection';
import { HELP } from '../lib/help';
import { Badge, Card, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui';
import { MonitorCard } from '../components/MonitorCard';
import { AlertItem } from '../components/AlertItem';

/** One line linking to the MCX tab: commodity monitors live there, with their own session. */
function McxStrip() {
  const { status } = useLive();
  const mcx = status?.sessions?.MCX;
  const active = status?.activeBySegment?.MCX ?? 0;
  return (
    <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 py-3">
      <span className="flex items-center gap-2 text-sm text-slate-300">
        <Coins className="w-4 h-4 text-slate-500" />
        MCX commodities <InfoTip content={HELP.mcx.dashboardStrip} />
        <Tooltip content={HELP.mcx.session}>
          <span tabIndex={0} className="cursor-help">
            <Badge tone={mcx?.open ? 'bull' : 'default'}>{mcx ? (mcx.open ? 'session open' : 'session closed') : '—'}</Badge>
          </span>
        </Tooltip>
        <Tooltip content={HELP.stats.activeMonitors}>
          <span tabIndex={0} className="cursor-help">
            <Badge tone="accent">{active} active</Badge>
          </span>
        </Tooltip>
      </span>
      <Tooltip content={HELP.mcx.toMcx} side="left">
        <Link href="/mcx" className="inline-flex items-center gap-1 text-xs font-medium text-accent-soft hover:underline">
          Open MCX <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </Tooltip>
    </Card>
  );
}

/**
 * The trading overview: headline numbers, live monitors next to the latest
 * alerts, and performance analytics — one page, no hunting across tabs.
 */
export function Dashboard() {
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, refetchInterval: 15_000 });
  const alerts = useQuery({ queryKey: ['alerts', { limit: 6, segment: 'NSE' }], queryFn: () => api.listAlerts({ limit: 6, segment: 'NSE' }) });
  const analytics = useQuery({ queryKey: ['analytics', 'NSE'], queryFn: () => api.analytics('NSE') });

  // NSE/BSE only — commodity monitors live in the MCX tab.
  const active = (snapshots.data ?? []).filter((s) => !isMcx(s.underlying));
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
      <PageHeader title="Dashboard" subtitle="NSE/BSE index monitors, latest alerts and performance — at a glance." />

      <McxStrip />

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
                <MonitorCard key={s.configId} snap={s} />
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
