'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { Tooltip } from '../components/Tooltip';
import { Card, EmptyState, Spinner, StatCard } from '../components/ui';
import { v2Api, type MarketStatus } from './api';
import { AlertRow } from './AlertsTab';
import { istStampIso, minutesToClock } from './format';
import { H } from './help';

const session = (m: MarketStatus) => (m.today.trading ? `${minutesToClock(m.today.openMin)}–${minutesToClock(m.today.closeMin)} IST${m.today.note ? ` · ${m.today.note}` : ''}` : (m.today.note ?? 'No session today'));

export function DashboardTab() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['v2-status'], queryFn: v2Api.status, refetchInterval: 30_000 });
  const active = useQuery({ queryKey: ['v2-alerts', 'active', ''], queryFn: () => v2Api.alerts({ active: true, limit: 50 }), refetchInterval: 30_000 });
  const scan = useMutation({
    mutationFn: () => v2Api.scan(true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['v2-status'] });
      qc.invalidateQueries({ queryKey: ['v2-alerts'] });
      qc.invalidateQueries({ queryKey: ['v2-runs'] });
    },
  });
  if (status.isLoading) return <Spinner />;
  if (status.error) return <p className="text-sm text-bear">{(status.error as Error).message}</p>;
  const s = status.data!;
  const run = s.lastRun;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label="NSE / BSE" value={<span className={s.markets.NSE.open ? 'text-bull' : 'text-slate-400'}>{s.markets.NSE.open ? 'Open' : 'Closed'}</span>} hint={session(s.markets.NSE)} help={H.status.nse} />
        <StatCard label="MCX" value={<span className={s.markets.MCX.open ? 'text-bull' : 'text-slate-400'}>{s.markets.MCX.open ? 'Open' : 'Closed'}</span>} hint={session(s.markets.MCX)} help={H.status.mcx} />
        <StatCard
          label="Kite"
          value={<span className={s.kiteConnected ? 'text-bull' : 'text-warn'}>{s.kiteConnected ? 'Connected' : 'Offline'}</span>}
          hint={s.kiteConnected ? 'Candles and prices available' : 'Log in from Settings'}
          help={H.status.kite}
        />
        <StatCard label="Products" value={s.instruments.products.toLocaleString('en-IN')} hint={s.instruments.syncedAt ? `Synced ${istStampIso(s.instruments.syncedAt)}` : 'Never synced — Products tab'} help={H.status.products} />
        <StatCard label="Connections on" value={`${s.connections.enabled} / ${s.connections.total}`} hint={`${s.strategies} strateg${s.strategies === 1 ? 'y' : 'ies'}`} help={H.status.connections} />
        <StatCard
          label="Last scan"
          value={run ? <span className={clsx(run.status === 'OK' ? 'text-fg' : run.status === 'SKIPPED' ? 'text-slate-400' : 'text-warn')}>{istStampIso(run.startedAt).slice(7)}</span> : '—'}
          hint={run ? `${run.status} · ${run.unitsEvaluated} evaluated · ${run.alerts} alert(s)` : 'No cycle recorded yet'}
          help={H.status.lastRun}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip content={H.status.scanNow}>
          <button type="button" className="btn-ghost" disabled={scan.isPending} onClick={() => scan.mutate()}>
            {scan.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Scan now
          </button>
        </Tooltip>
        {scan.data && (
          <span className="text-xs text-slate-400">
            {scan.data.skipped ? `Skipped: ${scan.data.run.notes.join(' · ')}` : `${scan.data.run.status} · ${scan.data.run.unitsEvaluated} evaluated · ${scan.data.run.alerts} alert(s) · ${scan.data.run.requests} request(s)`}
          </span>
        )}
        {scan.error && <span className="text-xs text-bear">{(scan.error as Error).message}</span>}
        <span className="ml-auto flex items-center gap-3 text-[11px]">
          {(['telegram', 'email'] as const).map((c) => (
            <Tooltip key={c} content={{ title: c === 'telegram' ? 'Telegram' : 'Email', body: s.channels[c].detail }}>
              <span className={clsx('inline-flex items-center gap-1', s.channels[c].configured ? 'text-slate-300' : 'text-warn')}>
                <span className={clsx('w-2 h-2 rounded-full', s.channels[c].configured ? 'bg-bull' : 'bg-warn')} />
                {c === 'telegram' ? 'Telegram' : 'Email'}
              </span>
            </Tooltip>
          ))}
        </span>
      </div>
      {run && run.errors.length > 0 && (
        <Card className="border-warn/40">
          <p className="text-xs font-semibold text-warn mb-1">Last cycle reported {run.errors.length} problem(s)</p>
          {run.errors.slice(0, 5).map((e, i) => (
            <p key={i} className="text-xs text-slate-400">
              • [{e.source}] {e.productId ? `${e.productId}: ` : ''}
              {e.message}
            </p>
          ))}
        </Card>
      )}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-700/60 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-300">Active alerts</h2>
          <span className="text-xs text-slate-500">{active.data?.length ?? 0}</span>
        </div>
        {active.isLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : active.data?.length ? (
          <div className="divide-y divide-ink-700/50">
            {active.data.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </div>
        ) : (
          <EmptyState title="No active alerts" hint="Build a strategy, connect it to products and switch the connection on." />
        )}
      </Card>
    </div>
  );
}
