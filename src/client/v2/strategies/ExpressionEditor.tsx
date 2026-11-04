'use client';

/**
 * Expression tree editor: AND / OR groups (nestable), NOT wrappers,
 * conditions (any leg vs any leg or a number) and candlestick patterns, with
 * reordering. Each condition reads in plain words and warns about incompatible
 * comparisons.
 *
 * Layout, the same for every item so a strategy scans at a glance:
 *   group header   All of these (AND) | Any of these (OR) — must be true · 3 items · name
 *   item card      ① sentence (leg chips · value · comparison · value)        ↑ ↓ NOT ✕   ▾ collapse
 *                  Value panel  →  comparison  →  Compared-with panel          (stacks when narrow)
 *   between items  the group's AND / OR
 */
import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowUp, Ban, CandlestickChart, FolderPlus, Info, Plus, Trash2, Undo2 } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import type { ConditionNode, ExprNode, GroupNode, LegDef, LegId, LegKind, Operand, PatternNode, SeriesSpec } from '@/shared/v2';
import { OPERATORS, PATTERN, PATTERNS, TIMEFRAME, candleText, legName, legNameById, operandCore, operandUnit } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { IconButton } from '../../components/ui';
import { ItemCard, Joiner, LogicToggle, OpWord, OperatorBox, Panel, Row } from '../../components/condition';
import { LEG_KIND_TEXT } from '../format';
import { H } from '../help';
import { adaptCondition, compareWithClose, isPriceLevel } from './comparison';
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
    <>
      <IconButton help={H.editor.moveUp} onClick={() => onMove(-1)} disabled={index === 0} className={btn}>
        <ArrowUp className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton help={H.editor.moveDown} onClick={() => onMove(1)} disabled={index >= count - 1} className={btn}>
        <ArrowDown className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton help={isNot ? H.editor.unwrapNot : H.editor.wrapNot} onClick={onNot} className={clsx(btn, isNot && 'text-warn')}>
        {isNot ? <Undo2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
      </IconButton>
      <IconButton help={H.editor.remove} onClick={onRemove} className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10">
        <Trash2 className="w-3.5 h-3.5" />
      </IconButton>
    </>
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

// ---- the sentence in each item's header ---------------------------------------------------------

/** "B · CE ATM · 15 min" in the leg's colour (candle type shown when it isn't Normal). */
function SeriesChip({ s, legs }: { s: SeriesSpec; legs: LegDef[] }) {
  const leg = legs.find((l) => l.id === s.leg);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-ink-700 bg-ink-850 px-1.5 py-px text-[11px]">
      <span className={clsx('font-semibold', leg ? LEG_KIND_TEXT[leg.kind] : 'text-warn')}>{legNameById(s.leg, legs)}</span>
      <span className="text-slate-500">
        · {TIMEFRAME[s.timeframe].label}
        {s.candle.type !== 'NORMAL' ? ` · ${candleText(s.candle)}` : ''}
      </span>
    </span>
  );
}

const sameSeries = (a: SeriesSpec, b: SeriesSpec) => JSON.stringify(a) === JSON.stringify(b);

function OperandWords({ o, legs, chip }: { o: Operand; legs: LegDef[]; chip: boolean }) {
  return (
    <>
      {chip && o.kind !== 'CONSTANT' && <SeriesChip s={o.series} legs={legs} />}
      <span className="font-semibold text-fg">{operandCore(o)}</span>
    </>
  );
}

function ConditionSentence({ node, legs }: { node: ConditionNode; legs: LegDef[] }) {
  const op = OPERATORS.find((o) => o.value === node.operator);
  const same = node.left.kind !== 'CONSTANT' && node.right.kind !== 'CONSTANT' && sameSeries(node.left.series, node.right.series);
  return (
    <>
      <OperandWords o={node.left} legs={legs} chip />
      <OpWord>{op?.label.toLowerCase() ?? node.operator}</OpWord>
      <OperandWords o={node.right} legs={legs} chip={!same} />
    </>
  );
}

