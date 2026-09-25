/**
 * Trader-facing color notation (see lib/signals.ts): leg identity tags,
 * zone-colored RSI values, and a compact legend explaining the colors.
 */
import clsx from 'clsx';
import type { Leg } from '@ash/shared';
import { fmtRsi } from '../lib/format';
import { LEGS, RSI_LOWER, RSI_UPPER, TONE_TEXT, rsiZone } from '../lib/signals';

/** "● FUT" / "● CE" / "● PE" — identifies an instrument leg by its color. */
export function LegTag({ leg, full, className }: { leg: Leg; full?: boolean; className?: string }) {
  const m = LEGS[leg];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold', m.text, className)} title={m.name}>
      <span className={clsx('w-2 h-2 rounded-full', m.dot)} />
      {full ? `${m.name} (${m.short})` : m.short}
    </span>
  );
}

/** An RSI number colored by zone: green ≥ upper, red ≤ lower, neutral in between. */
export function RsiValue({
  value,
  upper = RSI_UPPER,
  lower = RSI_LOWER,
  className,
}: {
  value: number | null | undefined;
  upper?: number;
  lower?: number;
  className?: string;
}) {
  return <span className={clsx('tabular-nums', TONE_TEXT[rsiZone(value, upper, lower)], className)}>{fmtRsi(value)}</span>;
}

/** Inline key for the color language, shown where colored readings appear. */
export function SignalLegend({ className }: { className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500', className)}>
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-bull" /> RSI ≥ {RSI_UPPER} bullish
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-bear" /> RSI ≤ {RSI_LOWER} bearish
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-slate-500" /> neutral
      </span>
      <span className="flex items-center gap-3 border-l border-ink-700 pl-4">
        <LegTag leg="future" />
        <LegTag leg="call" />
        <LegTag leg="put" />
      </span>
    </div>
  );
}
