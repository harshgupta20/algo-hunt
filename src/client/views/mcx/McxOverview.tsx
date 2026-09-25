'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { McxProductGroup, McxProductInfo } from '@ash/shared';
import { MCX_GROUP_LABEL, isMcx } from '@ash/shared';
import { api } from '../../lib/api';
import { useLive } from '../../context/LiveContext';
import { HELP } from '../../lib/help';
import { Card, EmptyState, Help, Spinner, StatCard } from '../../components/ui';
import { InfoTip, Tooltip } from '../../components/Tooltip';
import { MonitorCard } from '../../components/MonitorCard';
import { AlertItem } from '../../components/AlertItem';
import { SignalLegend } from '../../components/signal';
import { PerformanceSection } from '../../components/PerformanceSection';
import { ProductBadge } from './shared';

const GROUPS: McxProductGroup[] = ['bullion', 'energy', 'base-metals'];

/** "23:30" in IST from an ISO timestamp. */
function istClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
}

const shortDate = (d: string) => format(parseISO(d), 'dd MMM');

function ProductRow({ p }: { p: McxProductInfo }) {
  const near = p.futures[0];
  return (
    <tr className="hover:bg-ink-850/60">
      <td className="px-4 py-2.5">
        <div className="text-fg font-medium">{p.symbol}</div>
        <div className="text-xs text-slate-500">{p.name}</div>
      </td>
      <td className="px-4 py-2.5">
        <ProductBadge product={p} />
      </td>
      <td className="px-4 py-2.5 text-xs">
        {near ? (
          <>
            <span className="font-mono text-slate-300">{near.tradingSymbol}</span>
            <span className="text-slate-500"> · {shortDate(near.expiry)}</span>
            {p.futures.length > 1 && <span className="text-slate-500"> · +{p.futures.length - 1} more</span>}
          </>
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-xs text-slate-400">
        {p.optionExpiries.length ? p.optionExpiries.slice(0, 3).map(shortDate).join(' · ') : '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-slate-400 tabular-nums">
        {p.strikeInterval ? `${p.strikeInterval}${p.strikeCount ? ` · ${p.strikeCount} strikes` : ''}` : '—'}
      </td>
    </tr>
  );
}

function ProductCatalog() {
  const products = useQuery({ queryKey: ['mcx-products'], queryFn: api.mcxProducts });
  if (products.isLoading) return <Spinner />;
  const list = products.data ?? [];
  const synced = list.filter((p) => p.available).length;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-ink-700/60">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300">
          Products <InfoTip content={HELP.mcx.products} />
        </h2>
        <span className="text-xs text-slate-500">
          {synced}/{list.length} in the instrument master
        </span>
      </div>
      {synced === 0 && (
        <div className="px-4 py-2 text-xs text-warn border-b border-ink-700/60">
          No MCX contracts synced yet — connect Zerodha Kite in Settings and refresh instruments.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-ink-850">
            <tr>
              <th className="px-4 py-2.5">Product</th>
              <th className="px-4 py-2.5">Instruments</th>
              <th className="px-4 py-2.5">
                <span className="inline-flex items-center gap-1">
                  Futures <InfoTip content={HELP.mcx.futures} />
                </span>
              </th>
              <th className="px-4 py-2.5">
                <span className="inline-flex items-center gap-1">
                  Option expiries <InfoTip content={HELP.mcx.optionExpiries} />
                </span>
              </th>
              <th className="px-4 py-2.5">
                <span className="inline-flex items-center gap-1">
                  Strike gap <InfoTip content={HELP.mcx.strikeGap} />
                </span>
              </th>
            </tr>
          </thead>
          {GROUPS.map((g) => (
            <tbody key={g} className="divide-y divide-ink-700/50">
              <tr>
                <td colSpan={5} className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {MCX_GROUP_LABEL[g]}
                </td>
              </tr>
              {list
                .filter((p) => p.group === g)
                .map((p) => (
                  <ProductRow key={p.symbol} p={p} />
                ))}
            </tbody>
          ))}
        </table>
      </div>
    </Card>
  );
}

export function McxOverview({ onCreate }: { onCreate: () => void }) {
  const { status } = useLive();
  const session = status?.sessions?.MCX;
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, refetchInterval: 15_000 });
  const alerts = useQuery({ queryKey: ['alerts', { limit: 5, segment: 'MCX' }], queryFn: () => api.listAlerts({ limit: 5, segment: 'MCX' }) });
  const analytics = useQuery({ queryKey: ['analytics', 'MCX'], queryFn: () => api.analytics('MCX') });
  const active = (snapshots.data ?? []).filter((s) => isMcx(s.underlying));
  const a = analytics.data;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <StatCard
          label="Session"
          value={session ? (session.open ? 'Open' : 'Closed') : '—'}
          tone={session?.open ? 'bull' : undefined}
          hint={session ? `${istClock(session.opensAt)}–${istClock(session.closesAt)} IST` : undefined}
          help={HELP.mcx.session}
        />
        <StatCard label="Active Monitors" value={active.length} tone="accent" help={HELP.stats.activeMonitors} />
        <StatCard label="Alerts Today" value={a?.alertsToday ?? '—'} tone={a?.alertsToday ? 'bull' : undefined} help={HELP.stats.alertsToday} />
        <StatCard label="This Week" value={a?.alertsThisWeek ?? '—'} help={HELP.stats.alertsThisWeek} />
        <StatCard label="All Time" value={a?.totalAlerts ?? '—'} help={HELP.stats.totalAlerts} />
      </div>

      <div className="mb-6">
        <ProductCatalog />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-slate-300">Active MCX Monitors</h2>
            <SignalLegend />
          </div>
          {snapshots.isLoading ? (
            <Spinner />
          ) : active.length === 0 ? (
            <Card>
              <EmptyState title="No active MCX monitors" hint="Create a commodity monitor and activate it to start live monitoring." />
              <div className="text-center">
                <Help content={HELP.mcx.create}>
                  <button className="btn-primary" onClick={onCreate}>
                    <Plus className="w-4 h-4" /> Create an MCX monitor
                  </button>
                </Help>
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
            <h2 className="text-sm font-semibold text-slate-300">Latest MCX Alerts</h2>
            <Tooltip content={HELP.dashboard.viewAll} side="left">
              <Link href="/alerts?segment=MCX" className="inline-flex items-center gap-1 text-xs font-medium text-accent-soft hover:underline">
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </Tooltip>
          </div>
          {alerts.isLoading ? (
            <Spinner />
          ) : (alerts.data?.length ?? 0) === 0 ? (
            <Card>
              <EmptyState title="No MCX alerts yet" hint="Alerts appear here the moment a commodity monitor triggers." />
            </Card>
          ) : (
            <div className="space-y-3">
              {alerts.data!.map((al) => (
                <AlertItem key={al.id} alert={al} />
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="mt-10">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
          Performance <InfoTip content={HELP.dashboard.performance} />
        </h2>
        {analytics.isLoading ? <Spinner /> : a ? <PerformanceSection data={a} /> : <EmptyState title="No analytics available" />}
      </section>
    </div>
  );
}
