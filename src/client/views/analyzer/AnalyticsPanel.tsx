import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BacktestStats, CountBucket } from '@ash/shared';
import { Card, EmptyState } from '../../components/ui';
import { useChartPalette } from '../../lib/chartTheme';

function Bars({ title, data, color }: { title: string; data: CountBucket[]; color: string }) {
  const chart = useChartPalette();
  const axis = { fill: chart.axis, fontSize: 11 };
  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-300 mb-3">{title}</h3>
      {data.length === 0 ? (
        <EmptyState title="No data" />
      ) : (
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -18 }}>
              <XAxis dataKey="key" tick={axis} axisLine={{ stroke: chart.axisLine }} tickLine={false} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={chart.tooltip} cursor={{ fill: chart.cursor }} />
              <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export function AnalyticsPanel({ stats }: { stats: BacktestStats }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Bars title="Alerts per Day" data={stats.byDay} color="#3b82f6" />
      <Bars title="Alerts per Week" data={stats.byWeek} color="#60a5fa" />
      <Bars title="Alerts by Scenario" data={stats.byScenario} color="#22c55e" />
      <Bars title="Alerts by Timeframe" data={stats.byTimeframe} color="#f59e0b" />
    </div>
  );
}
