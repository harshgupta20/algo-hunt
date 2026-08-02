import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import type { AnalyzerParams, BacktestAlert, DateRangePreset } from '@ash/shared';
import { api } from '../lib/api';
import { Badge, Card, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui';
import { groupText } from '../lib/strategyText';
import { SummaryCards } from './analyzer/SummaryCards';
import { AlertTable } from './analyzer/AlertTable';
import { AlertTimeline } from './analyzer/AlertTimeline';
import { AlertDetailDrawer } from './analyzer/AlertDetailDrawer';
import { TradingChart } from './analyzer/TradingChart';
import { Heatmaps } from './analyzer/Heatmaps';
import { AnalyticsPanel } from './analyzer/AnalyticsPanel';

const PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'last-week', label: 'Last Week' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'last-3-months', label: 'Last 3 Months' },
  { value: 'last-6-months', label: 'Last 6 Months' },
];

export function StrategyDashboard() {
  const { id } = useParams();
  const [preset, setPreset] = useState<DateRangePreset>('last-month');
  const [active, setActive] = useState<BacktestAlert | null>(null);
  const [drawerAlert, setDrawerAlert] = useState<BacktestAlert | null>(null);

  const strategy = useQuery({ queryKey: ['strategy', id], queryFn: () => api.getStrategy(id!), enabled: Boolean(id) });
  const stats = useQuery({ queryKey: ['strategy-stats', id], queryFn: () => api.strategyStats(id!), enabled: Boolean(id) });

  const params: AnalyzerParams | null = useMemo(() => {
    if (!strategy.data) return null;
    const d = strategy.data;
    return {
      underlying: d.underlying,
      expiryType: d.expiryType,
      strikeSelection: d.strikeSelection,
      timeframe: d.timeframe,
      strategy: d.id,
      preset,
    };
  }, [strategy.data, preset]);

  const backtest = useQuery({
    queryKey: ['strategy-backtest', id, preset],
    queryFn: () => api.analyzerRun(params!),
    enabled: Boolean(params),
  });

  useEffect(() => {
    setActive(backtest.data?.alerts[0] ?? null);
    setDrawerAlert(null);
  }, [backtest.data]);

  const chart = useQuery({
    queryKey: ['strategy-chart', id, preset, active?.bucket],
    queryFn: () => api.analyzerChart(params!, active!.bucket, 100),
    enabled: Boolean(params && active),
  });

  const select = (a: BacktestAlert) => {
    setActive(a);
    setDrawerAlert(a);
  };

  if (strategy.isLoading || !strategy.data) return <Spinner label="Loading strategy…" />;
  const def = strategy.data;
  const result = backtest.data;

  return (
    <div>
      <PageHeader
        title={def.name}
        subtitle={def.description ?? 'Strategy dashboard — live stats and historical backtest.'}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={def.status === 'active' ? 'bull' : 'warn'}>{def.status}</Badge>
            <Link to={`/builder/${def.id}`} className="btn-ghost text-xs">
              <Pencil className="w-4 h-4" /> Edit
            </Link>
          </div>
        }
      />

      {/* Live (persisted) stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
        <StatCard label="Alerts Today" value={stats.data?.alertsToday ?? '—'} tone="accent" />
        <StatCard label="This Week" value={stats.data?.alertsThisWeek ?? '—'} />
        <StatCard label="This Month" value={stats.data?.alertsThisMonth ?? '—'} />
        <StatCard label="Total (live)" value={stats.data?.totalAlerts ?? '—'} />
        <StatCard label="Avg / Day" value={stats.data?.avgPerDay ?? '—'} />
        <StatCard label="Most Active" value={stats.data?.mostActiveSymbol ?? '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-1">
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Definition</h2>
          <pre className="whitespace-pre-wrap text-xs text-slate-300 font-mono leading-relaxed">{groupText(def.root)}</pre>
          <div className="mt-3 pt-3 border-t border-ink-700/60 text-xs text-slate-500">
            {def.underlying} · {def.strikeSelection} · {def.expiryType} · {def.timeframe}
          </div>
        </Card>

        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-300">Historical Backtest</h2>
            <select className="input py-1 text-xs" value={preset} onChange={(e) => setPreset(e.target.value as DateRangePreset)}>
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {backtest.isFetching ? <Spinner label="Running backtest…" /> : result ? <SummaryCards stats={result.stats} /> : null}
        </div>
      </div>

      {result && result.alerts.length > 0 ? (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
            <div className="xl:col-span-2 space-y-6">
              <TradingChart data={chart.data ?? null} loading={chart.isFetching} />
              <AlertTable alerts={result.alerts} onSelect={select} selectedId={active?.id} />
            </div>
            <AlertTimeline alerts={result.alerts} selectedId={active?.id} onSelect={select} />
          </div>
          <div className="space-y-6">
            <Heatmaps stats={result.stats} />
            <AnalyticsPanel stats={result.stats} />
          </div>
        </>
      ) : result ? (
        <Card>
          <EmptyState title="No alerts in this period" hint="Try a wider date range." />
        </Card>
      ) : null}

      <AlertDetailDrawer alert={drawerAlert} onClose={() => setDrawerAlert(null)} />
    </div>
  );
}
