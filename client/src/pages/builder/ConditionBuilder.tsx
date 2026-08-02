import { Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { BuilderCatalog, Condition, Group, IndicatorRef, StrategyNode } from '@ash/shared';

export function newIndicatorRef(catalog: BuilderCatalog, kind?: string): IndicatorRef {
  const spec = catalog.indicators.find((i) => i.kind === kind) ?? catalog.indicators[0]!;
  const params = Object.fromEntries(spec.params.map((p) => [p.name, p.default]));
  return { kind: spec.kind, params, field: spec.fields?.[0]?.value };
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
  const grouped = groupByGroup(catalog.operators);
  const isTrend = cond.operator === 'rising' || cond.operator === 'falling' || cond.operator.includes('Pct');

  const setIndicatorKind = (kind: string) => set({ indicator: newIndicatorRef(catalog, kind) });
  const setParam = (name: string, v: number) => set({ indicator: { ...cond.indicator, params: { ...cond.indicator.params, [name]: v } } });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-850 border border-ink-700/60 p-2">
      <select className="input py-1 text-xs" value={cond.instrument} onChange={(e) => set({ instrument: e.target.value as Condition['instrument'] })}>
        {catalog.instruments.map((i) => (
          <option key={i.value} value={i.value} disabled={!i.enabled}>
            {i.label}
            {i.enabled ? '' : ' (soon)'}
          </option>
        ))}
      </select>

      <select className="input py-1 text-xs" value={cond.indicator.kind} onChange={(e) => setIndicatorKind(e.target.value)}>
        {catalog.indicators.map((i) => (
          <option key={i.kind} value={i.kind}>
            {i.label}
          </option>
        ))}
      </select>

      {indSpec?.params.map((p) => (
        <input
          key={p.name}
          type="number"
          title={p.label}
          className="input py-1 text-xs w-16"
          value={cond.indicator.params?.[p.name] ?? p.default}
          onChange={(e) => setParam(p.name, Number(e.target.value))}
        />
      ))}
      {indSpec?.fields && (
        <select className="input py-1 text-xs" value={cond.indicator.field} onChange={(e) => set({ indicator: { ...cond.indicator, field: e.target.value } })}>
          {indSpec.fields.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      )}

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

      {opSpec?.arity === 'value' && !cond.compareTo && (
        <input type="number" className="input py-1 text-xs w-20" value={cond.value ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} />
      )}
      {opSpec?.arity === 'value2' && (
        <>
          <input type="number" className="input py-1 text-xs w-16" value={cond.value ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} />
          <span className="text-xs text-slate-500">and</span>
          <input type="number" className="input py-1 text-xs w-16" value={cond.value2 ?? 0} onChange={(e) => set({ value2: Number(e.target.value) })} />
        </>
      )}
      {opSpec?.arity === 'percent' && (
        <>
          <input type="number" className="input py-1 text-xs w-16" value={cond.value ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} />
          <span className="text-xs text-slate-500">%</span>
        </>
      )}
      {isTrend && (
        <input
          type="number"
          title="Lookback bars"
          className="input py-1 text-xs w-14"
          value={cond.lookback ?? 1}
          onChange={(e) => set({ lookback: Number(e.target.value) })}
        />
      )}

      {opSpec?.arity === 'value' && (
        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          <input
            type="checkbox"
            checked={Boolean(cond.compareTo)}
            onChange={(e) => set({ compareTo: e.target.checked ? newIndicatorRef(catalog, 'EMA') : undefined, compareInstrument: e.target.checked ? cond.instrument : undefined })}
          />
          vs indicator
        </label>
      )}
      {cond.compareTo && (
        <>
          <select className="input py-1 text-xs" value={cond.compareInstrument ?? cond.instrument} onChange={(e) => set({ compareInstrument: e.target.value as Condition['instrument'] })}>
            {catalog.instruments.filter((i) => i.enabled).map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
          <select className="input py-1 text-xs" value={cond.compareTo.kind} onChange={(e) => set({ compareTo: newIndicatorRef(catalog, e.target.value) })}>
            {catalog.indicators.map((i) => (
              <option key={i.kind} value={i.kind}>
                {i.label}
              </option>
            ))}
          </select>
          {catalog.indicators
            .find((i) => i.kind === cond.compareTo!.kind)
            ?.params.map((p) => (
              <input
                key={p.name}
                type="number"
                className="input py-1 text-xs w-16"
                value={cond.compareTo!.params?.[p.name] ?? p.default}
                onChange={(e) => set({ compareTo: { ...cond.compareTo!, params: { ...cond.compareTo!.params, [p.name]: Number(e.target.value) } } })}
              />
            ))}
        </>
      )}

      <button className="ml-auto text-slate-500 hover:text-bear" onClick={onRemove} title="Remove condition">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

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
            <button
              key={l}
              onClick={() => onChange({ ...group, logic: l })}
              className={clsx('px-3 py-1', group.logic === l ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400')}
            >
              {l}
            </button>
          ))}
        </div>
        {group.label && <span className="text-xs text-slate-500">{group.label}</span>}
        {onRemove && (
          <button className="ml-auto text-slate-500 hover:text-bear text-xs" onClick={onRemove}>
            remove group
          </button>
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
          <button className="btn-ghost py-1 px-2 text-xs" onClick={() => onChange({ ...group, children: [...group.children, newCondition(catalog)] })}>
            <Plus className="w-3.5 h-3.5" /> Condition
          </button>
          <button className="btn-ghost py-1 px-2 text-xs" onClick={() => onChange({ ...group, children: [...group.children, newGroup()] })}>
            <Plus className="w-3.5 h-3.5" /> Group
          </button>
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
