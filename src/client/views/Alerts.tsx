'use client';

/**
 * Alerts: the live feed and the full history in one place (formerly
 * "Live Alerts" + "Alert History"). One set of filters drives both views;
 * new alerts stream in automatically (LiveContext refreshes the query).
 */
import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, LayoutGrid, List, Radio } from 'lucide-react';
import type { Alert, AlertHistoryFilters, ScenarioId, Segment, Timeframe } from '@ash/shared';
import { BUILTIN_STRATEGY_NAME, TIMEFRAMES, segmentOf } from '@ash/shared';
import { api } from '../lib/api';
import { useLive, type LiveHealth } from '../context/LiveContext';
import { Badge, Card, EmptyState, Help, PageHeader, RuleBadge, Spinner, Tabs } from '../components/ui';
import { AlertItem } from '../components/AlertItem';
import { LegTag, RsiValue, SignalLegend } from '../components/signal';
import { FieldLabel, InfoTip, Tooltip, type TooltipContent } from '../components/Tooltip';
import { fmtTime } from '../lib/format';
import { HELP } from '../lib/help';

type View = 'feed' | 'table';

const HEALTH: Record<LiveHealth, { label: string; tone: 'bull' | 'warn' | 'bear' | 'default'; help: TooltipContent }> = {
  live: { label: 'monitoring', tone: 'bull', help: HELP.topbar.live },
  stale: { label: 'scheduler idle', tone: 'warn', help: HELP.topbar.stale },
  'market-closed': { label: 'market closed', tone: 'default', help: HELP.topbar.marketClosed },
  'kite-offline': { label: 'kite offline', tone: 'bear', help: HELP.topbar.kiteOffline },
  unknown: { label: 'connecting', tone: 'default', help: HELP.topbar.connecting },
};

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(alerts: Alert[]): string {
  const header = ['triggeredAt', 'underlying', 'strike', 'expiry', 'timeframe', 'strategy', 'signal', 'futureRsi', 'callRsi', 'putRsi'];
  const rows = alerts.map((a) =>
    [
      a.triggeredAt,
      a.underlying,
      a.strike,
      a.expiry,
      a.timeframe,
      a.strategyName ?? BUILTIN_STRATEGY_NAME,
      a.scenario ? `Scenario ${a.scenario}` : (a.variant ?? ''),
      a.snapshot.futureRsi,
      a.snapshot.callRsi,
      a.snapshot.putRsi,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

export function Alerts() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view: View = params.get('view') === 'table' ? 'table' : 'feed';
  const setView = (v: View) => router.replace(v === 'table' ? `${pathname}?view=table` : pathname);

  const { health } = useLive();
  // Market filter; the MCX tab links here with ?segment=MCX.
  const [segment, setSegment] = useState<'' | Segment>(() => {
    const p = params.get('segment');
    return p === 'MCX' || p === 'NSE' ? p : '';
  });
  const [underlying, setUnderlying] = useState('');
  const [strategy, setStrategy] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [scenario, setScenario] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const nseUnderlyings = useQuery({ queryKey: ['underlyings', 'NSE'], queryFn: () => api.underlyings('NSE') });
  const mcxUnderlyings = useQuery({ queryKey: ['underlyings', 'MCX'], queryFn: () => api.underlyings('MCX') });
  const underlyingOptions = [
    ...(segment !== 'MCX' ? (nseUnderlyings.data ?? []) : []),
    ...(segment !== 'NSE' ? (mcxUnderlyings.data ?? []) : []),
  ];
  const strategies = useQuery({ queryKey: ['strategies-custom'], queryFn: api.listStrategies });
  const scenarioApplies = strategy === '' || strategy === 'rsi-sync';

  const filters: AlertHistoryFilters = useMemo(
    () => ({
      segment: segment || undefined,
      underlying: underlying || undefined,
      strategy: strategy || undefined,
      timeframe: (timeframe || undefined) as Timeframe | undefined,
      scenario: scenarioApplies && scenario ? (Number(scenario) as ScenarioId) : undefined,
      from: from || undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
      limit: 500,
    }),
    [segment, underlying, strategy, timeframe, scenario, scenarioApplies, from, to],
  );
  const alerts = useQuery({ queryKey: ['alerts', filters], queryFn: () => api.listAlerts(filters) });
  const list = alerts.data ?? [];
  const filtered = Boolean(segment || underlying || strategy || timeframe || scenario || from || to);

  const download = () => {
    const blob = new Blob([toCsv(list)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'algo-hunt-alerts.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setSegment('');
    setUnderlying('');
    setStrategy('');
    setTimeframe('');
    setScenario('');
    setFrom('');
    setTo('');
  };

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Live feed and full history — every alert your strategies fire, newest first."
        actions={
          <>
            <Tooltip content={HEALTH[health].help} side="bottom">
              <Badge tone={HEALTH[health].tone}>
                <Radio className="w-3 h-3 mr-1" /> {HEALTH[health].label}
              </Badge>
            </Tooltip>
            <Help content={HELP.history.exportCsv} side="left">
              <button className="btn-ghost" onClick={download} disabled={list.length === 0}>
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </Help>
          </>
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 items-end">
          <div>
            <FieldLabel help={HELP.alertsPage.market}>Market</FieldLabel>
            <select
              className="input w-full"
              value={segment}
              onChange={(e) => {
                const next = e.target.value as '' | Segment;
                setSegment(next);
                if (next && underlying && segmentOf(underlying) !== next) setUnderlying('');
              }}
            >
              <option value="">All</option>
              <option value="NSE">NSE/BSE</option>
              <option value="MCX">MCX</option>
            </select>
          </div>
          <div>
            <FieldLabel help={HELP.field.underlying}>Underlying</FieldLabel>
            <select className="input w-full" value={underlying} onChange={(e) => setUnderlying(e.target.value)}>
              <option value="">All</option>
              {underlyingOptions.map((u) => (
                <option key={u.symbol} value={u.symbol}>
                  {u.symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <FieldLabel help={HELP.alertsPage.strategy}>Strategy</FieldLabel>
            <select className="input w-full" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="">All strategies</option>
              <option value="rsi-sync">{BUILTIN_STRATEGY_NAME} (built-in)</option>
              {strategies.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel help={HELP.field.timeframe}>Timeframe</FieldLabel>
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
            <FieldLabel help={{ ...HELP.history.scenario, note: scenarioApplies ? undefined : 'Scenarios belong to the built-in strategy.' }}>Scenario</FieldLabel>
            <select className="input w-full" value={scenarioApplies ? scenario : ''} disabled={!scenarioApplies} onChange={(e) => setScenario(e.target.value)}>
              <option value="">All</option>
              <option value="1">Scenario 1</option>
              <option value="2">Scenario 2</option>
            </select>
          </div>
          <div>
            <FieldLabel help={HELP.history.from}>From</FieldLabel>
            <input type="date" className="input w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <FieldLabel help={HELP.history.to}>To</FieldLabel>
            <input type="date" className="input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: 'feed', label: 'Feed', icon: LayoutGrid, help: HELP.alertsPage.feed },
              { value: 'table', label: 'Table', icon: List, help: HELP.alertsPage.table },
            ]}
          />
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <span className="font-semibold text-fg tabular-nums">{alerts.isLoading ? '…' : list.length}</span>
            {list.length === 1 ? 'alert' : 'alerts'}
            <InfoTip content={HELP.alertsPage.count} />
          </span>
          {filtered && (
            <Help content={HELP.history.reset}>
              <button className="text-xs font-medium text-accent-soft hover:underline" onClick={reset}>
                Clear filters
              </button>
            </Help>
          )}
        </div>
        <SignalLegend />
      </div>

      {alerts.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title={filtered ? 'No alerts match these filters' : 'Waiting for alerts'}
            hint={
              filtered
                ? 'Clear or widen the filters.'
                : 'When a strategy’s conditions line up on a closed candle, the alert appears here within seconds of the candle closing.'
            }
          />
        </Card>
      ) : view === 'feed' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((a) => (
            <AlertItem key={a.id} alert={a} />
          ))}
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-ink-850">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Underlying</th>
                  <th className="px-4 py-3">Strike</th>
                  <th className="px-4 py-3">Expiry</th>
                  <th className="px-4 py-3">TF</th>
                  <th className="px-4 py-3">Strategy</th>
                  <th className="px-4 py-3">Signal</th>
                  <th className="px-4 py-3 text-right"><LegTag leg="future" /></th>
                  <th className="px-4 py-3 text-right"><LegTag leg="call" /></th>
                  <th className="px-4 py-3 text-right"><LegTag leg="put" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {list.map((a) => (
                  <tr key={a.id} className="hover:bg-ink-850/60">
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{fmtTime(a.triggeredAt)}</td>
                    <td className="px-4 py-3 text-fg font-medium">{a.underlying}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {a.strike ? (
                        a.strike
                      ) : (
                        <Tooltip content={HELP.alertsPage.noStrike}>
                          <span tabIndex={0} className="text-slate-500 cursor-help">—</span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{a.expiry || '—'}</td>
                    <td className="px-4 py-3">{a.timeframe}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{a.strategyName ?? BUILTIN_STRATEGY_NAME}</td>
                    <td className="px-4 py-3">
                      <RuleBadge scenario={a.scenario} variant={a.variant} compact />
                    </td>
                    <td className="px-4 py-3 text-right font-medium"><RsiValue value={a.snapshot.futureRsi} /></td>
                    <td className="px-4 py-3 text-right font-medium"><RsiValue value={a.snapshot.callRsi} /></td>
                    <td className="px-4 py-3 text-right font-medium"><RsiValue value={a.snapshot.putRsi} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
