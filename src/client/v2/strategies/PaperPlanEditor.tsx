'use client';

/**
 * Step 4 of the strategy editor: paper trading — on for every connection of the strategy by default.
 * These are the defaults its connections trade with (each connection can change its own values in
 * Connections or on the Paper tab), plus one rule per top-level group (or one for the whole
 * strategy): which leg to trade, Buy or Sell.
 */
import { RotateCcw } from 'lucide-react';
import type { LegId, PaperPlan, PaperRule, PaperSide, StrategyDefinition } from '@/shared/v2';
import { PAPER_DEFAULTS, legName, paperGroups, resolveRules } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { Cell, Segmented, Toggle } from '../components';
import { H } from '../help';
import { PaperTermsFields } from '../paper/PaperFields';

export function PaperPlanEditor({ def, plan, onChange }: { def: StrategyDefinition; plan: PaperPlan; onChange: (p: PaperPlan) => void }) {
  const groups = paperGroups(def);
  const rules = resolveRules(def, plan.rules);
  const set = (patch: Partial<PaperPlan>) => onChange({ ...plan, rules, ...patch });
  const setRule = (i: number, patch: Partial<PaperRule>) => set({ rules: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const groupLabel = (r: PaperRule) => (r.group === null ? 'Whole strategy' : (groups.find((g) => g.id === r.group)?.label ?? 'Group'));
  const spotLeg = rules.some((r) => def.legs.find((l) => l.id === r.leg)?.kind === 'SPOT');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle checked={plan.enabled} onChange={(enabled) => set({ enabled })} label="Paper trade this strategy’s alerts (every connection)" help={H.paper.enabled} />
        {plan.enabled && (
          <Tooltip content={H.paper.defaults} className="ml-auto">
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => set({ ...PAPER_DEFAULTS, rules: resolveRules(def) })}>
              <RotateCcw className="w-3.5 h-3.5" /> Defaults
            </button>
          </Tooltip>
        )}
      </div>

      {!plan.enabled ? (
        <p className="text-xs text-warn">Off for every connection of this strategy — its alerts won’t open paper trades. Tick the box to simulate them again.</p>
      ) : (
        <>
          <PaperTermsFields value={plan} onChange={(p) => onChange({ ...p, rules })} hasGroups={groups.length > 0} />

          <Cell label="What to trade" help={H.paper.rules} className="items-stretch">
            <div className="flex w-full flex-col gap-2">
              {rules.map((r, i) => (
                <div key={r.group ?? 'all'} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/40 px-2.5 py-2">
                  <Tooltip content={H.paper.group}>
                    <span className="min-w-[7rem] text-xs font-semibold text-slate-200">{groupLabel(r)}</span>
                  </Tooltip>
                  <Tooltip content={H.paper.leg}>
                    <select aria-label={`Leg to trade (${groupLabel(r)})`} className="input py-1 text-xs" value={r.leg ?? ''} onChange={(e) => setRule(i, { leg: (e.target.value || null) as LegId | null })}>
                      {def.legs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {legName(l)}
                        </option>
                      ))}
                      <option value="">Don’t trade (exit only)</option>
                    </select>
                  </Tooltip>
                  {r.leg && (
                    <Segmented<PaperSide>
                      label={`Buy or sell (${groupLabel(r)})`}
                      value={r.side}
                      onChange={(side) => setRule(i, { side })}
                      options={[
                        { value: 'BUY', label: 'Buy', help: H.paper.buy },
                        { value: 'SELL', label: 'Sell', help: H.paper.sell },
                      ]}
                    />
                  )}
                </div>
              ))}
              {spotLeg && <p className="text-[11px] text-warn">A Spot leg trades only on stocks — on indices and MCX those alerts won’t open a trade.</p>}
            </div>
          </Cell>
          <Tooltip content={H.paper.savedWith}>
            <p className="text-[11px] text-slate-500">Defaults for every connection of this strategy — a connection can change its own values in Connections or on the Paper tab. Saved with the strategy; open trades keep their settings.</p>
          </Tooltip>
        </>
      )}
    </div>
  );
}
