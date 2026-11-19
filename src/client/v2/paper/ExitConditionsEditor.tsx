'use client';

/**
 * "Additional exit condition" — an exit condition per traded leg / group, in addition to the target and stop-loss
 * (the trader's ask, 2026-11-19: "target = 50 points or RSI crossing back below its MA, whichever is earlier"; named
 * so after "should I treat it as target or stop-loss?"). Its header lists the three exits — ① target ② stop-loss
 * ③ this condition — each explained on hover. Checked from the entry on, at every candle close, next to the target
 * and stop-loss (whichever comes first), independent of the alert settings. One click fills the opposite of
 * the trades' own entry (crossed above ↔ below); it is edited in the same one-line rows as the strategy's legs (the
 * full editor when it uses more than a line can show). Part of the plan: paper trading and both backtests use it.
 */
import { ArrowRightLeft, LogOut, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { ExitLevel, ExprNode, PaperRule, StopSetting, StrategyDefinition } from '@/shared/v2';
import { exitText, hasCondition, legFor, legName, nodeText, oppositeOf, paperGroups } from '@/shared/v2';
import type { ReactNode } from 'react';
import type { TooltipContent } from '../../components/Tooltip';
import { Tooltip } from '../../components/Tooltip';
import { LEG_KIND_TEXT } from '../format';
import { H } from '../help';
import { PlanBlock } from './PaperFields';
import { ExpressionEditor } from '../strategies/ExpressionEditor';
import { dominantSeries, legSeries, newCondition, newGroup } from '../strategies/defaults';
import type { PickInstrument } from '../strategies/InstrumentPicker';
import { SimpleConditions } from '../strategies/SimpleConditions';
import { simpleIssue } from '../strategies/simpleRows';

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `x${Math.random().toString(36).slice(2)}`);

/** Only the strategy's own instruments (the Backtest page's saved strategies): an instrument it doesn't read can't be picked. */
const OWN_ONLY = 'Exit conditions read the instruments the strategy already reads — add another in its conditions first.';

/** The conditions that open a rule's trades: its group's, or the whole strategy's. */
function entryOf(def: StrategyDefinition, rule: PaperRule): ExprNode {
  return (rule.group && paperGroups(def).find((g) => g.id === rule.group)?.node) || def.expression;
}

