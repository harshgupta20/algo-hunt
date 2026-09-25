import type { ReactNode } from 'react';
import { AlertTriangle, Hash, Plus, Trash2, Waves } from 'lucide-react';
import clsx from 'clsx';
import type { BuilderCatalog, Condition, Group, IndicatorRef, IndicatorSpec, StrategyNode } from '@ash/shared';
import { InfoTip, Tooltip, type TooltipContent } from '../../components/Tooltip';
import { IconButton } from '../../components/ui';
import { HELP } from '../../lib/help';
import { conditionText } from '../../lib/strategyText';

export function newIndicatorRef(catalog: BuilderCatalog, kind?: string, params?: Record<string, number>): IndicatorRef {
  const spec = catalog.indicators.find((i) => i.kind === kind) ?? catalog.indicators[0]!;
  const defaults = Object.fromEntries(spec.params.map((p) => [p.name, p.default]));
  return { kind: spec.kind, params: { ...defaults, ...params }, field: spec.fields?.[0]?.value };
}

export function newCondition(catalog: BuilderCatalog): Condition {
  return {
    type: 'condition',
    id: crypto.randomUUID(),
    instrument: 'future',
    indicator: newIndicatorRef(catalog),
    operator: 'crossAbove',
    value: 60,
  };
}

export function newGroup(logic: 'AND' | 'OR' = 'AND'): Group {
  return { type: 'group', id: crypto.randomUUID(), logic, children: [] };
}

type Scale = 'price' | 'oscillator' | 'macd' | 'direction' | 'volume' | 'oi';

/** What unit an indicator output is in — comparing different units rarely makes sense. */
function scaleOf(ref: IndicatorRef): Scale {
  switch (ref.kind) {
    case 'RSI':
      return 'oscillator';
    case 'MACD':
      return 'macd';
    case 'SUPERTREND':
      return ref.field === 'direction' ? 'direction' : 'price';
    case 'VOLUME':
      return 'volume';
    case 'OI':
      return 'oi';
    default:
      return 'price'; // EMA, SMA, VWAP, Bollinger, Price
  }
}

const SCALE_LABEL: Record<Scale, string> = {
  price: 'a price',
  oscillator: 'an oscillator (0–100)',
  macd: 'a MACD value (around 0)',
  direction: 'a direction (+1 / −1)',
  volume: 'a volume',
  oi: 'an open-interest count',
};

const NEXT_LEG: Record<string, Condition['instrument']> = { future: 'call', call: 'put', put: 'call' };

/** Sensible right-hand side when switching to “Compare to: Indicator”. */
function defaultComparison(catalog: BuilderCatalog, cond: Condition): Pick<Condition, 'compareTo' | 'compareInstrument'> {
  // Price-type → the classic crossover against a slower EMA on the same leg.
  if (scaleOf(cond.indicator) === 'price') return { compareTo: newIndicatorRef(catalog, 'EMA', { period: 50 }), compareInstrument: cond.instrument };
  // Oscillators etc. → the same indicator on another leg (e.g. Call RSI vs Put RSI).
  return { compareTo: { ...cond.indicator }, compareInstrument: NEXT_LEG[cond.instrument] ?? cond.instrument };
}

