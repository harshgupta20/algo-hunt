'use client';

/**
 * Equity condition builder: operands (price / indicator / number), conditions, and nested ALL / ANY groups
 * with the AND / OR drawn between items. Every condition reads in plain words and shows its own checks.
 */
import { Fragment, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FolderPlus, Plus, Trash2 } from 'lucide-react';
import type { EqCondition, EqGroup, EqNode, EqOperand, EqTimeframe, PriceField, ValidationIssue } from '@/shared/equity';
import { EQ_INDICATOR, EQ_INDICATORS, EQ_MA_TYPES, EQ_OPERATORS, PRICE_FIELDS, conditionText } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { IconButton, Segmented } from '../../components/ui';
import { Cell, NumberInput } from '../../components/form';
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
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Cell label={`${side} value`} help={E.cond.kind}>
        <select aria-label={`${side} value kind`} className={sel} value={value.kind} onChange={(e) => setKind(e.target.value as EqOperand['kind'])}>
          <option value="PRICE">Price / volume</option>
          <option value="INDICATOR">Indicator</option>
          <option value="NUMBER">Number</option>
        </select>
      </Cell>
      {value.kind === 'NUMBER' && (
        <Cell label="Number" help={E.cond.number}>
          <NumberInput label={`${side} number`} className="input py-1 text-xs w-24 tabular-nums" value={value.value} onChange={(n) => onChange({ ...value, value: n })} />
        </Cell>
      )}
      {value.kind === 'PRICE' && (
        <Cell label="Field" help={E.cond.field}>
          <select aria-label={`${side} field`} className={sel} value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value as PriceField })}>
            {PRICE_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Cell>
      )}
      {value.kind === 'INDICATOR' && <IndicatorFields value={value} onChange={onChange} side={side} />}
      {value.kind !== 'NUMBER' && (
        <>
          {more ? (
            <>
              <Cell label={tf === '1w' ? 'Weeks ago' : 'Days ago'} help={E.cond.barsAgo}>
                <NumberInput label={`${side} candles ago`} min={0} max={500} step={1} className={numBox} value={value.barsAgo ?? 0} onChange={(n) => onChange({ ...value, barsAgo: Math.round(n) || undefined })} />
              </Cell>
              {value.kind === 'INDICATOR' && (
                <Cell label="× Mult." help={E.cond.multiplier}>
                  <NumberInput label={`${side} multiplier`} min={0.01} max={100} step={0.1} className={numBox} value={value.multiplier ?? 1} onChange={(n) => onChange({ ...value, multiplier: n === 1 ? undefined : n })} />
                </Cell>
              )}
            </>
          ) : null}
          <Tooltip content={{ title: more ? 'Fewer settings' : 'More settings', body: `${tf === '1w' ? 'Weeks' : 'Days'} ago and a multiplier for this value.` }}>
            <button type="button" className="mb-0.5 inline-flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setMore(!more)}>
              {more ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {more ? 'less' : 'more'}
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

function IndicatorFields({ value, onChange, side }: { value: Indicator; onChange: (o: EqOperand) => void; side: string }) {
  const spec = EQ_INDICATOR[value.indicator];
  return (
    <>
      <Cell label="Indicator" help={E.cond.indicator}>
        <select
          aria-label={`${side} indicator`}
          className={sel}
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
      </Cell>
      {spec.params.map((p) => (
        <Cell key={p.name} label={p.label} help={{ ...E.cond.param, title: `${spec.short} ${p.label.toLowerCase()}`, note: `${p.min}–${p.max}` }}>
          <NumberInput
            label={`${side} ${spec.short} ${p.label}`}
            min={p.min}
            max={p.max}
            step={p.integer ? 1 : 0.1}
            className={numBox}
            value={value.params[p.name] ?? p.default}
            onChange={(n) => onChange({ ...value, params: { ...value.params, [p.name]: p.integer ? Math.round(n) : n } })}
          />
        </Cell>
      ))}
      {spec.sources && spec.sources.length > 1 && (
        <Cell label="Computed on" help={E.cond.source}>
          <select aria-label={`${side} source`} className={sel} value={value.source ?? spec.defaultSource} onChange={(e) => onChange({ ...value, source: e.target.value === spec.defaultSource ? undefined : (e.target.value as PriceField) })}>
            {spec.sources.map((s) => (
              <option key={s} value={s}>
                {PRICE_FIELDS.find((f) => f.value === s)?.label ?? s}
              </option>
            ))}
          </select>
        </Cell>
      )}
      {spec.outputs && (
        <Cell label="Line" help={E.cond.output}>
          <select aria-label={`${side} line`} className={sel} value={value.output ?? spec.outputs[0]!.value} onChange={(e) => onChange({ ...value, output: e.target.value === spec.outputs![0]!.value ? undefined : e.target.value })}>
            {spec.outputs.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Cell>
      )}
      {spec.smoothable && (
        <Cell label="MA of it" help={E.cond.ma}>
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
          {value.ma && <NumberInput label={`${side} MA period`} min={1} max={500} step={1} className={numBox} value={value.ma.period} onChange={(n) => onChange({ ...value, ma: { ...value.ma!, period: Math.round(n) } })} />}
        </Cell>
      )}
    </>
  );
}

function issuesAt(issues: ValidationIssue[], path: string) {
  return issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
}

function ConditionRow({ c, tf, onChange, issues, path }: { c: EqCondition; tf: EqTimeframe; onChange: (c: EqCondition) => void; issues: ValidationIssue[]; path: string }) {
  const mine = issuesAt(issues, path);
  return (
    <div className="flex flex-col gap-2">
      <OperandEditor value={c.left} onChange={(left) => onChange({ ...c, left })} tf={tf} side="Left" />
      <Cell label="Operator" help={E.cond.operator}>
        <select aria-label="Operator" className={sel} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as EqCondition['op'] })}>
          {EQ_OPERATORS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Cell>
      <OperandEditor value={c.right} onChange={(right) => onChange({ ...c, right })} tf={tf} side="Right" />
      <Tooltip content={E.cond.readsAs} className="block">
        <p className="font-mono text-[11px] text-slate-400">
          <span className="font-sans text-slate-500">Reads as: </span>
          {conditionText(c, tf)}
        </p>
      </Tooltip>
      {mine.map((i) => (
        <p key={i.message} className={clsx('text-[11px]', i.severity === 'error' ? 'text-bear' : 'text-warn')}>
          {i.message}
        </p>
      ))}
    </div>
  );
}

/** The group's AND / OR drawn between its items, so the logic reads down the list. */
function Joiner({ type }: { type: EqGroup['type'] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-px flex-1 bg-accent/25" />
      <Tooltip content={type === 'AND' ? E.cond.joinAll : E.cond.joinAny}>
        <span className="block rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-accent-soft">{type}</span>
      </Tooltip>
      <span className="h-px flex-1 bg-accent/25" />
    </div>
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
        <Segmented
          label="Group logic"
          value={group.type}
          onChange={(type) => onChange({ ...group, type })}
          options={[
            { value: 'AND', label: 'ALL', help: { ...E.cond.group, title: 'ALL — every item must be true' } },
            { value: 'OR', label: 'ANY', help: { ...E.cond.group, title: 'ANY — one is enough' } },
          ]}
        />
        <span className="text-[11px] text-slate-500">
          {group.children.length} item{group.children.length === 1 ? '' : 's'} · {group.type === 'AND' ? 'all must be true' : 'any one is enough'}
        </span>
      </div>
      {own.map((i) => (
        <p key={i.message} className={clsx('text-[11px]', i.severity === 'error' ? 'text-bear' : 'text-warn')}>
          {i.message}
        </p>
      ))}
      <div className="flex flex-col gap-1.5">
        {group.children.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 && <Joiner type={group.type} />}
            <div className="rounded-lg border border-ink-700/60 bg-ink-850 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {c.type === 'CONDITION' ? (
                    <ConditionRow c={c} tf={tf} onChange={(n) => setChild(i, n)} issues={issues} path={`${path}.${i}`} />
                  ) : (
                    <GroupEditor group={c} onChange={(n) => setChild(i, n)} tf={tf} issues={issues} path={`${path}.${i}`} depth={depth + 1} />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton help={E.cond.moveUp} onClick={() => move(i, -1)} disabled={i === 0} className={btn}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton help={E.cond.moveDown} onClick={() => move(i, 1)} disabled={i >= group.children.length - 1} className={btn}>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton help={E.cond.remove} onClick={() => remove(i)} className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconButton>
                </div>
              </div>
            </div>
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
