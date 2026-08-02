import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { Alert, AlertHistoryFilters, ScenarioId, Timeframe } from '@ash/shared';
import { TIMEFRAMES } from '@ash/shared';
import { api } from '../lib/api';
import { Card, EmptyState, PageHeader, RuleBadge, Spinner } from '../components/ui';
import { fmtRsi, fmtTime } from '../lib/format';

function toCsv(alerts: Alert[]): string {
  const header = [
    'triggeredAt',
    'underlying',
    'strike',
    'expiry',
    'timeframe',
    'scenario',
    'futureRsi',
    'callRsi',
    'putRsi',
  ];
  const rows = alerts.map((a) =>
    [
      a.triggeredAt,
      a.underlying,
      a.strike,
      a.expiry,
      a.timeframe,
      a.scenario,
      a.snapshot.futureRsi,
      a.snapshot.callRsi,
      a.snapshot.putRsi,
    ].join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

export function AlertHistory() {
  const [underlying, setUnderlying] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [scenario, setScenario] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const underlyings = useQuery({ queryKey: ['underlyings'], queryFn: api.underlyings });

  const filters: AlertHistoryFilters = useMemo(
    () => ({
      underlying: underlying || undefined,
      timeframe: (timeframe || undefined) as Timeframe | undefined,
      scenario: scenario ? (Number(scenario) as ScenarioId) : undefined,
      from: from || undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
      limit: 500,
    }),
    [underlying, timeframe, scenario, from, to],
  );

  const alerts = useQuery({ queryKey: ['alerts', filters], queryFn: () => api.listAlerts(filters) });

  const download = () => {
    const blob = new Blob([toCsv(alerts.data ?? [])], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ash-alerts.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setUnderlying('');
    setTimeframe('');
    setScenario('');
    setFrom('');
    setTo('');
  };

  return (
    <div>
      <PageHeader
        title="Alert History"
        subtitle="Filter and export every persisted strategy alert."
        actions={
          <button className="btn-ghost" onClick={download} disabled={(alerts.data?.length ?? 0) === 0}>
            <Download className="w-4 h-4" /> Export CSV
          </button>
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="label">Underlying</label>
            <select className="input w-full" value={underlying} onChange={(e) => setUnderlying(e.target.value)}>
              <option value="">All</option>
              {underlyings.data?.map((u) => (
                <option key={u.symbol} value={u.symbol}>
                  {u.symbol}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Timeframe</label>
            <select className="input w-full" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              <option value="">All</option>
              {TIMEFRAMES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Scenario</label>
            <select className="input w-full" value={scenario} onChange={(e) => setScenario(e.target.value)}>
              <option value="">All</option>
              <option value="1">Scenario 1</option>
              <option value="2">Scenario 2</option>
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <input type="date" className="input w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn-ghost" onClick={reset}>
            Reset
          </button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {alerts.isLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : (alerts.data?.length ?? 0) === 0 ? (
          <EmptyState title="No alerts match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-ink-850">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Underlying</th>
                  <th className="px-4 py-3">Strike</th>
                  <th className="px-4 py-3">Expiry</th>
                  <th className="px-4 py-3">TF</th>
                  <th className="px-4 py-3">Scenario</th>
                  <th className="px-4 py-3 text-right">Future</th>
                  <th className="px-4 py-3 text-right">Call</th>
                  <th className="px-4 py-3 text-right">Put</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {alerts.data!.map((a) => (
                  <tr key={a.id} className="hover:bg-ink-850/60">
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{fmtTime(a.triggeredAt)}</td>
                    <td className="px-4 py-3 text-white font-medium">{a.underlying}</td>
                    <td className="px-4 py-3 tabular-nums">{a.strike}</td>
                    <td className="px-4 py-3 text-slate-400">{a.expiry || '—'}</td>
                    <td className="px-4 py-3">{a.timeframe}</td>
                    <td className="px-4 py-3">
                      <RuleBadge scenario={a.scenario} variant={a.variant} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-bull">{fmtRsi(a.snapshot.futureRsi)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-bull">{fmtRsi(a.snapshot.callRsi)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-bear">{fmtRsi(a.snapshot.putRsi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