function ExitCard({
  def,
  rule,
  title,
  onChange,
  onPickInstrument,
}: {
  def: StrategyDefinition;
  rule: PaperRule;
  title: string;
  onChange: (tree: ExprNode | null) => void;
  onPickInstrument?: PickInstrument;
}) {
  const tree = rule.exitWhen;
  const on = hasCondition(tree);
  const leg = def.legs.find((l) => l.id === rule.leg);
  const entry = entryOf(def, rule);
  const opposite = () => oppositeOf(entry, uid);
  const pick: PickInstrument = onPickInstrument ?? ((i) => legFor(def.legs, i)?.id);
  const series = dominantSeries(entry, legSeries(rule.leg ?? def.legs[0]?.id ?? 'A', def.evaluation.triggerTimeframe));
  const starts = (
    <span className="flex flex-wrap items-center gap-1.5">
      <Tooltip content={{ ...H.paper.exitOpposite, example: nodeText(opposite(), def.legs) }}>
        <button type="button" className="btn-ghost py-0.5 text-[11px] font-semibold" onClick={() => onChange(opposite())}>
          <ArrowRightLeft className="h-3 w-3" /> Opposite of its entry
        </button>
      </Tooltip>
      <Tooltip content={H.paper.exitAdd}>
        <button type="button" className="btn-ghost py-0.5 text-[11px]" onClick={() => onChange(newGroup('AND', [newCondition(series)]))}>
          <Plus className="h-3 w-3" /> Add a condition
        </button>
      </Tooltip>
    </span>
  );
  return (
    <div className="overflow-hidden rounded-lg border border-ink-700">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700/70 bg-ink-850 px-3 py-2">
        <span className="text-[13px] font-semibold text-fg">{title}</span>
        <Tooltip content={H.paper.tradeSide}>
          <span className="inline-flex cursor-help items-center gap-1 rounded-md border border-ink-700 bg-ink-900 px-1.5 py-px text-[11px]">
            <span className="text-slate-400">{rule.side === 'SELL' ? 'Sell' : 'Buy'}</span>
            <span className={clsx('font-semibold', leg ? LEG_KIND_TEXT[leg.kind] : 'text-warn')}>{leg ? legName(leg) : '(removed instrument)'}</span>
          </span>
        </Tooltip>
        <Tooltip content={{ title: 'Entry', body: 'The conditions that open these trades.' }}>
          <span className="cursor-help truncate text-[11px] text-slate-500">entry: {nodeText(entry, def.legs)}</span>
        </Tooltip>
        {on && (
          <Tooltip content={H.paper.exitRemove} className="ml-auto">
            <button type="button" className="btn-ghost py-0.5 text-[11px] text-slate-400" onClick={() => onChange(null)}>
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          </Tooltip>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3">
        {on ? (
          simpleIssue(tree) ? (
            <ExpressionEditor bare expression={tree} onChange={onChange} defaultSeries={series} legs={def.legs} onPickInstrument={onPickInstrument} />
          ) : (
            <SimpleConditions expression={tree} onChange={onChange} defaultSeries={series} legs={def.legs} onPickInstrument={pick} fullNote={onPickInstrument ? undefined : OWN_ONLY} />
          )
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-ink-700 px-3 py-2.5">
            <span className="text-[12px] text-slate-500">No additional exit condition — only the target, stop-loss and the other exits close these trades.</span>
            {starts}
          </div>
        )}
      </div>
    </div>
  );
}

/** One of the three exits in the block's header: a numbered chip, explained on hover. */
function Way({ help, tone, children }: { help: TooltipContent; tone: string; children: ReactNode }) {
  return (
    <Tooltip content={help}>
      <span tabIndex={0} className={clsx('inline-flex cursor-help items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold outline-none', tone)}>
        {children}
      </span>
    </Tooltip>
  );
}

/** Additional exit conditions for every rule that trades, under a line naming all three exits (target, stop-loss, this). */
export function ExitConditionsEditor({
  def,
  rules,
  onChange,
  onPickInstrument,
  target,
  stop,
}: {
  def: StrategyDefinition;
  rules: PaperRule[];
  onChange: (rules: PaperRule[]) => void;
  onPickInstrument?: PickInstrument;
  /** The plan's target and stop-loss (shown with this condition: the three ways a trade closes). */
  target: ExitLevel | null;
  stop: StopSetting | null;
}) {
  const groups = paperGroups(def);
  const label = (r: PaperRule) => (r.group === null ? 'Every trade' : `${groups.find((g) => g.id === r.group)?.label ?? 'Group'} trades`);
  const traded = rules.filter((r) => r.leg);
  if (!traded.length) return null;
  const set = (rule: PaperRule, tree: ExprNode | null) => onChange(rules.map((r) => (r === rule ? { ...r, exitWhen: tree } : r)));
  const allOpposite = () => onChange(rules.map((r) => (r.leg ? { ...r, exitWhen: oppositeOf(entryOf(def, r), uid) } : r)));
  return (
    <PlanBlock
      icon={LogOut}
      title="Additional exit condition"
      help={H.paper.exitBlock}
      aside={
        traded.length > 1 ? (
          <Tooltip content={H.paper.exitOppositeAll}>
            <button type="button" className="btn-ghost py-0.5 text-[11px] font-semibold" onClick={allOpposite}>
              <ArrowRightLeft className="h-3 w-3" /> Opposite of each entry
            </button>
          </Tooltip>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-400">
        <Tooltip content={H.paper.exitBlock}>
          <span className="cursor-help underline decoration-slate-600 decoration-dotted underline-offset-2">A trade closes at whichever comes first:</span>
        </Tooltip>
        <Way help={H.paper.exitTarget} tone="border-bull/40 bg-bull/10 text-bull">
          ① Target {target ? `+${exitText(target)}` : '— none'}
        </Way>
        <Way help={H.paper.exitStop} tone="border-bear/40 bg-bear/10 text-bear">
          ② Stop-loss {stop ? (stop.unit === 'CANDLE' ? exitText(stop) : `−${exitText(stop)}`) : '— none'}
        </Way>
        <Way help={H.paper.exitCondition} tone="border-accent/40 bg-accent/10 text-accent-soft">
          ③ Additional exit condition — profit or loss
        </Way>
      </div>
      <div className="flex flex-col gap-3">
        {traded.map((r) => (
          <ExitCard key={r.group ?? '*'} def={def} rule={r} title={label(r)} onChange={(t) => set(r, t)} onPickInstrument={onPickInstrument} />
        ))}
      </div>
    </PlanBlock>
  );
}
