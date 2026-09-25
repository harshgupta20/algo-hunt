import clsx from 'clsx';
import type { BacktestStats, CountBucket } from '@ash/shared';
import { Card } from '../../components/ui';
import { InfoTip, type TooltipContent } from '../../components/Tooltip';
import { HELP } from '../../lib/help';

function HeatRow({ title, data, help }: { title: string; data: CountBucket[]; help: TooltipContent }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <Card>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
        {title} <InfoTip content={help} />
      </h3>
      <div className="flex gap-1.5">
        {data.map((d) => {
          const alpha = 0.12 + 0.88 * (d.count / max);
          return (
            <div key={d.key} className="flex-1 min-w-0">
              <div
                className={clsx(
                  'h-14 rounded-md flex items-center justify-center text-sm font-semibold tabular-nums border border-ink-700/40',
                  d.count > 0 && alpha >= 0.55 ? 'text-white' : 'text-fg', // white only on strong fills
                )}
                style={{ background: `rgba(59,130,246,${d.count === 0 ? 0.04 : alpha})` }}
              >
                {d.count}
              </div>
              <div className="text-[10px] text-slate-500 text-center mt-1 truncate">{d.key}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function Heatmaps({ stats }: { stats: BacktestStats }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <HeatRow title="Alerts by Weekday" data={stats.byWeekday} help={HELP.backtest.weekday} />
      <HeatRow title="Alerts by Trading Hour" data={stats.byHour} help={HELP.backtest.hour} />
    </div>
  );
}
