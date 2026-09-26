'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { McxAlert } from '@/shared/mcx';
import { Tooltip } from '../components/Tooltip';
import { Badge, Card, EmptyState, IconButton, Spinner, Tabs } from '../components/ui';
import { mcxApi } from './api';
import { LegPrices, OutcomeBadge, TraceView, TriBadge, UnitTag } from './components';
import { candleRange, istStampIso } from './format';
import { H } from './help';

const STATUS_TONE: Record<McxAlert['status'], 'bull' | 'warn' | 'bear' | 'accent'> = { SENT: 'bull', PARTIAL: 'warn', FAILED: 'bear', ACKNOWLEDGED: 'accent' };

export function AlertRow({ alert: a }: { alert: McxAlert }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ack = useMutation({
    mutationFn: () => mcxApi.acknowledge(a.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcx2-alerts'] });
      qc.invalidateQueries({ queryKey: ['mcx2-units'] });
    },
  });
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip content={H.alerts.why}>
          <button type="button" aria-label="Why did it fire?" onClick={() => setOpen(!open)} className="text-slate-500 hover:text-slate-200">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </Tooltip>
        <UnitTag unit={a.unit} />
        <span className="text-xs text-slate-300 font-medium">{a.strategyName}</span>
        <Tooltip content={H.strategy.version}>
          <span className="text-[11px] text-slate-500">v{a.version}</span>
        </Tooltip>
        <span className="text-xs text-slate-400">{candleRange(a.candleTime, a.triggerTimeframe)}</span>
        <LegPrices prices={a.evaluation.prices} />
        <Tooltip content={{ ...H.alerts.status, note: a.deliveries.map((d) => `${d.channel}: ${d.status}${d.error ? ` — ${d.error}` : ''}`).join(' · ') || 'Dashboard only (no channel)' }}>
          <Badge tone={STATUS_TONE[a.status]}>{a.status === 'ACKNOWLEDGED' ? 'Acknowledged' : a.deliveries.length ? a.status.toLowerCase() : 'recorded'}</Badge>
        </Tooltip>
        <span className="ml-auto text-[11px] text-slate-500">{istStampIso(a.createdAt)}</span>
        {!a.acknowledgedAt && (
          <IconButton help={H.alerts.acknowledge} onClick={() => ack.mutate()} disabled={ack.isPending} className="p-1.5 rounded-md text-slate-400 hover:text-accent-soft hover:bg-accent/10">
            {ack.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </IconButton>
        )}
      </div>
      {open && (
        <div className="mt-2 ml-7 rounded-lg border border-ink-700/60 bg-ink-850 p-3">
          <TraceView trace={a.evaluation.trace} />
        </div>
      )}
    </div>
  );
}

type View = 'active' | 'history' | 'signals';

export function AlertsTab() {
  const [view, setView] = useState<View>('active');
  const [strategyId, setStrategyId] = useState('');
  const strategies = useQuery({ queryKey: ['mcx2-strategies'], queryFn: mcxApi.strategies });
  const alerts = useQuery({
    queryKey: ['mcx2-alerts', view, strategyId],
    queryFn: () => mcxApi.alerts({ active: view === 'active', strategyId: strategyId || undefined, limit: 200 }),
    enabled: view !== 'signals',
    refetchInterval: 30_000,
  });
  const signals = useQuery({ queryKey: ['mcx2-signals', strategyId], queryFn: () => mcxApi.signals({ strategyId: strategyId || undefined, limit: 200 }), enabled: view === 'signals' });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={view}
          onChange={setView}
          items={[
            { value: 'active', label: 'Active', help: { title: 'Active alerts', body: 'Alerts not acknowledged yet.' } },
            { value: 'history', label: 'History', help: { title: 'Alert history', body: 'Every delivered or recorded alert, newest first.' } },
            { value: 'signals', label: 'Signals', help: { title: 'Signals', body: 'Every time a strategy fired — delivered or suppressed, with the reason.' } },
          ]}
        />
        <Tooltip content={{ title: 'Strategy filter', body: 'Show only this strategy’s records.' }}>
          <select aria-label="Strategy filter" className="input py-1.5 text-xs" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
            <option value="">All strategies</option>
            {strategies.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Tooltip>
      </div>

      {view !== 'signals' && (
        <Card className="p-0 overflow-hidden">
          {alerts.isLoading ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : alerts.data?.length ? (
            <div className="divide-y divide-ink-700/50">
              {alerts.data.map((a) => (
                <AlertRow key={a.id} alert={a} />
              ))}
            </div>
          ) : (
            <EmptyState title={view === 'active' ? 'No active alerts' : 'No alerts yet'} />
          )}
        </Card>
      )}

      {view === 'signals' && (
        <Card className="p-0 overflow-hidden">
          {signals.isLoading ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : signals.data?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500 bg-ink-850">
                  <tr>
                    <th className="px-4 py-2">Recorded</th>
                    <th className="px-4 py-2">Strike / future</th>
                    <th className="px-4 py-2">Candle</th>
                    <th className="px-4 py-2">Result</th>
                    <th className="px-4 py-2">Outcome</th>
                    <th className="px-4 py-2">Version</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700/50">
                  {signals.data.map((s) => (
                    <tr key={s.id} className={clsx(s.outcome !== 'ALERTED' && 'text-slate-400')}>
                      <td className="px-4 py-2 whitespace-nowrap">{istStampIso(s.createdAt)}</td>
                      <td className="px-4 py-2">
                        <UnitTag unit={s.evaluation.unit} />
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{candleRange(s.candleTime, s.triggerTimeframe)}</td>
                      <td className="px-4 py-2">
                        <TriBadge value={s.evaluation.result} />
                      </td>
                      <td className="px-4 py-2">
                        <OutcomeBadge outcome={s.outcome} />
                      </td>
                      <td className="px-4 py-2">v{s.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No signals yet" />
          )}
        </Card>
      )}
    </div>
  );
}
