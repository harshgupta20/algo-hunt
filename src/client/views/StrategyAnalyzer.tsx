'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileJson, FileSpreadsheet, FileText, Pencil } from 'lucide-react';
import type { AnalyzerParams, BacktestAlert, StrategyDef } from '@ash/shared';
import { api } from '../lib/api';
import { exportCsv, exportJson, exportXlsx } from '../lib/export';
import { fmtRelative } from '../lib/format';
import { groupText } from '../lib/strategyText';
import { Card, EmptyState, Help, Spinner, StrategyStatusBadge } from '../components/ui';
import { InfoTip } from '../components/Tooltip';
import { HELP } from '../lib/help';
import { SignalLegend } from '../components/signal';
import { FilterBar } from './analyzer/FilterBar';
import { SummaryCards } from './analyzer/SummaryCards';
import { AlertTable } from './analyzer/AlertTable';
import { AlertDetailDrawer } from './analyzer/AlertDetailDrawer';
import { TradingChart } from './analyzer/TradingChart';
import { AlertTimeline } from './analyzer/AlertTimeline';
import { Heatmaps } from './analyzer/Heatmaps';
import { AnalyticsPanel } from './analyzer/AnalyticsPanel';

/** Rules + live alert stats for a custom strategy (what the old per-strategy page showed). */
function StrategyInsight({ def, onEdit }: { def: StrategyDef; onEdit: (id: string) => void }) {
  const stats = useQuery({ queryKey: ['strategy-stats', def.id], queryFn: () => api.strategyStats(def.id) });
  const s = stats.data;
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-fg font-semibold">{def.name}</h3>
            <StrategyStatusBadge status={def.status} />
          </div>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-300 font-mono leading-relaxed">{groupText(def.root)}</pre>
        </div>
        <Help content={HELP.backtest.editRules} className="shrink-0">
          <button className="btn-ghost text-xs" onClick={() => onEdit(def.id)}>
            <Pencil className="w-4 h-4" /> Edit rules
          </button>
        </Help>
      </div>
      <div className="mt-3 pt-3 border-t border-ink-700/60 flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        Live stats <InfoTip content={HELP.backtest.liveStats} />
      </div>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
        <Stat label="Live alerts today" value={s?.alertsToday} accent />
        <Stat label="This week" value={s?.alertsThisWeek} />
        <Stat label="This month" value={s?.alertsThisMonth} />
        <Stat label="All time" value={s?.totalAlerts} />
        <Stat label="Last triggered" value={s?.lastTriggered ? fmtRelative(s.lastTriggered) : s ? 'never' : undefined} />
      </div>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value?: number | string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={accent ? 'text-accent-soft font-semibold tabular-nums' : 'text-fg font-semibold tabular-nums'}>{value ?? '—'}</div>
    </div>
  );
}

export interface StrategyAnalyzerProps {
  /** Strategy opened from the library ("rsi-sync" or a custom id): pre-fill and run. */
  strategyId?: string;
  onEdit: (id: string) => void;
}

export function StrategyAnalyzer({ strategyId, onEdit }: StrategyAnalyzerProps) {
  const [params, setParams] = useState<AnalyzerParams | null>(null);
  const [active, setActive] = useState<BacktestAlert | null>(null);
  const [drawerAlert, setDrawerAlert] = useState<BacktestAlert | null>(null);

  const isCustom = Boolean(strategyId && strategyId !== 'rsi-sync');
  const opened = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => api.getStrategy(strategyId!),
    enabled: isCustom,
  });
  // The strategy of the last run, for the insight card.
  const ranCustomId = params && params.strategy !== 'rsi-sync' ? params.strategy : undefined;
  const ranDef = useQuery({
    queryKey: ['strategy', ranCustomId],
    queryFn: () => api.getStrategy(ranCustomId!),
    enabled: Boolean(ranCustomId),
  });

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

  // A strategy opened from the library: use its own scope, a short range, and run immediately.
  const initial: Partial<AnalyzerParams> | undefined = strategyId
    ? {
        strategy: strategyId,
        preset: 'last-week',
        ...(opened.data && {
          underlying: opened.data.underlying,
          expiryType: opened.data.expiryType,
          strikeSelection: opened.data.strikeSelection,
          timeframe: opened.data.timeframe,
        }),
      }
    : undefined;

  if (isCustom && opened.isLoading) return <Spinner label="Loading strategy…" />;

  return (
    <div>
      <FilterBar onAnalyze={analyze} loading={runMut.isPending} initial={initial} autoRun={Boolean(strategyId)} />

      {ranDef.data && <StrategyInsight def={ranDef.data} onEdit={onEdit} />}

      {runMut.isPending ? (
        <Card>
          <div className="py-8 flex justify-center">
            <Spinner label="Running backtest on Kite historical candles…" />
          </div>
        </Card>
      ) : runMut.isError ? (
        <Card>
          <EmptyState title="Backtest failed" hint={(runMut.error as Error).message} />
        </Card>
      ) : !result ? (
        <Card>
          <EmptyState
            title="Pick a strategy and date range, then Analyze"
            hint="Replays the strategy on historical candles with exactly the same engine as live alerts."
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <SignalLegend />
            {result.alerts.length > 0 && (
              <div className="flex gap-2">
                <Help content={HELP.backtest.csv}>
                  <button className="btn-ghost text-xs" onClick={() => exportCsv(result)}>
                    <FileText className="w-4 h-4" /> CSV
                  </button>
                </Help>
                <Help content={HELP.backtest.json}>
                  <button className="btn-ghost text-xs" onClick={() => exportJson(result)}>
                    <FileJson className="w-4 h-4" /> JSON
                  </button>
                </Help>
                <Help content={HELP.backtest.xlsx}>
                  <button className="btn-ghost text-xs" onClick={() => void exportXlsx(result)}>
                    <FileSpreadsheet className="w-4 h-4" /> Excel
                  </button>
                </Help>
              </div>
            )}
          </div>

          <SummaryCards stats={result.stats} />

          {result.alerts.length === 0 ? (
            <Card>
              <EmptyState title="No signals in this period" hint="Try a wider date range or a different timeframe." />
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
