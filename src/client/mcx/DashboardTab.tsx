'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { Tooltip } from '../components/Tooltip';
import { Card, EmptyState, Spinner, StatCard } from '../components/ui';
import { mcxApi } from './api';
import { AlertRow } from './AlertsTab';
import { istStampIso, minutesToClock } from './format';
import { H } from './help';

export function DashboardTab() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['mcx2-status'], queryFn: mcxApi.status, refetchInterval: 30_000 });
  const active = useQuery({ queryKey: ['mcx2-alerts', 'active'], queryFn: () => mcxApi.alerts({ active: true, limit: 50 }), refetchInterval: 30_000 });
  const scan = useMutation({
    mutationFn: () => mcxApi.scan(true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcx2-status'] });
      qc.invalidateQueries({ queryKey: ['mcx2-alerts'] });
      qc.invalidateQueries({ queryKey: ['mcx2-runs'] });
    },
  });

  if (status.isLoading) return <Spinner />;
  if (status.error) return <p className="text-sm text-bear">{(status.error as Error).message}</p>;
  const s = status.data!;
  const today = s.market.today;
  const run = s.lastRun;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="MCX market"
          value={<span className={s.market.open ? 'text-bull' : 'text-slate-400'}>{s.market.open ? 'Open' : 'Closed'}</span>}
          hint={today.trading ? `${minutesToClock(today.openMin)}–${minutesToClock(today.closeMin)} IST${today.note ? ` · ${today.note}` : ''}` : today.note ?? 'No session today'}
          help={H.status.market}
        />
        <StatCard
          label="Kite"
          value={<span className={s.kiteConnected ? 'text-bull' : 'text-warn'}>{s.kiteConnected ? 'Connected' : 'Not connected'}</span>}
          hint={s.kiteConnected ? 'Candles and prices available' : 'Log in from Settings'}
          help={H.status.kite}
        />
        <StatCard
          label="Instruments"
          value={s.instruments.count.toLocaleString('en-IN')}
          hint={s.instruments.syncedAt ? `Synced ${istStampIso(s.instruments.syncedAt)}` : 'Never synced'}
          help={H.status.instruments}
        />
        <StatCard label="Strategies" value={`${s.strategies.enabled} / ${s.strategies.total}`} hint="enabled / total" help={H.status.strategies} />
        <StatCard
          label="Last scan"
          value={
            run ? (
              <span className={clsx(run.status === 'OK' ? 'text-fg' : run.status === 'SKIPPED' ? 'text-slate-400' : 'text-warn')}>{istStampIso(run.startedAt).slice(7)}</span>
            ) : (
              '—'
            )
          }
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
              • [{e.source}] {e.message}
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
          <EmptyState title="No active alerts" hint="Alerts appear here until you acknowledge them." />
        )}
      </Card>
    </div>
  );
}