/** A captioned control: small label + ⓘ explanation above the input. */
function Cell({ label, help, children }: { label: string; help: TooltipContent; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
        <InfoTip content={help} />
      </span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function indicatorHelp(spec: IndicatorSpec | undefined, title = 'Indicator'): TooltipContent {
  return {
    title: spec ? `${title} — ${spec.label}` : title,
    body: spec?.description ?? HELP.builder.indicator.body,
    example: spec?.example,
    note: 'Pick another option to see what it measures.',
  };
}

/** Parameter + output inputs for an indicator (used for both sides of a comparison). */
function IndicatorInputs({
  spec,
  value,
  onChange,
}: {
  spec: IndicatorSpec | undefined;
  value: IndicatorRef;
  onChange: (ref: IndicatorRef) => void;
}) {
  return (
    <>
      {spec?.params.map((p) => (
        <Cell key={p.name} label={p.label} help={{ title: `${spec.label} · ${p.label}`, body: p.help ?? `${p.label} parameter.`, note: `Default ${p.default}.` }}>
          <input
            type="number"
            aria-label={`${spec.label} ${p.label}`}
            className="input py-1 text-xs w-16"
            min={p.min}
            max={p.max}
            value={value.params?.[p.name] ?? p.default}
            onChange={(e) => onChange({ ...value, params: { ...value.params, [p.name]: Number(e.target.value) } })}
          />
        </Cell>
      ))}
      {spec?.fields && (
        <Cell label="Output" help={{ ...HELP.builder.field, note: `${spec.label} outputs: ${spec.fields.map((f) => f.label).join(' · ')}` }}>
          <select className="input py-1 text-xs" value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value })}>
            {spec.fields.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Cell>
      )}
    </>
  );
}