function Sentence({ node, legs }: { node: ExprNode; legs: LegDef[] }) {
  switch (node.type) {
    case 'CONDITION':
      return <ConditionSentence node={node} legs={legs} />;
    case 'PATTERN':
      return (
        <>
          <SeriesChip s={node.series} legs={legs} />
          <span className="font-semibold text-fg">{PATTERN[node.pattern]?.label ?? node.pattern}</span>
          <span className="text-slate-400">detected</span>
        </>
      );
    case 'NOT':
      return (
        <>
          <span className="text-[11px] font-bold tracking-widest text-warn">NOT</span>
          <Sentence node={node.child} legs={legs} />
        </>
      );
    default:
      return (
        <>
          <span className="font-semibold text-fg">{node.label?.trim() || 'Group'}</span>
          <span className="text-slate-400">
            — {node.type === 'AND' ? 'all' : 'any'} of {node.children.length} item{node.children.length === 1 ? '' : 's'}
          </span>
        </>
      );
  }
}

// ---- item bodies ----------------------------------------------------------------------------------

function ConditionEditor({ node, ctx, onChange }: { node: ConditionNode; ctx: Ctx; onChange: (n: ConditionNode) => void }) {
  const [note, setNote] = useState<string | undefined>();
  const lu = operandUnit(node.left);
  const ru = operandUnit(node.right);
  const mismatch = lu && ru && lu !== ru;
  const opSpec = OPERATORS.find((o) => o.value === node.operator);
  const edit = (side: 'left' | 'right', next: Operand) => {
    const r = adaptCondition(node, side, next);
    if (r.note) setNote(r.note);
    onChange(r.cond);
  };
  // A price level (band, average) compared with a number — usually a leftover; offer the natural form.
  const levelVsNumber = isPriceLevel(node.left) && node.right.kind === 'CONSTANT';
  return (
    <div className="cond-body flex flex-col gap-2.5">
      <div className="cond-cols">
        <OperandEditor side="Left" value={node.left} onChange={(left) => edit('left', left)} defaultSeries={ctx.defaultSeries} legs={ctx.legs} onAddLeg={ctx.onAddLeg} allowConstant={false} />
        <OperatorBox>
          <Tooltip content={{ ...H.editor.operatorBox, title: `Comparison — ${opSpec?.label ?? ''}`, note: H.editor.operator.body }}>
            <select
              aria-label="Operator"
              className="input w-40 border-accent/40 bg-accent/5 py-1.5 pl-2 pr-6 text-center text-xs font-semibold text-accent-soft"
              value={node.operator}
              onChange={(e) => onChange({ ...node, operator: e.target.value as ConditionNode['operator'] })}
            >
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Tooltip>
        </OperatorBox>
        <OperandEditor
          side="Right"
          value={node.right}
          onChange={(right) => edit('right', right)}
          defaultSeries={node.left.kind === 'CONSTANT' ? ctx.defaultSeries : node.left.series}
          legs={ctx.legs}
          onAddLeg={ctx.onAddLeg}
        />
      </div>
      {note && !levelVsNumber && (
        <p className="flex items-center gap-1.5 text-[11px] text-accent-soft">
          <Info className="w-3.5 h-3.5 shrink-0" />
          {note}
        </p>
      )}
      {levelVsNumber && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-warn">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          This compares a price level with a fixed number. Bands and averages are usually compared with the price, e.g. “Close crossed above Bollinger Upper”.
          <Tooltip content={H.editor.compareWithClose}>
            <button type="button" className="btn-ghost py-0.5 text-[11px]" onClick={() => (setNote(undefined), onChange(compareWithClose(node)))}>
              Compare Close with it
            </button>
          </Tooltip>
        </p>
      )}
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
    <div className="max-w-xl">
      <Panel title="Candlestick pattern" help={H.editor.addPattern} footer={<SeriesPicker label="Pattern" value={node.series} onChange={(series) => onChange({ ...node, series })} legs={ctx.legs} onAddLeg={ctx.onAddLeg} />}>
        <Row label="Pattern">
          <Tooltip content={H.editor.pattern}>
            <select aria-label="Pattern" className="input py-1 text-xs font-semibold" value={node.pattern} onChange={(e) => onChange({ ...node, pattern: e.target.value as PatternNode['pattern'] })}>
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
          </Tooltip>
        </Row>
      </Panel>
    </div>
  );
}

