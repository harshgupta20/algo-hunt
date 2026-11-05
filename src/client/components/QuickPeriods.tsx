'use client';

/**
 * The quick-period buttons of every backtest: 1D · 1W · 1M · 3M · 6M · 1Y · 2Y · 3Y (+ a section's extras). Each fills
 * the period with the last N days ending on the latest trading day (rules in periods.ts); the one matching the
 * period exactly is highlighted.
 */
import clsx from 'clsx';
import { Tooltip, type TooltipContent } from './Tooltip';
import { QUICK_PERIOD_SPEC, quickFrom, type QuickPeriodKey } from './periods';

export interface DateRange {
  from: string;
  to: string;
}

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The range a quick period stands for: from its first day (ending on `end`) to `to`. */
export const quickRange = (key: QuickPeriodKey, end: string, to: string): DateRange => ({ from: quickFrom(end, key), to });

export function QuickPeriods({ keys, end, to, value, onPick, help }: { keys: readonly QuickPeriodKey[]; end: string; to: string; value: DateRange; onPick: (r: DateRange) => void; help: TooltipContent }) {
  return (
    <>
      {keys.map((k) => {
        const r = quickRange(k, end, to);
        const on = value.from === r.from && value.to === r.to;
        return (
          <Tooltip
            key={k}
            content={{
              ...help,
              title: `Last ${QUICK_PERIOD_SPEC[k].words}`,
              body: (
                <>
                  {day(r.from)} → {day(end)}. {help.body}
                </>
              ),
              note: on ? 'Selected — the period above is exactly this.' : help.note,
            }}
          >
            <button type="button" aria-pressed={on} className={clsx('py-1 text-xs', on ? 'btn-primary' : 'btn-ghost')} onClick={() => onPick(r)}>
              {k}
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}
