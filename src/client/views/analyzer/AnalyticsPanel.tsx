import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BacktestStats, CountBucket } from '@ash/shared';
import { Card, EmptyState } from '../../components/ui';

const AXIS = { stroke: '#64748b', fontSize: 11 };
const TOOLTIP = { background: '#131a28', border: '1px solid #2e3a52', borderRadius: 8, color: '#e2e8f0' };

function Bars({ title, data, color }: { title: string; data: CountBucket[]; color: string }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-300 mb-3">{title}</h3>
      {data.length === 0 ? (
        <EmptyState title="No data" />
      ) : (
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -18 }}>
              <XAxis dataKey="key" tick={AXIS} axisLine={{ stroke: '#2e3a52' }} tickLine={false} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: '#1a223333' }} />
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
