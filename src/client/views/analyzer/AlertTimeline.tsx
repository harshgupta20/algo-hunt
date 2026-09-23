import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import type { BacktestAlert } from '@ash/shared';
import { EmptyState } from '../../components/ui';

export function AlertTimeline({
  alerts,
  selectedId,
  onSelect,
}: {
  alerts: BacktestAlert[];
  selectedId?: string;
  onSelect: (a: BacktestAlert) => void;
}) {
  return (
    <div className="card p-0 overflow-hidden flex flex-col">
      <div className="p-3 border-b border-ink-700/60">
        <h3 className="text-sm font-semibold text-slate-300">Timeline ({alerts.length})</h3>
      </div>
      {alerts.length === 0 ? (
        <EmptyState title="No alerts" />
      ) : (
        <div className="overflow-y-auto max-h-[520px] p-3">
          <ol className="relative border-l border-ink-700 ml-2">
            {alerts.map((a) => (
              <li key={a.id} className="mb-3 ml-4">
                <span
                  className={clsx(
                    'absolute -left-[7px] w-3 h-3 rounded-full border-2 border-ink-900',
                    a.scenario === 2 ? 'bg-warn' : 'bg-accent',
                  )}
                />
                <button
                  onClick={() => onSelect(a)}
                  className={clsx(
                    'w-full text-left rounded-lg px-3 py-2 text-sm transition-colors',
                    selectedId === a.id ? 'bg-accent/15 text-white' : 'hover:bg-ink-850 text-slate-300',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono">{format(parseISO(a.timestamp), 'dd MMM HH:mm')}</span>
                    <span className={clsx('text-xs', a.scenario === 2 ? 'text-warn' : 'text-accent-soft')}>
                      {a.scenario ? `S${a.scenario}` : (a.variant ?? 'Trig')}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
