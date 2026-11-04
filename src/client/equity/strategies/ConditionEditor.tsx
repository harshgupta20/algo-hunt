'use client';

/**
 * Equity condition builder: operands (price / indicator / number), conditions, and nested ALL / ANY groups
 * with the AND / OR drawn between items. Every condition reads in plain words and shows its own checks.
 *
 * Same structure as the V2 builder (src/client/components/condition.tsx):
 *   group header   All of these (AND) | Any of these (OR) — must be true · N items
 *   item card      ① sentence (value · comparison · value)                     ↑ ↓ ✕   ▾ collapse
 *                  Value panel  →  comparison  →  Compared-with panel          (stacks when narrow)
 */
import { Fragment, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FolderPlus, Plus, Trash2 } from 'lucide-react';
import type { EqCondition, EqGroup, EqNode, EqOperand, EqTimeframe, PriceField, ValidationIssue } from '@/shared/equity';
import { EQ_INDICATOR, EQ_INDICATORS, EQ_MA_TYPES, EQ_OPERATORS, PRICE_FIELDS, operandText } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { IconButton } from '../../components/ui';
import { NumberInput } from '../../components/form';
import { ItemCard, Joiner, LogicToggle, Mini, OpWord, OperatorBox, Panel, Row } from '../../components/condition';
import { E } from '../help';
import { uid } from '../format';

const sel = 'input py-1 text-xs';
const numBox = 'input py-1 text-xs w-16 tabular-nums';

type Indicator = Extract<EqOperand, { kind: 'INDICATOR' }>;

export function newCondition(): EqCondition {
  return { type: 'CONDITION', id: uid(), left: { kind: 'INDICATOR', indicator: 'SMA', params: { period: 50 } }, op: 'CROSSES_ABOVE', right: { kind: 'INDICATOR', indicator: 'SMA', params: { period: 100 } } };
}

export function newGroup(type: 'AND' | 'OR', children: EqNode[] = [newCondition()]): EqGroup {
  return { type, id: uid(), children };
}

function defaultIndicator(id: Indicator['indicator']): Indicator {
  const spec = EQ_INDICATOR[id];
  return { kind: 'INDICATOR', indicator: id, params: Object.fromEntries(spec.params.map((p) => [p.name, p.default])) };
}

function OperandEditor({ value, onChange, tf, side }: { value: EqOperand; onChange: (o: EqOperand) => void; tf: EqTimeframe; side: 'Left' | 'Right' }) {
  const hasExtras = value.kind !== 'NUMBER' && (!!value.barsAgo || (value.kind === 'INDICATOR' && value.multiplier !== undefined));
  const [more, setMore] = useState(hasExtras);
  const setKind = (k: EqOperand['kind']) => {
    if (k === value.kind) return;
    onChange(k === 'NUMBER' ? { kind: 'NUMBER', value: 60 } : k === 'PRICE' ? { kind: 'PRICE', field: 'close' } : defaultIndicator('SMA'));
  };
  const left = side === 'Left';
  return (
    <Panel
      title={left ? 'Value' : 'Compared with'}
      help={left ? E.cond.valuePanel : E.cond.comparedPanel}
      footer={
        value.kind !== 'NUMBER' && (
          <Row label="More">
            <Tooltip content={{ ...E.cond.more, title: more ? 'Fewer settings' : 'More settings' }}>
              <button type="button" className="inline-flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setMore(!more)}>
                {more ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {more ? 'Hide' : `${tf === '1w' ? 'Weeks' : 'Days'} ago, multiplier`}
              </button>
            </Tooltip>
            {more && (
              <>
                <Mini label={tf === '1w' ? 'Weeks ago' : 'Days ago'} help={E.cond.barsAgo}>
                  <NumberInput label={`${side} candles ago`} min={0} max={500} step={1} className={numBox} value={value.barsAgo ?? 0} onChange={(n) => onChange({ ...value, barsAgo: Math.round(n) || undefined })} />
                </Mini>
                {value.kind === 'INDICATOR' && (
                  <Mini label="×" help={E.cond.multiplier}>
                    <NumberInput label={`${side} multiplier`} min={0.01} max={100} step={0.1} className={numBox} value={value.multiplier ?? 1} onChange={(n) => onChange({ ...value, multiplier: n === 1 ? undefined : n })} />
                  </Mini>
                )}
              </>
            )}
          </Row>
        )
      }
    >
      <Row label="What">
        <Tooltip content={E.cond.kind}>
          <select aria-label={`${side} value kind`} className={sel} value={value.kind} onChange={(e) => setKind(e.target.value as EqOperand['kind'])}>
            <option value="PRICE">Price / volume</option>
            <option value="INDICATOR">Indicator</option>
            <option value="NUMBER">Number</option>
          </select>
        </Tooltip>
      </Row>
      {value.kind === 'NUMBER' && (
        <Row label="Number">
          <Tooltip content={E.cond.number}>
            <NumberInput label={`${side} number`} className="input py-1 text-xs w-28 font-semibold tabular-nums" value={value.value} onChange={(n) => onChange({ ...value, value: n })} />
          </Tooltip>
        </Row>
      )}
      {value.kind === 'PRICE' && (
        <Row label="Field">
          <Tooltip content={E.cond.field}>
            <select aria-label={`${side} field`} className={clsx(sel, 'font-semibold')} value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value as PriceField })}>
              {PRICE_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Tooltip>
        </Row>
      )}
      {value.kind === 'INDICATOR' && <IndicatorFields value={value} onChange={onChange} side={side} />}
    </Panel>
  );
}

