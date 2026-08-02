import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileJson, FileSpreadsheet, FileText } from 'lucide-react';
import type { AnalyzerParams, BacktestAlert } from '@ash/shared';
import { api } from '../lib/api';
import { exportCsv, exportJson, exportXlsx } from '../lib/export';
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { FilterBar } from './analyzer/FilterBar';
import { SummaryCards } from './analyzer/SummaryCards';
import { AlertTable } from './analyzer/AlertTable';
import { AlertDetailDrawer } from './analyzer/AlertDetailDrawer';
import { TradingChart } from './analyzer/TradingChart';
import { AlertTimeline } from './analyzer/AlertTimeline';
import { Heatmaps } from './analyzer/Heatmaps';
import { AnalyticsPanel } from './analyzer/AnalyticsPanel';

export function StrategyAnalyzer() {
  const [params, setParams] = useState<AnalyzerParams | null>(null);
  const [active, setActive] = useState<BacktestAlert | null>(null);
  const [drawerAlert, setDrawerAlert] = useState<BacktestAlert | null>(null);

  const runMut = useMutation({
    mutationFn: (p: AnalyzerParams) => api.analyzerRun(p),
    onSuccess: (res) => {
      setActive(res.alerts[0] ?? null);
      setDrawerAlert(null);
    },
  });

  const chart = useQuery({
    queryKey: ['analyzer-chart', params, active?.bucket],
    queryFn: () => api.analyzerChart(params!, active!.bucket, 100),
    enabled: Boolean(params && active),
  });

  const result = runMut.data;

  const analyze = (p: AnalyzerParams) => {
    setParams(p);
    runMut.mutate(p);
  };

  const select = (a: BacktestAlert) => {
    setActive(a);
    setDrawerAlert(a);
  };

  return (
    <div>
      <PageHeader
        title="Strategy Analyzer"
        subtitle="Replay the strategy on historical data using the exact same engine as the live alerts."
        actions={
          result && result.alerts.length > 0 ? (
            <div className="flex gap-2">
              <button className="btn-ghost text-xs" onClick={() => exportCsv(result)}>
                <FileText className="w-4 h-4" /> CSV
              </button>
              <button className="btn-ghost text-xs" onClick={() => exportJson(result)}>
                <FileJson className="w-4 h-4" /> JSON
              </button>
              <button className="btn-ghost text-xs" onClick={() => void exportXlsx(result)}>
                <FileSpreadsheet className="w-4 h-4" /> Excel
              </button>
            </div>
          ) : undefined
        }
      />

      <FilterBar onAnalyze={analyze} loading={runMut.isPending} />

      {runMut.isPending ? (
        <Card>
          <div className="py-8 flex justify-center">
            <Spinner label="Running backtest through the strategy engine…" />
          </div>
        </Card>
      ) : runMut.isError ? (
        <Card>
          <EmptyState title="Analysis failed" hint={(runMut.error as Error).message} />
        </Card>
      ) : !result ? (
        <Card>
          <EmptyState
            title="Configure filters and run an analysis"
            hint="Choose a date range, underlying, expiry, strike and timeframe, then click Analyze."
          />
        </Card>
      ) : (
        <>
          <SummaryCards stats={result.stats} />

          {result.alerts.length === 0 ? (
            <Card>
              <EmptyState title="No alerts in this period" hint="Try a wider date range or a different timeframe." />
            </Card>
          ) : (
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
          )}
        </>
      )}

      <AlertDetailDrawer alert={drawerAlert} onClose={() => setDrawerAlert(null)} />
    </div>
  );
}
