/**
 * Trader-facing color notation (see lib/signals.ts): leg identity tags,
 * zone-colored RSI values, and a compact legend explaining the colors.
 */
import clsx from 'clsx';
import type { Leg } from '@ash/shared';
import { fmtRsi } from '../lib/format';
import { LEGS, RSI_LOWER, RSI_UPPER, TONE_TEXT, rsiZone } from '../lib/signals';
import { HELP } from '../lib/help';
import { Tooltip } from './Tooltip';

/** "● FUT" / "● CE" / "● PE" — identifies an instrument leg by its color. */
export function LegTag({ leg, full, className }: { leg: Leg; full?: boolean; className?: string }) {
  const m = LEGS[leg];
  return (
    <Tooltip content={HELP.legs[leg]}>
      <span className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold', m.text, className)}>
        <span className={clsx('w-2 h-2 rounded-full', m.dot)} />
        {full ? `${m.name} (${m.short})` : m.short}
      </span>
    </Tooltip>
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
  const tone = rsiZone(value, upper, lower);
  if (value == null) return <span className={clsx('tabular-nums text-slate-500', className)}>—</span>;
  return (
    <Tooltip content={{ ...HELP.zones[tone], title: `RSI ${fmtRsi(value)} · ${HELP.zones[tone].title}` }}>
      <span className={clsx('tabular-nums', TONE_TEXT[tone], className)}>{fmtRsi(value)}</span>
    </Tooltip>
  );
}

/** Inline key for the color language, shown where colored readings appear. */
export function SignalLegend({ className }: { className?: string }) {
  const Dot = ({ tone, label }: { tone: 'bull' | 'bear' | 'neutral'; label: string }) => (
    <Tooltip content={HELP.zones[tone]}>
      <span className="flex items-center gap-1.5 cursor-help">
        <span className={clsx('w-2 h-2 rounded-full', tone === 'bull' ? 'bg-bull' : tone === 'bear' ? 'bg-bear' : 'bg-slate-500')} /> {label}
      </span>
    </Tooltip>
  );
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500', className)}>
      <Dot tone="bull" label={`RSI ≥ ${RSI_UPPER} bullish`} />
      <Dot tone="bear" label={`RSI ≤ ${RSI_LOWER} bearish`} />
      <Dot tone="neutral" label="neutral" />
      <span className="flex items-center gap-3 border-l border-ink-700 pl-4">
        <LegTag leg="future" />
        <LegTag leg="call" />
        <LegTag leg="put" />
      </span>
    </div>
  );
}