function IndicatorFields({ value, onChange, side }: { value: Indicator; onChange: (o: EqOperand) => void; side: string }) {
  const spec = EQ_INDICATOR[value.indicator];
  return (
    <>
      <Row label="Indicator">
        <Tooltip content={E.cond.indicator}>
          <select
            aria-label={`${side} indicator`}
            className={clsx(sel, 'font-semibold')}
            value={value.indicator}
            onChange={(e) => {
              const next = defaultIndicator(e.target.value as Indicator['indicator']);
              onChange({ ...next, barsAgo: value.barsAgo });
            }}
          >
            {EQ_INDICATORS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </Tooltip>
      </Row>
      <Row label="Settings">
        {spec.params.map((p) => (
          <Mini key={p.name} label={p.label} help={{ ...E.cond.param, title: `${spec.short} ${p.label.toLowerCase()}`, note: `${p.min}–${p.max}` }}>
            <NumberInput
              label={`${side} ${spec.short} ${p.label}`}
              min={p.min}
              max={p.max}
              step={p.integer ? 1 : 0.1}
              className={numBox}
              value={value.params[p.name] ?? p.default}
              onChange={(n) => onChange({ ...value, params: { ...value.params, [p.name]: p.integer ? Math.round(n) : n } })}
            />
          </Mini>
        ))}
        {spec.sources && spec.sources.length > 1 && (
          <Mini label="of" help={E.cond.source}>
            <select aria-label={`${side} source`} className={sel} value={value.source ?? spec.defaultSource} onChange={(e) => onChange({ ...value, source: e.target.value === spec.defaultSource ? undefined : (e.target.value as PriceField) })}>
              {spec.sources.map((src) => (
                <option key={src} value={src}>
                  {PRICE_FIELDS.find((f) => f.value === src)?.label ?? src}
                </option>
              ))}
            </select>
          </Mini>
        )}
        {spec.outputs && (
          <Mini label="Line" help={E.cond.output}>
            <select aria-label={`${side} line`} className={sel} value={value.output ?? spec.outputs[0]!.value} onChange={(e) => onChange({ ...value, output: e.target.value === spec.outputs![0]!.value ? undefined : e.target.value })}>
              {spec.outputs.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Mini>
        )}
      </Row>
      {spec.smoothable && (
        <Row label="MA of it">
          <Tooltip content={E.cond.ma}>
            <select
              aria-label={`${side} moving average of the indicator`}
              className={sel}
              value={value.ma?.type ?? ''}
              onChange={(e) => onChange({ ...value, ma: e.target.value ? { type: e.target.value as 'SMA', period: value.ma?.period ?? 9 } : undefined })}
            >
              <option value="">None</option>
              {EQ_MA_TYPES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Tooltip>
          {value.ma && (
            <Mini label="Period" help={E.cond.ma}>
              <NumberInput label={`${side} MA period`} min={1} max={500} step={1} className={numBox} value={value.ma.period} onChange={(n) => onChange({ ...value, ma: { ...value.ma!, period: Math.round(n) } })} />
            </Mini>
          )}
        </Row>
      )}
    </>
  );
}

function issuesAt(issues: ValidationIssue[], path: string) {
  return issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
}

function ConditionRow({ c, tf, onChange, issues, path }: { c: EqCondition; tf: EqTimeframe; onChange: (c: EqCondition) => void; issues: ValidationIssue[]; path: string }) {
  const mine = issuesAt(issues, path);
  const op = EQ_OPERATORS.find((o) => o.value === c.op);
  return (
    <div className="cond-body flex flex-col gap-2.5">
      <div className="cond-cols">
        <OperandEditor value={c.left} onChange={(left) => onChange({ ...c, left })} tf={tf} side="Left" />
        <OperatorBox>
          <Tooltip content={{ ...E.cond.operator, title: `Comparison — ${op?.label ?? ''}` }}>
            <select
              aria-label="Operator"
              className="input w-40 border-accent/40 bg-accent/5 py-1.5 pl-2 pr-6 text-center text-xs font-semibold text-accent-soft"
              value={c.op}
              onChange={(e) => onChange({ ...c, op: e.target.value as EqCondition['op'] })}
            >
              {EQ_OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Tooltip>
        </OperatorBox>
        <OperandEditor value={c.right} onChange={(right) => onChange({ ...c, right })} tf={tf} side="Right" />
      </div>
      {mine.map((i) => (
        <p key={i.message} className={clsx('text-[11px]', i.severity === 'error' ? 'text-bear' : 'text-warn')}>
          {i.message}
        </p>
      ))}
    </div>
  );
}

/** An item's sentence: "SMA(50) crosses above SMA(100)", the comparison highlighted. */
function Sentence({ n, tf }: { n: EqNode; tf: EqTimeframe }) {
  if (n.type === 'CONDITION') {
    const op = EQ_OPERATORS.find((o) => o.value === n.op);
    return (
      <Tooltip content={E.cond.readsAs}>
        <span className="flex cursor-help flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-semibold text-fg">{operandText(n.left, tf)}</span>
          <OpWord>{op?.label.toLowerCase() ?? n.op}</OpWord>
          <span className="font-semibold text-fg">{operandText(n.right, tf)}</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <>
      <span className="font-semibold text-fg">Group</span>
      <span className="text-slate-400">
        — {n.type === 'AND' ? 'all' : 'any'} of {n.children.length} item{n.children.length === 1 ? '' : 's'}
      </span>
    </>
  );
}

export function GroupEditor({ group, onChange, tf, issues, path, depth = 0 }: { group: EqGroup; onChange: (g: EqGroup) => void; tf: EqTimeframe; issues: ValidationIssue[]; path: string; depth?: number }) {
  const setChild = (i: number, n: EqNode) => onChange({ ...group, children: group.children.map((c, j) => (j === i ? n : c)) });
  const remove = (i: number) => onChange({ ...group, children: group.children.filter((_, j) => j !== i) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= group.children.length) return;
    const children = [...group.children];
    [children[i], children[j]] = [children[j]!, children[i]!];
    onChange({ ...group, children });
  };
  const btn = 'p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-ink-800 disabled:opacity-30';
  const own = issues.filter((i) => i.path === path);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <LogicToggle value={group.type} onChange={(type) => onChange({ ...group, type })} count={group.children.length} />
      </div>
      {own.map((i) => (
        <p key={i.message} className={clsx('text-[11px]', i.severity === 'error' ? 'text-bear' : 'text-warn')}>
          {i.message}
        </p>
      ))}
      <div className="flex flex-col gap-1">
        {group.children.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 && <Joiner type={group.type} help={group.type === 'AND' ? E.cond.joinAll : E.cond.joinAny} />}
            <ItemCard
              number={i + 1}
              tone={c.type === 'CONDITION' ? 'plain' : 'group'}
              sentence={<Sentence n={c} tf={tf} />}
              tools={
                <>
                  <IconButton help={E.cond.moveUp} onClick={() => move(i, -1)} disabled={i === 0} className={btn}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton help={E.cond.moveDown} onClick={() => move(i, 1)} disabled={i >= group.children.length - 1} className={btn}>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton help={E.cond.remove} onClick={() => remove(i)} className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconButton>
                </>
              }
            >
              {c.type === 'CONDITION' ? (
                <ConditionRow c={c} tf={tf} onChange={(n) => setChild(i, n)} issues={issues} path={`${path}.${i}`} />
              ) : (
                <GroupEditor group={c} onChange={(n) => setChild(i, n)} tf={tf} issues={issues} path={`${path}.${i}`} depth={depth + 1} />
              )}
            </ItemCard>
          </Fragment>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Tooltip content={E.cond.addCondition}>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => onChange({ ...group, children: [...group.children, newCondition()] })}>
            <Plus className="w-3.5 h-3.5" /> Condition
          </button>
        </Tooltip>
        {depth < 3 && (
          <Tooltip content={E.cond.addGroup}>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => onChange({ ...group, children: [...group.children, newGroup(group.type === 'AND' ? 'OR' : 'AND')] })}>
              <FolderPlus className="w-3.5 h-3.5" /> Group
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
