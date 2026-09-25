import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { Leg } from '@ash/shared';
import { RSI_LOWER, RSI_UPPER, TONE_BG, TONE_TEXT, rsiZone } from '../lib/signals';
import { fmtRsi } from '../lib/format';
import { LegTag } from './signal';

interface Props {
  leg: Leg;
  /** Extra context after the leg tag, e.g. "ATM 25000". */
  detail?: string;
  rsi: number | null;
  level: number;
  /** The side that satisfies this leg's condition: future/call = 'above', put = 'below'. */
  triggerSide: 'above' | 'below';
}

/**
 * 0–100 RSI meter. The bar is colored by momentum zone (green ≥ 60, red ≤ 40,
 * neutral between) with faint zone bands on the track; a "met" chip shows when
 * this leg satisfies its condition, and the tick marks the configured level.
 */
export function RsiGauge({ leg, detail, rsi, level, triggerSide }: Props) {
  const value = rsi ?? 0;
  const met = rsi != null && (triggerSide === 'above' ? rsi >= level : rsi <= level);
  const tone = rsiZone(rsi);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <LegTag leg={leg} />
          {detail && <span className="text-[11px] text-slate-500 truncate">{detail}</span>}
        </span>
        <span className="flex items-center gap-2">
          {met && (
            <span className="inline-flex items-center gap-0.5 rounded bg-bull/15 px-1.5 py-px text-[10px] font-semibold text-bull">
              <Check className="w-3 h-3" /> met
            </span>
          )}
          <span className={clsx('text-sm font-semibold tabular-nums', TONE_TEXT[tone])}>{fmtRsi(rsi)}</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-ink-800 overflow-hidden">
        {/* zone bands */}
        <div className="absolute inset-y-0 left-0 bg-bear/10" style={{ width: `${RSI_LOWER}%` }} />
        <div className="absolute inset-y-0 right-0 bg-bull/10" style={{ width: `${100 - RSI_UPPER}%` }} />
        <div
          className={clsx('absolute inset-y-0 left-0 rounded-full transition-all', rsi == null ? 'bg-transparent' : TONE_BG[tone])}
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
        {/* configured level */}
        <div className="absolute inset-y-0 w-0.5 bg-fg/70" style={{ left: `${level}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>0</span>
        <span>
          {triggerSide === 'above' ? `needs ≥ ${level}` : `needs ≤ ${level}`}
        </span>
        <span>100</span>
      </div>
    </div>
  );
}
