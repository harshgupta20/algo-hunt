import type { BacktestStats } from '@ash/shared';
import { StatCard } from '../../components/ui';

export function SummaryCards({ stats }: { stats: BacktestStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
      <StatCard label="Total Alerts" value={stats.totalAlerts} tone="accent" />
      <StatCard label="Scenario 1" value={stats.scenario1} tone="bull" />
      <StatCard label="Scenario 2" value={stats.scenario2} tone="bull" />
      <StatCard label="Avg / Day" value={stats.avgPerDay} />
      <StatCard label="Max / Day" value={stats.maxPerDay} />
      <StatCard label="Min / Day" value={stats.minPerDay} />
      <StatCard label="Avg / Week" value={stats.avgPerWeek} />
    </div>
  );
}
