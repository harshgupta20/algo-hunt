'use client';

/**
 * Expression tree editor: AND / OR groups (nestable), NOT wrappers,
 * conditions and candlestick patterns, with reordering. Each condition shows
 * how it reads in plain words and warns about incompatible comparisons.
 */
import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowUp, Ban, CandlestickChart, FolderPlus, Plus, Trash2, Undo2 } from 'lucide-react';
import type { ConditionNode, ExprNode, GroupNode, Leg, McxStrategyDefinition, PatternNode, SeriesSpec } from '@/shared/mcx';
import { MCX2_OPERATORS, MCX2_PATTERNS, conditionText, nodeText, operandUnit } from '@/shared/mcx';
import { Tooltip } from '../../components/Tooltip';
import { IconButton } from '../../components/ui';
import { Cell } from '../components';
import { H } from '../help';
import { newCondition, newGroup, newPattern, wrapNot } from './defaults';
import { OperandEditor, SeriesPicker } from './OperandEditor';

interface Ctx {
  definition: McxStrategyDefinition;
  defaultSeries: SeriesSpec;
  legs: Leg[];
}

function Toolbar({ index, count, onMove, onRemove, onNot, isNot }: { index: number; count: number; onMove: (d: -1 | 1) => void; onRemove: () => void; onNot: () => void; isNot: boolean }) {
  const btn = 'p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-ink-800 disabled:opacity-30';
  return (
    <div className="flex items-center gap-0.5 ml-auto self-start">
      <IconButton help={H.editor.moveUp} onClick={() => onMove(-1)} disabled={index === 0} className={btn}>
        <ArrowUp className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton help={H.editor.moveDown} onClick={() => onMove(1)} disabled={index >= count - 1} className={btn}>
        <ArrowDown className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton help={isNot ? H.editor.unwrapNot : H.editor.wrapNot} onClick={onNot} className={btn}>
        {isNot ? <Undo2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
      </IconButton>
      <IconButton help={H.editor.remove} onClick={onRemove} className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10">
        <Trash2 className="w-3.5 h-3.5" />
      </IconButton>
    </div>
  );
}

const UNIT_LABEL: Record<string, string> = {
  price: 'a price',
  oscillator: 'an oscillator (0–100)',
  macd: 'a MACD value',
  direction: 'a direction (+1/−1)',
  volume: 'a volume',
  oi: 'open interest',
  ratio: 'a ratio',
  percent: 'a percentage',
};

function ConditionEditor({ node, ctx, onChange }: { node: ConditionNode; ctx: Ctx; onChange: (n: ConditionNode) => void }) {
  const lu = operandUnit(node.left);
  const ru = operandUnit(node.right);
  const mismatch = lu && ru && lu !== ru;
  const opSpec = MCX2_OPERATORS.find((o) => o.value === node.operator);
  return (
    <div className="flex flex-col gap-3">
      <OperandEditor side="Left" value={node.left} onChange={(left) => onChange({ ...node, left })} defaultSeries={ctx.defaultSeries} legs={ctx.legs} allowConstant={false} />
      <div className="flex flex-wrap items-end gap-3">
        <Cell label="Operator" help={{ ...H.editor.operator, title: `Operator — ${opSpec?.label ?? ''}` }}>
          <select aria-label="Operator" className="input py-1 text-xs" value={node.operator} onChange={(e) => onChange({ ...node, operator: e.target.value as ConditionNode['operator'] })}>
            {MCX2_OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Cell>
      </div>
      <OperandEditor
        side="Right"
        value={node.right}
        onChange={(right) => onChange({ ...node, right })}
        defaultSeries={node.left.kind === 'CONSTANT' ? ctx.defaultSeries : node.left.series}
        legs={ctx.legs}
      />
      <p className="text-[11px] text-slate-500">
        Reads as: <span className="font-mono text-slate-300">{conditionText(node, ctx.definition.universe)}</span>
      </p>
      {mismatch && (
        <p className="flex items-center gap-1.5 text-[11px] text-warn">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          The left side is {UNIT_LABEL[lu] ?? lu} but the right side is {UNIT_LABEL[ru] ?? ru} — they can’t be compared meaningfully.
        </p>
      )}
    </div>
  );
}

function PatternEditor({ node, ctx, onChange }: { node: PatternNode; ctx: Ctx; onChange: (n: PatternNode) => void }) {
  const groups = [...new Set(MCX2_PATTERNS.map((p) => p.group))];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Cell label="Pattern" help={H.editor.pattern}>
          <select aria-label="Pattern" className="input py-1 text-xs" value={node.pattern} onChange={(e) => onChange({ ...node, pattern: e.target.value as PatternNode['pattern'] })}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {MCX2_PATTERNS.filter((p) => p.group === g).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Cell>
        <SeriesPicker label="Pattern" value={node.series} onChange={(series) => onChange({ ...node, series })} legs={ctx.legs} />
      </div>
      <p className="text-[11px] text-slate-500">
        Reads as: <span className="font-mono text-slate-300">{nodeText(node, ctx.definition.universe)}</span>
      </p>
    </div>
  );
}

function Leaf({ node, ctx, onChange }: { node: ConditionNode | PatternNode; ctx: Ctx; onChange: (n: ExprNode) => void }) {
  return node.type === 'CONDITION' ? <ConditionEditor node={node} ctx={ctx} onChange={onChange} /> : <PatternEditor node={node} ctx={ctx} onChange={onChange} />;
}

function NodeEditor({
  node,
  ctx,
  onChange,
  onRemove,
  onMove,
  index,
  count,
  depth,
}: {
  node: ExprNode;
  ctx: Ctx;
  onChange: (n: ExprNode) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
  index: number;
  count: number;
  depth: number;
}) {
  const isNot = node.type === 'NOT';
  const inner = isNot ? node.child : node;
  const setInner = (n: ExprNode) => onChange(isNot ? { ...node, child: n } : n);
  const toggleNot = () => onChange(isNot ? node.child : wrapNot(node));

  return (
    <div className={clsx('rounded-lg border p-3', isNot ? 'border-warn/40 bg-warn/5' : 'border-ink-700/60 bg-ink-850')}>
      <div className="flex items-start gap-2">
        {isNot && (
          <Tooltip content={H.editor.not}>
            <span className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-warn">NOT</span>
          </Tooltip>
        )}
        <div className="flex-1 min-w-0">
          {inner.type === 'AND' || inner.type === 'OR' ? (
            <GroupEditor group={inner} ctx={ctx} onChange={setInner} depth={depth + 1} embedded />
          ) : inner.type === 'NOT' ? (
            <p className="text-xs text-slate-400">Nested NOT — remove one to edit.</p>
          ) : (
            <Leaf node={inner as ConditionNode | PatternNode} ctx={ctx} onChange={setInner} />
          )}
        </div>
        <Toolbar index={index} count={count} onMove={onMove} onRemove={onRemove} onNot={toggleNot} isNot={isNot} />
      </div>
    </div>
  );
}

export function GroupEditor({ group, ctx, onChange, depth = 0, embedded }: { group: GroupNode; ctx: Ctx; onChange: (g: GroupNode) => void; depth?: number; embedded?: boolean }) {
  const setChild = (i: number, n: ExprNode) => onChange({ ...group, children: group.children.map((c, j) => (j === i ? n : c)) });
  const remove = (i: number) => onChange({ ...group, children: group.children.filter((_, j) => j !== i) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= group.children.length) return;
    const children = [...group.children];
    [children[i], children[j]] = [children[j]!, children[i]!];
    onChange({ ...group, children });
  };
  const add = (n: ExprNode) => onChange({ ...group, children: [...group.children, n] });

  return (
    <div className={clsx(!embedded && 'rounded-xl border border-ink-700 bg-ink-900 p-3')}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div role="radiogroup" aria-label="Group logic" className="flex rounded-lg overflow-hidden border border-ink-700 text-xs">
          {(['AND', 'OR'] as const).map((l) => (
            <Tooltip key={l} content={{ ...H.editor.group, title: l === 'AND' ? 'AND — all must be true' : 'OR — any one is enough' }}>
              <button
                type="button"
                role="radio"
                aria-checked={group.type === l}
                onClick={() => onChange({ ...group, type: l })}
                className={clsx('px-2.5 py-1 font-semibold', group.type === l ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400')}
              >
                {l}
              </button>
            </Tooltip>
          ))}
        </div>
        <span className="text-[11px] text-slate-500">
          {group.children.length} item{group.children.length === 1 ? '' : 's'} · {group.type === 'AND' ? 'all must be true' : 'any one is enough'}
        </span>
        {depth > 2 && <span className="text-[11px] text-warn">Deep nesting — consider simplifying</span>}
      </div>
      <div className="flex flex-col gap-2">
        {group.children.map((c, i) => (
          <NodeEditor
            key={c.id}
            node={c}
            ctx={ctx}
            index={i}
            count={group.children.length}
            depth={depth}
            onChange={(n) => setChild(i, n)}
            onRemove={() => remove(i)}
            onMove={(d) => move(i, d)}
          />
        ))}
        {group.children.length === 0 && <p className="text-xs text-warn">Empty group — add a condition.</p>}
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        <Tooltip content={H.editor.addCondition}>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => add(newCondition(ctx.defaultSeries))}>
            <Plus className="w-3.5 h-3.5" /> Condition
          </button>
        </Tooltip>
        <Tooltip content={H.editor.addPattern}>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => add(newPattern(ctx.defaultSeries))}>
            <CandlestickChart className="w-3.5 h-3.5" /> Pattern
          </button>
        </Tooltip>
        <Tooltip content={H.editor.addGroup}>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => add(newGroup(group.type === 'AND' ? 'OR' : 'AND', [newCondition(ctx.defaultSeries)]))}>
            <FolderPlus className="w-3.5 h-3.5" /> Group
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/** Root editor: the root is always a group (a single condition is wrapped). */
export function ExpressionEditor({ definition, onChange, defaultSeries, legs }: { definition: McxStrategyDefinition; onChange: (root: ExprNode) => void; defaultSeries: SeriesSpec; legs: Leg[] }) {
  const root: GroupNode = definition.expression.type === 'AND' || definition.expression.type === 'OR' ? definition.expression : newGroup('AND', [definition.expression]);
  return <GroupEditor group={root} ctx={{ definition, defaultSeries, legs }} onChange={onChange} />;
}
