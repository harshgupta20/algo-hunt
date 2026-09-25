'use client';

/**
 * Alert analytics (formerly its own page), shown as the Dashboard's
 * "Performance" section: frequency by day / week / underlying, the scenario
 * split and the most active contracts.
 */
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import type { AnalyticsSummary, CountBucket } from '@ash/shared';
import { useChartPalette } from '../lib/chartTheme';
import { HELP } from '../lib/help';
import { Card, EmptyState } from './ui';
import { InfoTip, type TooltipContent } from './Tooltip';

function BarPanel({ title, data, color, help, className }: { title: string; data: CountBucket[]; color: string; help: TooltipContent; className?: string }) {
  const chart = useChartPalette();
  const axis = { fill: chart.axis, fontSize: 11 };
  return (
    <Card className={className}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
        {title} <InfoTip content={help} />
      </h3>
      {data.length === 0 ? (
        <EmptyState title="No alerts yet" />
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
              <XAxis dataKey="key" tick={axis} axisLine={{ stroke: chart.axisLine }} tickLine={false} />
              <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
              <ChartTooltip contentStyle={chart.tooltip} cursor={{ fill: chart.cursor }} />
              <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export function PerformanceSection({ data }: { data: AnalyticsSummary }) {
  const chart = useChartPalette();
  const scenarioData = [
    { key: 'Scenario 1', count: data.scenario1Count },
    { key: 'Scenario 2', count: data.scenario2Count },
  ];
  // Both scenarios are bullish signals: solid green (S1) and a lighter green (S2).
  const scenarioColors = [chart.bull, `${chart.bull}80`];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <BarPanel className="lg:col-span-2" title="Alerts per Day" data={data.alertsPerDay} color={chart.series} help={HELP.analytics.perDay} />

      <Card>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
          Scenario Split <InfoTip content={HELP.analytics.scenarioSplit} />
        </h3>
        {data.scenario1Count + data.scenario2Count === 0 ? (
          <EmptyState title="No built-in alerts yet" />
        ) : (
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={scenarioData} dataKey="count" nameKey="key" outerRadius={80} label>
                  {scenarioData.map((_, i) => (
                    <Cell key={i} fill={scenarioColors[i]} />
                  ))}
                </Pie>
                <ChartTooltip contentStyle={chart.tooltip} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <BarPanel title="Alerts per Underlying" data={data.alertsPerUnderlying} color={chart.series} help={HELP.analytics.perUnderlying} />
      <BarPanel title="Alerts per Week" data={data.alertsPerWeek} color={chart.seriesSoft} help={HELP.analytics.perWeek} />

      <Card>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
          Most Active Contracts <InfoTip content={HELP.analytics.mostActive} />
          <span className="ml-auto text-xs font-normal text-slate-500">{data.mostActiveSymbols.length} symbols</span>
        </h3>
        {data.mostActiveSymbols.length === 0 ? (
          <EmptyState title="No alerts yet" />
        ) : (
          <ul className="divide-y divide-ink-700/50">
            {data.mostActiveSymbols.slice(0, 7).map((s) => (
              <li key={s.key} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-slate-200">{s.key}</span>
                <span className="tabular-nums font-semibold text-accent-soft">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
