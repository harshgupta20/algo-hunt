'use client';

/**
 * Step 3 of the strategy editor: paper trading — on for every connection of the strategy by default.
 * These are the defaults its connections trade with (each connection can change its own values in
 * Connections or on the Paper tab), plus one rule per top-level group (or one for the whole
 * strategy): which instrument to trade (any SPOT / FUT / CE / PE — not only those the conditions
 * read), Buy or Sell, and its trailing rules. Both backtests start from this plan.
 */
import { useState } from 'react';
import { ArrowRight, ArrowRightLeft, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import type { LegId, PaperPlan, PaperRule, PaperSide, StrategyDefinition } from '@/shared/v2';
import { PAPER_DEFAULTS, legName, legsReadBy, naturalLeg, paperGroupWord, paperGroups, planSizing, resolveRules, stopOf, targetOf } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { Segmented, Toggle } from '../components';
import { LEG_KIND_TEXT } from '../format';
import { H } from '../help';
import { ConditionsEditor } from '../paper/ConditionsEditor';
import { ExitConditionsEditor } from '../paper/ExitConditionsEditor';
import { PaperTermsFields, PlanBlock } from '../paper/PaperFields';
import { FULL_NOTE, InstrumentPicker, type PickInstrument } from './InstrumentPicker';

/**
 * What each top-level group (or the whole strategy) trades: the instrument and Buy / Sell ("Don't trade" = exit
 * only). With `onPickInstrument` (the strategy's rules can change here) any instrument can be traded — e.g. FUT
 * conditions → buy CE ATM; without it, one of the instruments the strategy reads.
 */
export function PaperRulesEditor({ def, rules, onChange, onPickInstrument }: { def: StrategyDefinition; rules: PaperRule[]; onChange: (r: PaperRule[]) => void; onPickInstrument?: PickInstrument }) {
  const groups = paperGroups(def);
  const [full, setFull] = useState(false);
  const setRule = (i: number, patch: Partial<PaperRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const groupLabel = (r: PaperRule) => (r.group === null ? 'Whole strategy' : (groups.find((g) => g.id === r.group)?.label ?? 'Group'));
  const spotLeg = rules.some((r) => def.legs.find((l) => l.id === r.leg)?.kind === 'SPOT');
  const read = legsReadBy(def.expression);
  /** What a rule's conditions point at: its group's option, else its future, else spot (the default trade). */
  const suggested = (r: PaperRule) => {
    const id = naturalLeg(def.legs, r.group === null ? def.expression : (groups.find((g) => g.id === r.group)?.node ?? def.expression));
    return id && id !== r.leg && read.has(id) ? def.legs.find((l) => l.id === id) : undefined;
  };
  return (
    <PlanBlock icon={ArrowRightLeft} title="What to trade" help={H.paper.rules}>
      <div className="flex flex-col divide-y divide-ink-700/60">
        <div className="hidden grid-cols-[minmax(10rem,14rem)_1.25rem_minmax(0,1fr)] gap-x-2 pb-1.5 text-[11px] font-medium text-slate-500 sm:grid">
          <span>When this fires</span>
          <span />
          <span>Trade</span>
        </div>
        {rules.map((r, i) => {
          const leg = def.legs.find((l) => l.id === r.leg);
          return (
            <div key={r.group ?? 'all'} className="grid grid-cols-1 items-center gap-x-2 gap-y-1.5 py-2 sm:grid-cols-[minmax(10rem,14rem)_1.25rem_minmax(0,1fr)]">
              <Tooltip content={H.paper.group}>
                <span className="cursor-help text-[13px] font-semibold text-fg">{groupLabel(r)}</span>
              </Tooltip>
              <ArrowRight aria-hidden className="hidden h-4 w-4 text-slate-500 sm:block" />
              <div className="flex flex-wrap items-center gap-2">
                {onPickInstrument ? (
                  <InstrumentPicker
                    label={`Instrument to trade (${groupLabel(r)})`}
                    value={leg ?? null}
                    none={{ label: 'Don’t trade', help: H.paper.dontTrade }}
                    onChange={(instr) => {
                      if (!instr) return (setFull(false), setRule(i, { leg: null }));
                      // This rule alone trading / reading its instrument: with 4 in use it may switch in place.
                      const shared = rules.some((x, j) => j !== i && x.leg !== null && (x.leg === r.leg || legsReadBy(x.stopWhen).has(r.leg!)));
                      const id = onPickInstrument(instr, r.leg ?? undefined, { onlyPlanUser: !shared });
                      setFull(!id);
                      if (id) setRule(i, { leg: id });
                    }}
                  />
                ) : (
                  <Tooltip content={H.paper.tradeSide}>
                    <select
                      aria-label={`Instrument to trade (${groupLabel(r)})`}
                      className={clsx('input py-1 text-xs font-semibold', leg ? LEG_KIND_TEXT[leg.kind] : 'text-slate-400')}
                      value={r.leg ?? ''}
                      onChange={(e) => setRule(i, { leg: (e.target.value || null) as LegId | null })}
                    >
                      {def.legs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {legName(l)}
                        </option>
                      ))}
                      <option value="">Don’t trade (exit only)</option>
                    </select>
                  </Tooltip>
                )}
                {r.leg ? (
                  <Segmented<PaperSide>
                    label={`Buy or sell (${groupLabel(r)})`}
                    value={r.side}
                    onChange={(side) => setRule(i, { side })}
                    options={[
                      { value: 'BUY', label: 'Buy', help: H.paper.buy },
                      { value: 'SELL', label: 'Sell', help: H.paper.sell },
                    ]}
                  />
                ) : (
                  <span className="text-[11px] text-slate-500">only closes trades</span>
                )}
              </div>
              {leg && !read.has(leg.id) && (() => {
                const alt = suggested(r);
                return (
                  <p className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 sm:col-start-3">
                    {legName(leg)} isn’t read by {r.group === null ? 'the' : 'this group’s'} conditions — fine if that’s the plan (e.g. FUT signals → buy CE ATM).
                    {alt && (
                      <Tooltip content={H.paper.tradeSuggested}>
                        <button type="button" className={clsx('btn-ghost py-0.5 text-[11px] font-semibold', LEG_KIND_TEXT[alt.kind])} onClick={() => setRule(i, { leg: alt.id })}>
                          Trade {legName(alt)} instead
                        </button>
                      </Tooltip>
                    )}
                  </p>
                );
              })()}
            </div>
          );
        })}
      </div>
      {full && <p className="text-[11px] text-warn">{FULL_NOTE}</p>}
      {spotLeg && <p className="text-[11px] text-warn">SPOT trades only on stocks — on indices and MCX those alerts won’t open a trade.</p>}
    </PlanBlock>
  );
}

