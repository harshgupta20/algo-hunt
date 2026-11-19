'use client';

/**
 * What a value reads — SPOT, FUT, or a CE / PE at a strike from ATM — picked right where it's used (a condition's
 * value, a pattern, what a trade plan trades). There is no separate legs step any more: the strategy's legs are
 * whatever these pickers choose, kept in step by `tidyLegs` (shared/v2/legs.ts).
 */
import clsx from 'clsx';
import type { LegDef, LegId, StrategyDefinition } from '@/shared/v2';
import { LEG_KINDS, MAX_LEGS, forEachSeries, freeLegId, instrumentOf, isOptionKind, legFor, offsetText, type Instrument } from '@/shared/v2';
import { Tooltip, type TooltipContent } from '../../components/Tooltip';
import { LEG_KIND_TEXT } from '../format';
import { H } from '../help';

/** Strikes from ATM a CE / PE can sit at: ATM−10 … ATM+10. */
export const OFFSETS = Array.from({ length: 21 }, (_, i) => i - 10);

/**
 * Picks an instrument for a strategy and returns the leg that reads it: the strategy's leg when it has one, else a
 * new leg (`update` adds it in the same tick as the caller's own edit). With all MAX_LEGS letters taken, the
 * `current` leg is switched in place when nothing else uses it — a condition value: no other value reads it and the
 * plan doesn't use it; a trade rule (`onlyPlanUser`: no other rule trades or reads it): no condition reads it.
 * Otherwise undefined (no room).
 */
export type PickInstrument = (i: Instrument, current?: LegId, opts?: { onlyPlanUser?: boolean }) => LegId | undefined;

export function instrumentPicker(def: StrategyDefinition, update: (fn: (d: StrategyDefinition) => StrategyDefinition) => void, keep: Set<LegId>): PickInstrument {
  return (i, current, opts) => {
    const hit = legFor(def.legs, i);
    if (hit) return hit.id;
    const id = freeLegId(def.legs);
    if (id) {
      update((d) => ({ ...d, legs: [...d.legs, { id, ...instrumentOf(i) }] }));
      return id;
    }
    // All letters taken: the value being changed may hold the only read of its instrument — switch that leg.
    let reads = 0;
    forEachSeries(def.expression, (s) => void (s.leg === current && reads++));
    const free = opts?.onlyPlanUser ? reads === 0 : reads <= 1 && !keep.has(current!);
    if (current && free) {
      update((d) => ({ ...d, legs: d.legs.map((l): LegDef => (l.id === current ? { id: l.id, ...instrumentOf(i) } : l)) }));
      return current;
    }
    return undefined;
  };
}

export const FULL_NOTE = `A strategy reads at most ${MAX_LEGS} different instruments — pick one it already reads, or change the conditions that read another first.`;

/** SPOT · FUT · CE · PE (+ a strike for options), and optionally "none" (e.g. Don't trade). */
export function InstrumentPicker({
  value,
  onChange,
  label,
  none,
}: {
  /** null = none / not set. */
  value: Instrument | null;
  onChange: (i: Instrument | null) => void;
  /** For screen readers, e.g. "Left instrument". */
  label: string;
  none?: { label: string; help: TooltipContent };
}) {
  const option = value && isOptionKind(value.kind);
  return (
    <>
      <div role="radiogroup" aria-label={label} className="flex overflow-hidden rounded-lg border border-ink-700 text-xs">
        {LEG_KINDS.map((k) => {
          const on = value?.kind === k.kind;
          return (
            <Tooltip key={k.kind} content={{ title: k.name, body: k.description, note: H.editor.instrument.note }} side="bottom">
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(instrumentOf({ kind: k.kind, strikeOffset: option ? value!.strikeOffset : 0 }))}
                className={clsx('px-2.5 py-1 font-semibold', on ? 'bg-ink-700 ' + LEG_KIND_TEXT[k.kind] : 'bg-ink-800 text-slate-500 hover:text-slate-300')}
              >
                {k.label}
              </button>
            </Tooltip>
          );
        })}
        {none && (
          <Tooltip content={none.help} side="bottom">
            <button
              type="button"
              role="radio"
              aria-checked={value === null}
              onClick={() => onChange(null)}
              className={clsx('px-2.5 py-1 font-semibold', value === null ? 'bg-ink-700 text-fg' : 'bg-ink-800 text-slate-500 hover:text-slate-300')}
            >
              {none.label}
            </button>
          </Tooltip>
        )}
      </div>
      {option && (
        <Tooltip content={H.editor.strike}>
          <select
            aria-label={`${label} strike`}
            className={clsx('input py-1 text-xs font-semibold', LEG_KIND_TEXT[value!.kind])}
            value={value!.strikeOffset ?? 0}
            onChange={(e) => onChange({ kind: value!.kind, strikeOffset: Number(e.target.value) })}
          >
            {OFFSETS.map((o) => (
              <option key={o} value={o}>
                {offsetText(o)}
                {o === 0 ? ' (at the money)' : ''}
              </option>
            ))}
          </select>
        </Tooltip>
      )}
    </>
  );
}
