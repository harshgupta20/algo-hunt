'use client';

/**
 * Trailing rules per trade rule (each group that trades, or the whole strategy): an AND / OR condition tree — the
 * strategy editor's — on any leg, e.g. "close crossed below SMA 20" or "close crossed below the previous candle's
 * low". With Trailing SL on they run from the target on — they are the trailing SL. Part of the plan, so paper
 * trading and both backtests use them; used by the strategy editor (step 4) and the backtest pages (shown while
 * Trailing SL is on).
 */
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import type { ExprNode, GroupNode, PaperRule, StrategyDefinition } from '@/shared/v2';
import { hasCondition, paperGroups } from '@/shared/v2';
import { InfoTip, Tooltip, type TooltipContent } from '../../components/Tooltip';
import { H } from '../help';
import { ExpressionEditor } from '../strategies/ExpressionEditor';
import { indicatorOperand, legSeries, newGroup } from '../strategies/defaults';

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `x${Math.random().toString(36).slice(2)}`);

type Quick = { key: string; label: (sell: boolean) => string; help: TooltipContent; make: (rule: PaperRule, def: StrategyDefinition) => ExprNode };

/** The trader's usual conditions, on the traded contract at the strategy's timeframe (mirrored for a sell). */
function quick(build: (s: ReturnType<typeof legSeries>, sell: boolean) => Omit<Extract<ExprNode, { type: 'CONDITION' }>, 'id' | 'type'>) {
  return (rule: PaperRule, def: StrategyDefinition): ExprNode => ({ type: 'CONDITION', id: uid(), ...build(legSeries(rule.leg!, def.evaluation.triggerTimeframe), rule.side === 'SELL') });
}
const close = (s: ReturnType<typeof legSeries>) => ({ kind: 'FIELD' as const, series: s, field: 'close' as const });
const range = (s: ReturnType<typeof legSeries>, period: number, output: 'low' | 'high') => ({ ...indicatorOperand(s, 'RANGE'), params: { period }, output });

const QUICK: Quick[] = [
  {
    key: 'sma',
    label: (sell) => `Price crosses ${sell ? 'above' : 'below'} SMA`,
    help: H.paper.condSma,
    make: quick((s, sell) => ({ left: close(s), operator: sell ? 'CROSSED_ABOVE' : 'CROSSED_BELOW', right: indicatorOperand(s, 'SMA') })),
  },
  {
    key: 'prev',
    label: (sell) => `Previous candle ${sell ? 'high' : 'low'}`,
    help: H.paper.condPrev,
    make: quick((s, sell) => ({ left: close(s), operator: sell ? 'CROSSED_ABOVE' : 'CROSSED_BELOW', right: range(s, 1, sell ? 'high' : 'low') })),
  },
  {
    key: 'low',
    label: (sell) => `3-candle ${sell ? 'high' : 'low'}`,
    help: H.paper.condLow,
    make: quick((s, sell) => ({ left: close(s), operator: sell ? 'CROSSED_ABOVE' : 'CROSSED_BELOW', right: range(s, 3, sell ? 'high' : 'low') })),
  },
  {
    key: 'rsi',
    label: () => 'RSI turns',
    help: H.paper.condRsi,
    make: quick((s, sell) => ({ left: indicatorOperand(s, 'RSI'), operator: sell ? 'CROSSED_ABOVE' : 'CROSSED_BELOW', right: { kind: 'CONSTANT', value: sell ? 60 : 40 } })),
  },
];

/** One rule's trailing rules: add / edit / remove, with quick starts. */
function ConditionBlock({ def, rule, onChange }: { def: StrategyDefinition; rule: PaperRule; onChange: (tree: ExprNode | null) => void }) {
  const tree = rule.stopWhen;
  const on = hasCondition(tree);
  const sell = rule.side === 'SELL';
  const add = (q: Quick) => {
    const node = q.make(rule, def);
    onChange(on && (tree.type === 'AND' || tree.type === 'OR') ? { ...tree, children: [...tree.children, node] } : newGroup('OR', [node]));
  };
  const starts = (
    <span className="flex flex-wrap gap-1.5">
      {QUICK.map((q) => (
        <Tooltip key={q.key} content={q.help}>
          <button type="button" className="btn-ghost py-0.5 text-[11px]" onClick={() => add(q)}>
            <Plus className="w-3 h-3" /> {q.label(sell)}
          </button>
        </Tooltip>
      ))}
    </span>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={H.paper.stopWhen}>
          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-300">
            <ShieldAlert className="w-3.5 h-3.5 text-warn" /> Close the trade when…
          </span>
        </Tooltip>
        {on && (
          <Tooltip content={H.paper.stopWhenRemove} className="ml-auto">
            <button type="button" className="btn-ghost py-0.5 text-[11px] text-slate-400" onClick={() => onChange(null)}>
              <Trash2 className="w-3 h-3" /> Remove
            </button>
          </Tooltip>
        )}
      </div>
      {on ? (
        <>
          <ExpressionEditor expression={tree} onChange={(root) => onChange(root as GroupNode)} defaultSeries={legSeries(rule.leg!, def.evaluation.triggerTimeframe)} legs={def.legs} />
          {starts}
        </>
      ) : (
        <span className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">None — add: {starts}</span>
      )}
    </div>
  );
}

/** Trailing rules for every rule that trades; `targetPct` says where they start (the target, or the entry without one). */
export function ConditionsEditor({ def, rules, targetPct, onChange }: { def: StrategyDefinition; rules: PaperRule[]; targetPct: number | null; onChange: (rules: PaperRule[]) => void }) {
  const groups = paperGroups(def);
  const label = (r: PaperRule) => (r.group === null ? 'Every trade' : `${groups.find((g) => g.id === r.group)?.label ?? 'Group'} trades`);
  const traded = rules.filter((r) => r.leg);
  if (!traded.length) return null;
  const set = (rule: PaperRule, tree: ExprNode | null) => onChange(rules.map((r) => (r === rule ? { ...r, stopWhen: tree } : r)));
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-950/30 p-3">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        Trailing rules <InfoTip content={H.paper.conditions} />
      </p>
      <p className="mb-2 text-[11px] text-slate-500">
        {targetPct === null ? 'Set a target — trailing starts there.' : `From the target (+${targetPct} %) on: the first rule that comes true at a candle close closes the trade. At least one is needed.`}
      </p>
      <div className="flex flex-col gap-3">
        {traded.map((r) => {
          const leg = def.legs.find((l) => l.id === r.leg);
          return (
            <div key={r.group ?? '*'} className="flex flex-col gap-3 rounded-lg border border-ink-700 bg-ink-950/40 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-200">{label(r)}</span>
                <span className="text-[11px] text-slate-500">
                  {r.side === 'SELL' ? 'sell' : 'buy'} {leg ? `${r.leg} · ${leg.kind}` : r.leg}
                </span>
              </div>
              <ConditionBlock def={def} rule={r} onChange={(t) => set(r, t)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
