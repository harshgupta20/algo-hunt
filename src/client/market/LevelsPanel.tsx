'use client';

/** Pivot levels and the central pivot range for the main indices, with today's level on a ladder. */
import clsx from 'clsx';
import type { PivotLevels } from '@/shared/market/types';
import { Tooltip } from '../components/Tooltip';
import { Section } from '../components/ui';
import { PivotLadder } from './charts';
import { fmtPrice, shortDay } from './format';
import { M } from './help';
import { Skeleton } from './parts';

const cprKind = (w: number) => (w < 0.25 ? { label: 'Narrow CPR', tone: 'text-accent-soft', note: 'often precedes a trending day' } : w > 0.6 ? { label: 'Wide CPR', tone: 'text-slate-400', note: 'often a range-bound day' } : { label: 'Normal CPR', tone: 'text-slate-400', note: '' });

export function LevelsPanel({ pivots }: { pivots: PivotLevels[] | undefined }) {
  return (
    <Section title="Key levels" help={M.levels}>
      {!pivots ? (
        <Skeleton className="h-64" />
      ) : !pivots.length ? (
        <p className="py-8 text-center text-xs text-slate-500">No daily data for pivots right now.</p>
      ) : (
        <div className="space-y-4">
          {pivots.map((p) => {
            const k = cprKind(p.cprWidthPct);
            const levels = [
              { key: 'S3', value: p.s3 },
              { key: 'S2', value: p.s2 },
              { key: 'S1', value: p.s1 },
              { key: 'BC', value: p.bc },
              { key: 'P', value: p.pivot },
              { key: 'TC', value: p.tc },
              { key: 'R1', value: p.r1 },
              { key: 'R2', value: p.r2 },
              { key: 'R3', value: p.r3 },
            ];
            return (
              <div key={p.symbol} className="rounded-lg bg-ink-850 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold text-fg">
                    {p.name} <span className="ml-1 text-xs font-normal tabular-nums text-slate-400">{fmtPrice(p.last)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <Tooltip content={{ title: `${k.label} · ${p.cprWidthPct.toFixed(2)}% of price`, body: `Central pivot range ${fmtPrice(p.bc)} – ${fmtPrice(p.tc)}.${k.note ? ` A ${k.label.toLowerCase()} ${k.note}.` : ''}` }}>
                      <span className={clsx('cursor-help rounded bg-ink-800 px-1.5 py-0.5', k.tone)}>{k.label}</span>
                    </Tooltip>
                    {p.position && (
                      <span className={clsx('rounded px-1.5 py-0.5', p.position === 'above' ? 'bg-bull/15 text-bull' : p.position === 'below' ? 'bg-bear/15 text-bear' : 'bg-ink-800 text-slate-400')}>
                        {p.position === 'above' ? 'Above CPR' : p.position === 'below' ? 'Below CPR' : 'Inside CPR'}
                      </span>
                    )}
                    <span className="text-slate-600">from {shortDay(p.basis.date)}</span>
                  </div>
                </div>
                <PivotLadder levels={levels} last={p.last} />
                <div className="grid grid-cols-9 gap-1 text-center text-[10px] tabular-nums">
                  {levels.map((l) => (
                    <div key={l.key}>
                      <div className={clsx('font-medium', l.key.startsWith('S') ? 'text-bull' : l.key.startsWith('R') ? 'text-bear' : 'text-accent-soft')}>{l.key}</div>
                      <div className="text-slate-300">{fmtPrice(l.value, 0)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
