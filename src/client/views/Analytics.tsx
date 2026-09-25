'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CountBucket } from '@ash/shared';
import { api } from '../lib/api';
import { Card, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui';
import { useChartPalette } from '../lib/chartTheme';
import { InfoTip, type TooltipContent } from '../components/Tooltip';
import { HELP } from '../lib/help';

function BarPanel({ title, data, color, help }: { title: string; data: CountBucket[]; color: string; help: TooltipContent }) {
  const chart = useChartPalette();
  const axis = { fill: chart.axis, fontSize: 11 };
  return (
    <Card>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
        {title} <InfoTip content={help} />
      </h3>
      {data.length === 0 ? (
        <EmptyState title="No data yet" />
      ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
              <XAxis dataKey="key" tick={axis} axisLine={{ stroke: chart.axisLine }} tickLine={false} />
              <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={chart.tooltip} cursor={{ fill: chart.cursor }} />
              <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export function Analytics() {
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: api.analytics });
  const chart = useChartPalette();

  if (analytics.isLoading) return <Spinner />;
  const data = analytics.data;
  if (!data) return <EmptyState title="No analytics available" />;

  const scenarioData = [
    { key: 'Scenario 1', count: data.scenario1Count },
    { key: 'Scenario 2', count: data.scenario2Count },
  ];
  // Both scenarios are bullish signals: solid green (S1) and a lighter green (S2).
  const scenarioColors = [chart.bull, `${chart.bull}80`];

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Alert distribution across time, underlyings, expiries and scenarios." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Alerts" value={data.totalAlerts} tone="accent" help={HELP.stats.totalAlerts} />
        <StatCard label="Scenario 1" value={data.scenario1Count} tone="bull" help={HELP.scenario[1]} />
        <StatCard label="Scenario 2" value={data.scenario2Count} tone="bull" help={HELP.scenario[2]} />
        <StatCard label="Active Symbols" value={data.mostActiveSymbols.length} help={HELP.stats.activeSymbols} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarPanel title="Alerts per Day" data={data.alertsPerDay} color={chart.series} help={HELP.analytics.perDay} />
        <BarPanel title="Alerts per Underlying" data={data.alertsPerUnderlying} color={chart.series} help={HELP.analytics.perUnderlying} />
        <BarPanel title="Alerts per Week" data={data.alertsPerWeek} color={chart.seriesSoft} help={HELP.analytics.perWeek} />

        <Card>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
            Scenario Split <InfoTip content={HELP.analytics.scenarioSplit} />
          </h3>
          {data.totalAlerts === 0 ? (
            <EmptyState title="No data yet" />
          ) : (
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={scenarioData} dataKey="count" nameKey="key" outerRadius={90} label>
                    {scenarioData.map((_, i) => (
                      <Cell key={i} fill={scenarioColors[i]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chart.tooltip} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
          Most Active Symbols <InfoTip content={HELP.analytics.mostActive} />
        </h3>
        {data.mostActiveSymbols.length === 0 ? (
          <EmptyState title="No data yet" />
        ) : (
          <ul className="divide-y divide-ink-700/50">
            {data.mostActiveSymbols.map((s) => (
              <li key={s.key} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-200">{s.key}</span>
                <span className="tabular-nums text-accent-soft">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
