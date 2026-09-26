'use client';

/** "Why would it (not) fire" for a strategy on a product, per unit. */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { LegDef } from '@/shared/v2';
import { Tooltip } from '../components/Tooltip';
import { EmptyState } from '../components/ui';
import type { ExplainResult } from './api';
import { InstrumentChip, LegBadge, LegPrices, OutcomeBadge, TraceView, TriBadge, UnitStateBadge, UnitTag } from './components';
import { candleRange, fmtNum, istStamp, istStampMs } from './format';

export function ExplainView({ result, legs, symbol }: { result: ExplainResult; legs: LegDef[]; symbol: string }) {
  const [open, setOpen] = useState<string | null>(result.units.find((u) => u.outcome)?.unit.key ?? result.units[0]?.unit.key ?? null);
  const tf = result.units[0]?.evaluation?.triggerTimeframe;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-400">
        Evaluated {istStampMs(result.evaluatedAt)} IST on the {tf ? candleRange(result.triggerCandle, tf) : istStamp(result.triggerCandle)} candle · {result.requests} data request
        {result.requests === 1 ? '' : 's'}
        {result.references.length > 0 && <> · ATM from {result.references.map((r) => `${r.symbol} ${fmtNum(r.ltp)}`).join(', ')}</>}
      </p>
      {result.errors.map((e) => (
        <p key={e} className="text-xs text-warn">
          {e}
        </p>
      ))}
      {result.notes.map((e) => (
        <p key={e} className="text-[11px] text-slate-500">
          {e}
        </p>
      ))}
      {result.units.length === 0 && <EmptyState title="Nothing to evaluate" hint="See the messages above." />}
      {result.units.map((u) => {
        const isOpen = open === u.unit.key;
        return (
          <div key={u.unit.key} className="rounded-lg border border-ink-700/60 bg-ink-850">
            <button type="button" onClick={() => setOpen(isOpen ? null : u.unit.key)} className="w-full flex flex-wrap items-center gap-3 px-3 py-2 text-left">
              {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
              <UnitTag unit={u.unit} symbol={symbol} />
              <TriBadge value={u.evaluation?.result} />
              <Tooltip content={{ title: 'Previous candle', body: 'The result on the trigger candle before this one. “Becomes true” alerts need it to be False.' }}>
                <span className="text-[11px] text-slate-500">prev {u.prevResult ?? '—'}</span>
              </Tooltip>
              {u.outcome ? <OutcomeBadge outcome={u.outcome} /> : <span className="text-[11px] text-slate-500">no alert</span>}
              {u.state && <UnitStateBadge state={u.state.state} />}
              <span className="ml-auto">
                <LegPrices prices={u.evaluation?.prices} legs={legs} />
              </span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 border-t border-ink-700/60 pt-2 flex flex-col gap-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {legs.map((l) => {
                    const i = u.unit.legs[l.id];
                    return (
                      <span key={l.id} className="inline-flex items-center gap-1.5">
                        <LegBadge leg={l} /> {i ? <InstrumentChip i={i} /> : <span className="text-xs text-warn">not listed</span>}
                      </span>
                    );
                  })}
                </div>
                {u.error && <p className="text-xs text-bear">{u.error}</p>}
                {u.evaluation && <TraceView trace={u.evaluation.trace} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