/** Default legs / sides with each group's trailing rules and exit condition kept (built by hand — "Defaults" never wipes them). */
const keepConditions = (fresh: PaperRule[], cur: PaperRule[]): PaperRule[] =>
  fresh.map((r) => {
    const was = cur.find((x) => x.group === r.group);
    return { ...r, stopWhen: was?.stopWhen ?? null, exitWhen: was?.exitWhen ?? null };
  });

export function PaperPlanEditor({ def, plan, onChange, onPickInstrument }: { def: StrategyDefinition; plan: PaperPlan; onChange: (p: PaperPlan) => void; onPickInstrument?: PickInstrument }) {
  const groups = paperGroups(def);
  const rules = resolveRules(def, plan.rules);
  const set = (patch: Partial<PaperPlan>) => onChange({ ...plan, rules, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle checked={plan.enabled} onChange={(enabled) => set({ enabled })} label="Paper trade this strategy’s alerts (every connection)" help={H.paper.enabled} />
        {plan.enabled && (
          <Tooltip content={H.paper.defaults} className="ml-auto">
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => set({ ...PAPER_DEFAULTS, rules: keepConditions(resolveRules(def), rules) })}>
              <RotateCcw className="w-3.5 h-3.5" /> Defaults
            </button>
          </Tooltip>
        )}
      </div>

      {!plan.enabled ? (
        <p className="text-xs text-warn">Off for every connection of this strategy — its alerts won’t open paper trades. Tick the box to simulate them again.</p>
      ) : (
        <>
          {/* What to trade first (the trader's ask, 2026-11-19), then size / exits / costs, then the trailing rules. */}
          <PaperRulesEditor def={def} rules={rules} onChange={(r) => set({ rules: r })} onPickInstrument={onPickInstrument} />
          <PaperTermsFields value={plan} onChange={(p) => onChange({ ...p, rules })} hasGroups={groups.length > 0} groupWord={paperGroupWord(def)} sizing={planSizing(def, rules)} />
          <ExitConditionsEditor def={def} rules={rules} onChange={(r) => set({ rules: r })} onPickInstrument={onPickInstrument} target={targetOf(plan)} stop={stopOf(plan)} />
          {plan.trailing && <ConditionsEditor def={def} rules={rules} target={targetOf(plan)} onChange={(r) => set({ rules: r })} />}
          <Tooltip content={H.paper.savedWith}>
            <p className="text-[11px] text-slate-500">Defaults for every connection of this strategy — a connection can change its own values in Connections or on the Paper tab. Saved with the strategy; open trades keep their settings.</p>
          </Tooltip>
        </>
      )}
    </div>
  );
}
