import clsx from 'clsx';
import { fmtRsi } from '../lib/format';

interface Props {
  label: string;
  rsi: number | null;
  level: number;
  /** The side that satisfies this leg's condition: future/call = 'above', put = 'below'. */
  triggerSide: 'above' | 'below';
}

/** Compact 0–100 RSI meter with the configured level marked. */
export function RsiGauge({ label, rsi, level, triggerSide }: Props) {
  const value = rsi ?? 0;
  const inZone = rsi != null && (triggerSide === 'above' ? rsi >= level : rsi <= level);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
        <span className={clsx('text-sm font-semibold tabular-nums', inZone ? 'text-bull' : 'text-slate-200')}>
          {fmtRsi(rsi)}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-ink-800 overflow-hidden">
        <div
          className={clsx('absolute inset-y-0 left-0 rounded-full transition-all', inZone ? 'bg-bull' : 'bg-accent')}
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
        {/* level marker */}
        <div className="absolute inset-y-0 w-px bg-slate-100/70" style={{ left: `${level}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>0</span>
        <span>
          level {level} · {triggerSide === 'above' ? 'cross ↑' : 'cross ↓'}
        </span>
        <span>100</span>
      </div>
    </div>
  );
}
