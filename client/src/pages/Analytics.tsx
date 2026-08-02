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

const AXIS = { stroke: '#64748b', fontSize: 11 };
const TOOLTIP_STYLE = { background: '#131a28', border: '1px solid #2e3a52', borderRadius: 8, color: '#e2e8f0' };

function BarPanel({ title, data, color }: { title: string; data: CountBucket[]; color: string }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-300 mb-3">{title}</h3>
      {data.length === 0 ? (
        <EmptyState title="No data yet" />
      ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
              <XAxis dataKey="key" tick={AXIS} axisLine={{ stroke: '#2e3a52' }} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#1a223333' }} />
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

  if (analytics.isLoading) return <Spinner />;
  const data = analytics.data;
  if (!data) return <EmptyState title="No analytics available" />;

  const scenarioData = [
    { key: 'Scenario 1', count: data.scenario1Count },
    { key: 'Scenario 2', count: data.scenario2Count },
  ];
  const scenarioColors = ['#3b82f6', '#f59e0b'];

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Alert distribution across time, underlyings, expiries and scenarios." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Alerts" value={data.totalAlerts} tone="accent" />
        <StatCard label="Scenario 1" value={data.scenario1Count} />
        <StatCard label="Scenario 2" value={data.scenario2Count} />
        <StatCard label="Active Symbols" value={data.mostActiveSymbols.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarPanel title="Alerts per Day" data={data.alertsPerDay} color="#3b82f6" />
        <BarPanel title="Alerts per Underlying" data={data.alertsPerUnderlying} color="#22c55e" />
        <BarPanel title="Alerts per Week" data={data.alertsPerWeek} color="#60a5fa" />

        <Card>
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Scenario Split</h3>
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
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Most Active Symbols</h3>
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