function ConditionEditor({
  cond,
  catalog,
  onChange,
  onRemove,
}: {
  cond: Condition;
  catalog: BuilderCatalog;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<Condition>) => onChange({ ...cond, ...patch });
  const indSpec = catalog.indicators.find((i) => i.kind === cond.indicator.kind);
  const opSpec = catalog.operators.find((o) => o.value === cond.operator);
  const instSpec = catalog.instruments.find((i) => i.value === cond.instrument);
  const grouped = groupByGroup(catalog.operators);
  const isTrend = cond.operator === 'rising' || cond.operator === 'falling' || cond.operator.includes('Pct');
  const compareSpec = cond.compareTo ? catalog.indicators.find((i) => i.kind === cond.compareTo!.kind) : undefined;
  const compareInstSpec = catalog.instruments.find((i) => i.value === (cond.compareInstrument ?? cond.instrument));

  const setCompareMode = (mode: 'number' | 'indicator') =>
    set(mode === 'indicator' ? defaultComparison(catalog, cond) : { compareTo: undefined, compareInstrument: undefined });
  const scaleMismatch = cond.compareTo && scaleOf(cond.indicator) !== scaleOf(cond.compareTo);

  return (
    <div className="rounded-lg bg-ink-850 border border-ink-700/60 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Cell
          label="Instrument"
          help={{ title: `Instrument — ${instSpec?.label ?? ''}`, body: instSpec?.description, note: HELP.builder.instrument.body }}
        >
          <select className="input py-1 text-xs" value={cond.instrument} onChange={(e) => set({ instrument: e.target.value as Condition['instrument'] })}>
            {catalog.instruments.map((i) => (
              <option key={i.value} value={i.value} disabled={!i.enabled}>
                {i.label}
                {i.enabled ? '' : ' (soon)'}
              </option>
            ))}
          </select>
        </Cell>

        <Cell label="Indicator" help={indicatorHelp(indSpec)}>
          <select className="input py-1 text-xs" value={cond.indicator.kind} onChange={(e) => set({ indicator: newIndicatorRef(catalog, e.target.value) })}>
            {catalog.indicators.map((i) => (
              <option key={i.kind} value={i.kind}>
                {i.label}
              </option>
            ))}
          </select>
        </Cell>
        <IndicatorInputs spec={indSpec} value={cond.indicator} onChange={(indicator) => set({ indicator })} />

        <Cell
          label="Condition"
          help={{ title: `Condition — ${opSpec?.label ?? ''}`, body: opSpec?.description, example: opSpec?.example, note: 'Pick another option to see exactly when it is true.' }}
        >
          <select className="input py-1 text-xs" value={cond.operator} onChange={(e) => set({ operator: e.target.value as Condition['operator'] })}>
            {Object.entries(grouped).map(([g, ops]) => (
              <optgroup key={g} label={g}>
                {ops.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Cell>

        {opSpec?.arity === 'value' && (
          <Cell label="Compare to" help={HELP.builder.compareMode}>
            <div role="radiogroup" className="flex rounded-lg overflow-hidden border border-ink-700 text-xs">
              <Tooltip content={{ title: 'Compare to a number', body: 'Test against a fixed level you type, e.g. 60.' }} side="bottom">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!cond.compareTo}
                  onClick={() => setCompareMode('number')}
                  className={clsx('inline-flex items-center gap-1 px-2.5 py-1', !cond.compareTo ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400')}
                >
                  <Hash className="w-3 h-3" /> Number
                </button>
              </Tooltip>
              <Tooltip
                content={{
                  title: 'Compare to an indicator',
                  body: 'Test against another indicator’s live value instead of a fixed number — for crossovers.',
                  example: 'Future EMA(20) cross above Future EMA(50)',
                }}
                side="bottom"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={Boolean(cond.compareTo)}
                  onClick={() => setCompareMode('indicator')}
                  className={clsx('inline-flex items-center gap-1 px-2.5 py-1', cond.compareTo ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400')}
                >
                  <Waves className="w-3 h-3" /> Indicator
                </button>
              </Tooltip>
            </div>
          </Cell>
        )}

        {opSpec?.arity === 'value' && !cond.compareTo && (
          <Cell label="Value" help={HELP.builder.value}>
            <input type="number" aria-label="Value" className="input py-1 text-xs w-20" value={cond.value ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} />
          </Cell>
        )}
        {cond.compareTo && (
          <>
            <Cell
              label="Of instrument"
              help={{ ...HELP.builder.compareInstrument, note: compareInstSpec ? `${compareInstSpec.label}: ${compareInstSpec.description ?? ''}` : undefined }}
            >
              <select
                className="input py-1 text-xs"
                value={cond.compareInstrument ?? cond.instrument}
                onChange={(e) => set({ compareInstrument: e.target.value as Condition['instrument'] })}
              >
                {catalog.instruments
                  .filter((i) => i.enabled)
                  .map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}
                    </option>
                  ))}
              </select>
            </Cell>
            <Cell label="Compare indicator" help={indicatorHelp(compareSpec, 'Compare indicator')}>
              <select className="input py-1 text-xs" value={cond.compareTo.kind} onChange={(e) => set({ compareTo: newIndicatorRef(catalog, e.target.value) })}>
                {catalog.indicators.map((i) => (
                  <option key={i.kind} value={i.kind}>
                    {i.label}
                  </option>
                ))}
              </select>
            </Cell>
            <IndicatorInputs spec={compareSpec} value={cond.compareTo} onChange={(compareTo) => set({ compareTo })} />
          </>
        )}

        {opSpec?.arity === 'value2' && (
          <Cell label="Range" help={HELP.builder.range}>
            <input type="number" aria-label="Low" className="input py-1 text-xs w-16" value={cond.value ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} />
            <span className="text-xs text-slate-500">and</span>
            <input type="number" aria-label="High" className="input py-1 text-xs w-16" value={cond.value2 ?? 0} onChange={(e) => set({ value2: Number(e.target.value) })} />
          </Cell>
        )}
        {opSpec?.arity === 'percent' && (
          <Cell label="Percent" help={HELP.builder.percent}>
            <input type="number" aria-label="Percent" className="input py-1 text-xs w-16" value={cond.value ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} />
            <span className="text-xs text-slate-500">%</span>
          </Cell>
        )}
        {isTrend && (
          <Cell label="Lookback (bars)" help={HELP.builder.lookback}>
            <input
              type="number"
              aria-label="Lookback bars"
              min={1}
              className="input py-1 text-xs w-14"
              value={cond.lookback ?? 1}
              onChange={(e) => set({ lookback: Number(e.target.value) })}
            />
          </Cell>
        )}

        <IconButton help={HELP.builder.removeCondition} onClick={onRemove} wrapperClassName="ml-auto self-center" className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10">
          <Trash2 className="w-4 h-4" />
        </IconButton>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Reads as: <span className="font-mono text-slate-300">{conditionText(cond)}</span>
      </p>
      {scaleMismatch && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-warn">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {cond.indicator.kind} is {SCALE_LABEL[scaleOf(cond.indicator)]} but {cond.compareTo!.kind} is {SCALE_LABEL[scaleOf(cond.compareTo!)]} — they
          are on different scales, so this comparison will rarely mean anything.
        </p>
      )}
    </div>
  );
}

const LOGIC_HELP: Record<'AND' | 'OR', TooltipContent> = {
  AND: { title: 'AND — all must be true', body: 'Every condition and sub-group here must be true on the same closed candle.' },
  OR: { title: 'OR — any one is enough', body: 'The group is true as soon as one of its conditions or sub-groups is true.' },
};

function GroupEditor({
  group,
  catalog,
  onChange,
  onRemove,
  depth = 0,
}: {
  group: Group;
  catalog: BuilderCatalog;
  onChange: (g: Group) => void;
  onRemove?: () => void;
  depth?: number;
}) {
  const updateChild = (id: string, child: StrategyNode) => onChange({ ...group, children: group.children.map((c) => (c.id === id ? child : c)) });
  const removeChild = (id: string) => onChange({ ...group, children: group.children.filter((c) => c.id !== id) });

  return (
    <div className={clsx('rounded-xl border p-3', depth === 0 ? 'border-ink-700 bg-ink-900' : 'border-ink-700/60 bg-ink-850/40')}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex rounded-lg overflow-hidden border border-ink-700 text-xs">
          {(['AND', 'OR'] as const).map((l) => (
            <Tooltip key={l} content={LOGIC_HELP[l]}>
              <button
                type="button"
                onClick={() => onChange({ ...group, logic: l })}
                className={clsx('px-3 py-1', group.logic === l ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400')}
              >
                {l}
              </button>
            </Tooltip>
          ))}
        </div>
        <InfoTip content={HELP.builder.logic} />
        {group.label && <span className="text-xs text-slate-500">{group.label}</span>}
        {onRemove && (
          <IconButton help={HELP.builder.removeGroup} onClick={onRemove} wrapperClassName="ml-auto" className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10">
            <Trash2 className="w-4 h-4" />
          </IconButton>
        )}
      </div>

      <div className="space-y-2 pl-3 border-l-2 border-ink-700/60">
        {group.children.length === 0 && <p className="text-xs text-slate-600 py-1">No conditions yet — add one below.</p>}
        {group.children.map((child, i) => (
          <div key={child.id}>
            {i > 0 && <div className="text-[10px] font-semibold text-accent-soft/70 py-0.5">{group.logic}</div>}
            {child.type === 'condition' ? (
              <ConditionEditor cond={child} catalog={catalog} onChange={(c) => updateChild(child.id, c)} onRemove={() => removeChild(child.id)} />
            ) : (
              <GroupEditor group={child} catalog={catalog} onChange={(g) => updateChild(child.id, g)} onRemove={() => removeChild(child.id)} depth={depth + 1} />
            )}
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <Tooltip content={HELP.builder.addCondition}>
            <button type="button" className="btn-ghost py-1 px-2 text-xs" onClick={() => onChange({ ...group, children: [...group.children, newCondition(catalog)] })}>
              <Plus className="w-3.5 h-3.5" /> Condition
            </button>
          </Tooltip>
          <Tooltip content={HELP.builder.addGroup}>
            <button type="button" className="btn-ghost py-1 px-2 text-xs" onClick={() => onChange({ ...group, children: [...group.children, newGroup()] })}>
              <Plus className="w-3.5 h-3.5" /> Group
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export function RuleTreeEditor({ root, catalog, onChange }: { root: Group; catalog: BuilderCatalog; onChange: (g: Group) => void }) {
  return <GroupEditor group={root} catalog={catalog} onChange={onChange} depth={0} />;
}

function groupByGroup(operators: BuilderCatalog['operators']): Record<string, BuilderCatalog['operators']> {
  const out: Record<string, BuilderCatalog['operators']> = {};
  for (const o of operators) {
    (out[o.group] ??= []).push(o);
  }
  return out;
}
