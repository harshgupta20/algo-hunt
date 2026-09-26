'use client';

/**
 * Expression tree editor: AND / OR groups (nestable), NOT wrappers,
 * conditions (any leg vs any leg or a number) and candlestick patterns, with
 * reordering. Each condition reads in plain words and warns about incompatible
 * comparisons.
 */
import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowUp, Ban, CandlestickChart, FolderPlus, Plus, Trash2, Undo2 } from 'lucide-react';
import type { ConditionNode, ExprNode, GroupNode, LegDef, LegId, LegKind, PatternNode, SeriesSpec } from '@/shared/v2';
import { OPERATORS, PATTERNS, conditionText, legName, nodeText, operandUnit } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { IconButton } from '../../components/ui';
import { Cell } from '../components';
import { LEG_KIND_TEXT } from '../format';
import { H } from '../help';
import { newCondition, newGroup, newPattern, wrapNot } from './defaults';
import { OperandEditor, SeriesPicker } from './OperandEditor';

interface Ctx {
  defaultSeries: SeriesSpec;
  legs: LegDef[];
  onAddLeg?: (kind: LegKind) => LegId | undefined;
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
  const opSpec = OPERATORS.find((o) => o.value === node.operator);
  return (
    <div className="flex flex-col gap-3">
      <OperandEditor side="Left" value={node.left} onChange={(left) => onChange({ ...node, left })} defaultSeries={ctx.defaultSeries} legs={ctx.legs} onAddLeg={ctx.onAddLeg} allowConstant={false} />
      <div className="flex flex-wrap items-end gap-3">
        <Cell label="Operator" help={{ ...H.editor.operator, title: `Operator — ${opSpec?.label ?? ''}` }}>
          <select aria-label="Operator" className="input py-1 text-xs" value={node.operator} onChange={(e) => onChange({ ...node, operator: e.target.value as ConditionNode['operator'] })}>
            {OPERATORS.map((o) => (
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
        onAddLeg={ctx.onAddLeg}
      />
      <p className="text-[11px] text-slate-500">
        Reads as: <span className="font-mono text-slate-300">{conditionText(node, ctx.legs)}</span>
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
  const groups = [...new Set(PATTERNS.map((p) => p.group))];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Cell label="Pattern" help={H.editor.pattern}>
          <select aria-label="Pattern" className="input py-1 text-xs" value={node.pattern} onChange={(e) => onChange({ ...node, pattern: e.target.value as PatternNode['pattern'] })}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {PATTERNS.filter((p) => p.group === g).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Cell>
        <SeriesPicker label="Pattern" value={node.series} onChange={(series) => onChange({ ...node, series })} legs={ctx.legs} onAddLeg={ctx.onAddLeg} />
      </div>
      <p className="text-[11px] text-slate-500">
        Reads as: <span className="font-mono text-slate-300">{nodeText(node, ctx.legs)}</span>
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
        <Tooltip content={H.editor.groupLabel}>
          <input
            aria-label="Group name"
            className="input py-1 text-xs w-44"
            placeholder={depth === 0 ? 'Name (optional)' : 'e.g. Option conditions'}
            value={group.label ?? ''}
            onChange={(e) => onChange({ ...group, label: e.target.value || undefined })}
          />
        </Tooltip>
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

/** With a single leg, point out how to bring the other instruments into the conditions. */
function OneLegHint({ legs, onAddLeg }: { legs: LegDef[]; onAddLeg?: Ctx['onAddLeg'] }) {
  if (legs.length !== 1 || !onAddLeg) return null;
  const only = legs[0]!;
  const offer = (['FUT', 'CE', 'PE'] as const).filter((k) => k !== only.kind);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-slate-300">
      <span>
        Only leg <span className="font-semibold">{legName(only)}</span> exists, so every condition reads it. To combine the future with options, add legs:
      </span>
      {offer.map((k) => (
        <Tooltip key={k} content={{ ...H.legs.add, title: `Add a ${k === 'FUT' ? 'FUT' : `${k} ATM`} leg`, body: `Adds leg ${k === 'FUT' ? 'FUT' : `${k} ATM`} to section 1 so conditions can use it.` }}>
          <button type="button" className={clsx('btn-ghost py-0.5 text-xs font-semibold', LEG_KIND_TEXT[k])} onClick={() => onAddLeg(k)}>
            <Plus className="w-3 h-3" /> {k === 'FUT' ? 'FUT' : `${k} ATM`}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** Root editor: the root is always a group (a single condition is wrapped). */
export function ExpressionEditor({
  expression,
  onChange,
  defaultSeries,
  legs,
  onAddLeg,
}: {
  expression: ExprNode;
  onChange: (root: ExprNode) => void;
  defaultSeries: SeriesSpec;
  legs: LegDef[];
  onAddLeg?: Ctx['onAddLeg'];
}) {
  const root: GroupNode = expression.type === 'AND' || expression.type === 'OR' ? expression : newGroup('AND', [expression]);
  return (
    <>
      <OneLegHint legs={legs} onAddLeg={onAddLeg} />
      <GroupEditor group={root} ctx={{ defaultSeries, legs, onAddLeg }} onChange={onChange} />
    </>
  );
}