// ---- an item: header (number, sentence, tools) + body ---------------------------------------------

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
  const isGroup = inner.type === 'AND' || inner.type === 'OR';

  let body: ReactNode;
  if (isGroup) body = <GroupEditor group={inner} ctx={ctx} onChange={setInner} depth={depth + 1} embedded />;
  else if (inner.type === 'NOT') body = <p className="text-xs text-slate-400">Nested NOT — remove one to edit.</p>;
  else if (inner.type === 'CONDITION') body = <ConditionEditor node={inner} ctx={ctx} onChange={setInner} />;
  else body = <PatternEditor node={inner as PatternNode} ctx={ctx} onChange={setInner} />;

  return (
    <ItemCard
      number={index + 1}
      tone={isNot ? 'not' : isGroup ? 'group' : 'plain'}
      badge={
        isNot && (
          <Tooltip content={H.editor.not}>
            <span className="cursor-help rounded bg-warn/15 px-1.5 py-px text-[10px] font-bold tracking-widest text-warn">NOT</span>
          </Tooltip>
        )
      }
      sentence={<Sentence node={inner} legs={ctx.legs} />}
      tools={<Toolbar index={index} count={count} onMove={onMove} onRemove={onRemove} onNot={toggleNot} isNot={isNot} />}
    >
      {body}
    </ItemCard>
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
  const n = group.children.length;

  return (
    <div className={clsx(!embedded && 'rounded-xl border border-ink-700 bg-ink-950/40 p-3')}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <LogicToggle value={group.type} onChange={(type) => onChange({ ...group, type })} count={n} />
        {depth > 2 && <span className="text-[11px] text-warn">Deep nesting — consider simplifying</span>}
        <Tooltip content={H.editor.groupLabel} className="ml-auto">
          <input
            aria-label="Group name"
            className="input w-48 py-1 text-xs"
            placeholder={depth === 0 ? 'Name (optional)' : 'e.g. Option conditions'}
            value={group.label ?? ''}
            onChange={(e) => onChange({ ...group, label: e.target.value || undefined })}
          />
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1">
        {group.children.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 && <Joiner type={group.type} help={group.type === 'AND' ? H.editor.joinAnd : H.editor.joinOr} />}
            <NodeEditor node={c} ctx={ctx} index={i} count={n} depth={depth} onChange={(next) => setChild(i, next)} onRemove={() => remove(i)} onMove={(d) => move(i, d)} />
          </Fragment>
        ))}
        {n === 0 && <p className="text-xs text-warn">Empty group — add a condition.</p>}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
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
  bare,
}: {
  expression: ExprNode;
  onChange: (root: ExprNode) => void;
  defaultSeries: SeriesSpec;
  legs: LegDef[];
  onAddLeg?: Ctx['onAddLeg'];
  /** No box around the root group (it already sits in a card). */
  bare?: boolean;
}) {
  const root: GroupNode = expression.type === 'AND' || expression.type === 'OR' ? expression : newGroup('AND', [expression]);
  return (
    <>
      <OneLegHint legs={legs} onAddLeg={onAddLeg} />
      <GroupEditor group={root} ctx={{ defaultSeries, legs, onAddLeg }} onChange={onChange} embedded={bare} />
    </>
  );
}
