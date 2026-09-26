'use client';

/**
 * The strategy's legs (1–4): placeholders a connection turns into real
 * contracts — SPOT, FUT, or a CE / PE at a strike relative to ATM.
 */
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import type { LegDef, LegKind } from '@/shared/v2';
import { LEG_KINDS, MAX_LEGS, legName, offsetText } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { IconButton } from '../../components/ui';
import { Cell } from '../components';
import { LEG_KIND_TEXT } from '../format';
import { H } from '../help';
import { nextLegId } from './defaults';

const OFFSETS = Array.from({ length: 21 }, (_, i) => i - 10);

export function LegsEditor({ legs, onChange, used }: { legs: LegDef[]; onChange: (legs: LegDef[]) => void; used: Set<string> }) {
  const set = (i: number, patch: Partial<LegDef>) => onChange(legs.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setKind = (i: number, kind: LegKind) => set(i, { kind, strikeOffset: kind === 'CE' || kind === 'PE' ? (legs[i]!.strikeOffset ?? 0) : undefined });
  const add = () => {
    const id = nextLegId(legs);
    if (id) onChange([...legs, { id, kind: legs.some((l) => l.kind === 'CE') ? 'PE' : 'CE', strikeOffset: 0 }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {legs.map((l, i) => {
        const isOption = l.kind === 'CE' || l.kind === 'PE';
        const inUse = used.has(l.id);
        return (
          <div key={l.id} className="flex flex-wrap items-end gap-3 rounded-lg border border-ink-700/60 bg-ink-850 px-3 py-2">
            <Tooltip content={{ title: `Leg ${l.id}`, body: `Conditions refer to this leg as “${legName(l)}”.` }}>
              <span className={clsx('mb-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-ink-800 text-sm font-bold', LEG_KIND_TEXT[l.kind])}>{l.id}</span>
            </Tooltip>
            <Cell label="Type" help={H.legs.kind}>
              <div role="radiogroup" aria-label={`Leg ${l.id} type`} className="flex rounded-lg overflow-hidden border border-ink-700 text-xs">
                {LEG_KINDS.map((k) => (
                  <Tooltip key={k.kind} content={{ title: k.name, body: k.description }} side="bottom">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={l.kind === k.kind}
                      onClick={() => setKind(i, k.kind)}
                      className={clsx('px-2.5 py-1 font-semibold', l.kind === k.kind ? 'bg-ink-700 ' + LEG_KIND_TEXT[k.kind] : 'bg-ink-800 text-slate-500 hover:text-slate-300')}
                    >
                      {k.label}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </Cell>
            {isOption && (
              <Cell label="Strike" help={H.legs.offset}>
                <select aria-label={`Leg ${l.id} strike`} className="input py-1 text-xs" value={l.strikeOffset ?? 0} onChange={(e) => set(i, { strikeOffset: Number(e.target.value) })}>
                  {OFFSETS.map((o) => (
                    <option key={o} value={o}>
                      {offsetText(o)}
                      {o === 0 ? ' (at the money)' : ''}
                    </option>
                  ))}
                </select>
              </Cell>
            )}
            <Cell label="Name" help={H.legs.label}>
              <input aria-label={`Leg ${l.id} name`} className="input py-1 text-xs w-36" placeholder="optional" value={l.label ?? ''} onChange={(e) => set(i, { label: e.target.value || undefined })} />
            </Cell>
            <span className="mb-1.5 text-[11px] text-slate-500">
              reads as <span className={clsx('font-semibold', LEG_KIND_TEXT[l.kind])}>{legName(l)}</span>
              {!inUse && <span className="text-warn"> · not used yet</span>}
            </span>
            <IconButton
              help={inUse ? { ...H.legs.remove, note: 'Used by a condition — change or remove those conditions first.' } : H.legs.remove}
              onClick={() => onChange(legs.filter((_, j) => j !== i))}
              disabled={legs.length === 1 || inUse}
              wrapperClassName="ml-auto self-center"
              className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10 disabled:opacity-30"
            >
              <Trash2 className="w-4 h-4" />
            </IconButton>
          </div>
        );
      })}
      {legs.length < MAX_LEGS && (
        <Tooltip content={H.legs.add}>
          <button type="button" className="btn-ghost py-1 text-xs self-start" onClick={add}>
            <Plus className="w-3.5 h-3.5" /> Add leg ({legs.length}/{MAX_LEGS})
          </button>
        </Tooltip>
      )}
    </div>
  );
}
