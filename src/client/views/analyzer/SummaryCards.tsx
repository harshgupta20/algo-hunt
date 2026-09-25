import type { BacktestStats } from '@ash/shared';
import { StatCard } from '../../components/ui';
import { HELP } from '../../lib/help';

export function SummaryCards({ stats }: { stats: BacktestStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
      <StatCard label="Total Alerts" value={stats.totalAlerts} tone="accent" help={HELP.stats.btTotal} />
      <StatCard label="Scenario 1" value={stats.scenario1} tone="bull" help={HELP.scenario[1]} />
      <StatCard label="Scenario 2" value={stats.scenario2} tone="bull" help={HELP.scenario[2]} />
      <StatCard label="Avg / Day" value={stats.avgPerDay} help={HELP.stats.avgDay} />
      <StatCard label="Max / Day" value={stats.maxPerDay} help={HELP.stats.maxDay} />
      <StatCard label="Min / Day" value={stats.minPerDay} help={HELP.stats.minDay} />
      <StatCard label="Avg / Week" value={stats.avgPerWeek} help={HELP.stats.avgWeek} />
    </div>
  );
}
