'use client';

/**
 * Sorting and per-column filters for every table in the app.
 *
 *   const t = useTable(rows, columns);          // t.rows: filtered + sorted
 *   <FilterSummary table={t} noun="trades" />  // "Showing 3 of 41 trades · chips · Clear" (only while filtering)
 *   <ColumnHead table={t} k="net" className={th} />   // header: title sorts, the funnel opens the filters
 *   <NoMatchRow table={t} colSpan={12} />      // a row saying nothing matches (with Clear)
 *
 * The filters live with the table on screen (not remembered); the logic is in ./filtering.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ListFilter, X } from 'lucide-react';
import clsx from 'clsx';
import { Tooltip, type TooltipContent } from '../Tooltip';
import { Segmented } from '../ui';
import { HELP } from '../../lib/help';
import {
  WEEKDAYS,
  applyTable,
  describe,
  fieldStats,
  filterRows,
  isOn,
  valueOptions,
  withUnit,
  type CellValue,
  type Field,
  type FieldFilter,
  type FieldType,
  type Filters,
  type NumOp,
  type SortState,
} from './filtering';

export type { Field, FieldFilter, FieldType, SortState } from './filtering';

const T = HELP.table;

/** A column: one field (type + value) or several (`fields`) — e.g. product · group · strategy. */
export interface Column<T> {
  key: string;
  label: string;
  help?: TooltipContent;
  align?: 'right';
  type?: FieldType;
  value?: (row: T) => CellValue;
  display?: (v: string) => string;
  unit?: string;
  signed?: boolean;
  order?: readonly string[];
  noSort?: boolean;
  /** Several things in one column; the first sortable one sorts it from the header. */
  fields?: Field<T>[];
}

export function fieldsOf<T>(c: Column<T>): Field<T>[] {
  if (c.fields) return c.fields;
  if (!c.type || !c.value) return [];
  return [{ key: c.key, label: c.label, type: c.type, value: c.value, display: c.display, unit: c.unit, signed: c.signed, order: c.order, noSort: c.noSort }];
}

export interface Table<T> {
  /** Filtered and sorted. */
  rows: T[];
  /** Every row given to the table. */
  all: readonly T[];
  total: number;
  columns: readonly Column<T>[];
  fields: Field<T>[];
  filters: Filters;
  setFilter: (key: string, f: FieldFilter | undefined) => void;
  clear: () => void;
  sort: SortState | null;
  setSort: (s: SortState | null) => void;
  /** How many fields are filtering. */
  active: number;
  /** The rows are the pages loaded so far — more are on the server. */
  partial: boolean;
}

/** `partial`: the rows are pages loaded so far (more on the server) — said wherever counts are shown. */
export function useTable<T>(rows: readonly T[] | undefined, columns: readonly Column<T>[], opts: { sort?: SortState; partial?: boolean } = {}): Table<T> {
  const all = rows ?? EMPTY;
  const [filters, setFilters] = useState<Filters>({});
  const [sort, setSort] = useState<SortState | null>(opts.sort ?? null);
  const fields = useMemo(() => columns.flatMap(fieldsOf), [columns]);
  const view = useMemo(() => applyTable(all as readonly T[], fields, filters, sort), [all, fields, filters, sort]);
  const setFilter = useCallback((key: string, f: FieldFilter | undefined) => {
    setFilters((cur) => {
      const next = { ...cur };
      // Half-typed input stays (e.g. an operator chosen, no number yet); it filters once it means something.
      if (f) next[key] = f;
      else delete next[key];
      return next;
    });
  }, []);
  const clear = useCallback(() => setFilters({}), []);
  return {
    rows: view,
    all: all as readonly T[],
    total: all.length,
    columns,
    fields,
    filters,
    setFilter,
    clear,
    sort,
    setSort,
    active: fields.filter((f) => isOn(filters[f.key])).length,
    partial: !!opts.partial,
  };
}
const EMPTY: readonly never[] = [];

const firstDesc = (type: FieldType) => type === 'number' || type === 'date' || type === 'datetime';

// ---- header cell -------------------------------------------------------------------------------

/** A sortable, filterable `<th>`. `children` replaces the title text (the column's label is the default). */
export function ColumnHead<T>({ table, k, className, children }: { table: Table<T>; k: string; className?: string; children?: ReactNode }) {
  const col = table.columns.find((c) => c.key === k);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!col) return <th className={className}>{children}</th>;
  const fields = fieldsOf(col);
  const sortField = fields.find((f) => !f.noSort);
  const sorted = table.sort && fields.some((f) => f.key === table.sort!.key) ? table.sort : null;
  const on = fields.some((f) => isOn(table.filters[f.key]));
  const right = col.align === 'right';
  const cycle = () => {
    if (!sortField) return;
    const d = firstDesc(sortField.type);
    if (!sorted || sorted.key !== sortField.key) table.setSort({ key: sortField.key, desc: d });
    else if (sorted.desc === d) table.setSort({ key: sortField.key, desc: !d });
    else table.setSort(null);
  };
  const help: TooltipContent = col.help ?? { title: col.label };
  const title = (
    <span className={clsx(col.help && 'underline decoration-dotted decoration-slate-600 underline-offset-2')}>{children ?? col.label}</span>
  );
  return (
    <th className={clsx(className, right && 'text-right')} aria-sort={sorted ? (sorted.desc ? 'descending' : 'ascending') : undefined}>
      <span className={clsx('inline-flex items-center gap-0.5', right && 'flex-row-reverse')}>
        <Tooltip content={sortField ? { ...help, note: T.sort.body } : help}>
          {sortField ? (
            <button
              type="button"
              onClick={cycle}
              className={clsx('inline-flex items-center gap-0.5 [text-transform:inherit] whitespace-nowrap', sorted ? 'text-slate-200' : 'hover:text-slate-300')}
            >
              {title}
              {sorted && (sorted.desc ? <ArrowDown className="h-3 w-3 shrink-0" /> : <ArrowUp className="h-3 w-3 shrink-0" />)}
            </button>
          ) : (
            <span className="cursor-help whitespace-nowrap">{title}</span>
          )}
        </Tooltip>
        {fields.length > 0 && (
          <Tooltip content={{ ...T.filter, title: `Filter: ${col.label}`, note: on ? `On: ${fields.filter((f) => isOn(table.filters[f.key])).map((f) => describe(f, table.filters[f.key]!)).join(' · ')}` : T.filter.note }}>
            <button
              ref={anchor}
              type="button"
              aria-label={`Filter ${col.label}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className={clsx(
                'inline-flex items-center rounded p-0.5 transition-colors',
                on ? 'bg-accent/20 text-accent-soft' : open ? 'text-slate-200' : 'text-slate-600 hover:bg-ink-700 hover:text-slate-300',
              )}
            >
              <ListFilter className="h-3 w-3" />
            </button>
          </Tooltip>
        )}
      </span>
      {open && <FilterPopover table={table} col={col} anchor={anchor} onClose={() => setOpen(false)} />}
    </th>
  );
}

// ---- the panel -------------------------------------------------------------------------------

const POP_W = 288;

function FilterPopover<T>({ table, col, anchor, onClose }: { table: Table<T>; col: Column<T>; anchor: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const fields = fieldsOf(col);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = el.scrollHeight;
    const below = vh - a.bottom - 12;
    const above = a.top - 12;
    const down = below >= Math.min(h, 320) || below >= above;
    const maxH = Math.max(160, down ? below : above);
    const left = Math.min(Math.max(8, a.left - 8), vw - POP_W - 8);
    const top = down ? a.bottom + 4 : Math.max(8, a.top - 4 - Math.min(h, maxH));
    setPos({ top, left, maxH });
  }, [anchor]);

  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [place]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.current?.focus();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    // Keyboard users land in the panel.
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);

  const anyOn = fields.some((f) => isOn(table.filters[f.key]));
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Sort and filter: ${col.label}`}
      className={clsx(
        'fixed z-[55] flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 text-left text-xs font-normal normal-case tracking-normal text-slate-300 shadow-xl',
        !pos && 'invisible',
      )}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: POP_W, maxHeight: pos?.maxH }}
    >
      <div className="flex items-center gap-2 border-b border-ink-700/60 px-3 py-2">
        <ListFilter className="h-3.5 w-3.5 text-slate-500" />
        <span className="font-semibold text-slate-200">{col.label}</span>
        {anyOn && (
          <Tooltip content={T.clearColumn} className="ml-auto">
            <button type="button" className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-ink-800 hover:text-slate-200" onClick={() => fields.forEach((f) => table.setFilter(f.key, undefined))}>
              Clear
            </button>
          </Tooltip>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {fields.map((f, i) => (
          <FieldSection key={f.key} table={table} field={f} titled={fields.length > 1} first={i === 0} />
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-ink-700/60 px-3 py-2 text-[11px] text-slate-500">
        <span>
          Showing <span className="font-semibold tabular-nums text-slate-300">{table.rows.length.toLocaleString('en-IN')}</span> of {table.total.toLocaleString('en-IN')}
          {table.partial ? ' loaded' : ''}
        </span>
        <Tooltip content={T.done} className="ml-auto">
          <button type="button" className="btn-ghost py-0.5 text-xs" onClick={onClose}>
            Done
          </button>
        </Tooltip>
      </div>
    </div>,
    document.body,
  );
}

const SORT_WORDS: Record<FieldType, [string, string]> = {
  text: ['A → Z', 'Z → A'],
  enum: ['A → Z', 'Z → A'],
  number: ['Low → high', 'High → low'],
  date: ['Oldest first', 'Newest first'],
  datetime: ['Oldest first', 'Newest first'],
};

function FieldSection<T>({ table, field, titled, first }: { table: Table<T>; field: Field<T>; titled: boolean; first: boolean }) {
  const f = table.filters[field.key] ?? {};
  const set = (patch: Partial<FieldFilter>) => table.setFilter(field.key, { ...f, ...patch });
  // Values and ranges as the other columns' filters leave them.
  const facet = useMemo(() => filterRows(table.all, table.fields, table.filters, field.key), [table.all, table.fields, table.filters, field.key]);
  const stats = useMemo(() => fieldStats(facet, field), [facet, field]);
  const sorted = table.sort?.key === field.key ? table.sort : null;
  const sortBtn = (desc: boolean) => {
    const active = sorted && sorted.desc === desc;
    return (
      <Tooltip content={desc ? T.sortDown : T.sortUp}>
        <button
          type="button"
          aria-pressed={!!active}
          onClick={() => table.setSort(active ? null : { key: field.key, desc })}
          className={clsx('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]', active ? 'border-accent bg-accent text-white' : 'border-ink-700 bg-ink-850 text-slate-400 hover:text-slate-200')}
        >
          {desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
          {SORT_WORDS[field.type][desc ? 1 : 0]}
        </button>
      </Tooltip>
    );
  };
  return (
    <div className={clsx('flex flex-col gap-2 px-3 py-2.5', !first && 'border-t border-ink-700/60')}>
      {(titled || !field.noSort) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {titled && <span className="mr-auto text-[10px] font-semibold uppercase tracking-wide text-slate-400">{field.label}</span>}
          {!field.noSort && (
            <>
              {sortBtn(false)}
              {sortBtn(true)}
            </>
          )}
        </div>
      )}
      {(field.type === 'text' || field.type === 'enum') && <ValuesFilter field={field} f={f} set={set} facet={facet} />}
      {field.type === 'number' && <NumberFilter field={field} f={f} set={set} stats={stats} />}
      {(field.type === 'date' || field.type === 'datetime') && <DateFilter field={field} f={f} set={set} stats={stats} />}
      {stats.blanks > 0 && (
        <div className="flex items-center gap-2">
          <Tooltip content={T.blanks}>
            <span className="cursor-help text-[10px] uppercase tracking-wide text-slate-500">Blank ({stats.blanks})</span>
          </Tooltip>
          <Segmented
            label={`${field.label}: blank values`}
            value={f.blanks ?? 'any'}
            onChange={(v) => set({ blanks: v === 'any' ? undefined : v })}
            options={[
              { value: 'any', label: 'Keep', help: { ...T.blanks, title: 'Keep blanks' } },
              { value: 'hide', label: 'Hide', help: { ...T.blanks, title: 'Hide blanks' } },
              { value: 'only', label: 'Only', help: { ...T.blanks, title: 'Only blanks' } },
            ]}
          />
        </div>
      )}
    </div>
  );
}

const LIST_MAX = 200;

function ValuesFilter<T>({ field, f, set, facet }: { field: Field<T>; f: FieldFilter; set: (p: Partial<FieldFilter>) => void; facet: T[] }) {
  const id = useId();
  const [find, setFind] = useState('');
  const options = useMemo(() => valueOptions(facet, field), [facet, field]);
  const text = field.type === 'text';
  const q = (text ? (f.contains ?? '') : find).trim().toLowerCase();
  const picked = f.values ?? [];
  const listed = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;
  // Picked values the other filters (or the search) now hide stay listed, so they can be unticked.
  const missing = picked.filter((v) => !listed.some((o) => o.value === v)).map((v) => ({ value: v, label: field.display ? field.display(v) : v, count: 0 }));
  const shown = [...missing, ...listed].slice(0, LIST_MAX);
  const toggle = (v: string) => set({ values: picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v] });
  const searchable = text || options.length > 8;
  return (
    <div className="flex flex-col gap-1.5">
      {searchable && (
        <Tooltip content={text ? T.contains : T.find} className="block">
          <input
            aria-label={text ? `${field.label} contains` : `Find a ${field.label} value`}
            className="input w-full py-1 text-xs"
            placeholder={text ? 'Contains…' : 'Find a value…'}
            value={text ? (f.contains ?? '') : find}
            onChange={(e) => (text ? set({ contains: e.target.value }) : setFind(e.target.value))}
          />
        </Tooltip>
      )}
      <div className="flex items-center gap-1.5">
        <Tooltip content={T.values}>
          <span id={id} className="cursor-help text-[10px] uppercase tracking-wide text-slate-500">
            Values ({options.length})
          </span>
        </Tooltip>
        <span className="ml-auto" />
        {picked.length > 0 && (
          <Segmented
            label={`${field.label}: show or hide the ticked values`}
            value={f.exclude ? 'hide' : 'only'}
            onChange={(v) => set({ exclude: v === 'hide' || undefined })}
            options={[
              { value: 'only', label: 'Show only', help: T.showOnly },
              { value: 'hide', label: 'Hide', help: T.hide },
            ]}
          />
        )}
        {picked.length > 0 ? (
          <Tooltip content={T.pickNone}>
            <button type="button" className="rounded px-1 text-[11px] text-slate-400 hover:text-slate-200" onClick={() => set({ values: undefined, exclude: undefined })}>
              None
            </button>
          </Tooltip>
        ) : (
          listed.length > 1 && (
            <Tooltip content={T.pickAll}>
              <button type="button" className="rounded px-1 text-[11px] text-slate-400 hover:text-slate-200" onClick={() => set({ values: listed.slice(0, LIST_MAX).map((o) => o.value) })}>
                All
              </button>
            </Tooltip>
          )
        )}
      </div>
      <ul role="group" aria-labelledby={id} className="max-h-52 overflow-y-auto rounded-md border border-ink-700/60 bg-ink-850/50 py-0.5">
        {shown.map((o) => {
          const on = picked.includes(o.value);
          return (
            <li key={o.value}>
              <Tooltip
                className="flex"
                side="left"
                content={{
                  title: o.label,
                  body: `${o.count.toLocaleString('en-IN')} row${o.count === 1 ? '' : 's'} with the other columns’ filters.`,
                  note: on ? 'Click to untick.' : f.exclude && picked.length ? 'Tick to hide these rows too.' : 'Tick to show only these (several combine).',
                }}
              >
                <label className={clsx('flex w-full cursor-pointer items-center gap-2 px-2 py-1 hover:bg-ink-800', !on && o.count === 0 && 'opacity-50')}>
                  <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={on} onChange={() => toggle(o.value)} />
                  <span className={clsx('min-w-0 flex-1 truncate', on && f.exclude ? 'text-slate-500 line-through' : 'text-slate-200')}>{o.label}</span>
                  <span className="tabular-nums text-[10px] text-slate-500">{o.count.toLocaleString('en-IN')}</span>
                </label>
              </Tooltip>
            </li>
          );
        })}
        {!shown.length && <li className="px-2 py-1.5 text-slate-500">{options.length ? 'No value matches' : 'No values'}</li>}
      </ul>
      {missing.length + listed.length > LIST_MAX && <p className="text-[10px] text-slate-500">First {LIST_MAX} of {(missing.length + listed.length).toLocaleString('en-IN')} — type to narrow the list.</p>}
    </div>
  );
}

const OPS: Array<{ value: NumOp; label: string }> = [
  { value: 'between', label: 'between' },
  { value: 'gt', label: 'more than (>)' },
  { value: 'gte', label: 'at least (≥)' },
  { value: 'lt', label: 'less than (<)' },
  { value: 'lte', label: 'at most (≤)' },
  { value: 'eq', label: 'equal to (=)' },
  { value: 'neq', label: 'not equal to (≠)' },
];

const fmtStat = (n: number | string | undefined, unit?: string) =>
  n === undefined
    ? '—'
    : typeof n === 'number' && !Number.isFinite(n)
      ? (n > 0 ? '∞' : '−∞')
      : withUnit(typeof n === 'number' ? (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-IN') : String(Math.round(n * 100) / 100)) : n, unit);

function NumberFilter<T>({ field, f, set, stats }: { field: Field<T>; f: FieldFilter; set: (p: Partial<FieldFilter>) => void; stats: { min?: number | string; max?: number | string } }) {
  const op = f.op ?? 'between';
  const quick = (o: NumOp, label: string, help: TooltipContent) => {
    const on = f.op === o && f.a === '0' && !f.b;
    return (
      <Tooltip content={help}>
        <button
          type="button"
          aria-pressed={on}
          onClick={() => set(on ? { op: undefined, a: undefined, b: undefined } : { op: o, a: '0', b: undefined })}
          className={clsx('rounded-full border px-2 py-0.5 text-[11px]', on ? 'border-accent bg-accent text-white' : 'border-ink-700 bg-ink-850 text-slate-400 hover:text-slate-200')}
        >
          {label}
        </button>
      </Tooltip>
    );
  };
  const box = (k: 'a' | 'b', placeholder: string) => (
    <Tooltip content={{ ...T.num, note: field.unit ? `In ${field.unit}.` : undefined }} className="min-w-0 flex-1">
      <input
        aria-label={`${field.label} ${placeholder}`}
        inputMode="decimal"
        className="input w-full py-1 text-xs tabular-nums"
        placeholder={placeholder}
        value={f[k] ?? ''}
        onChange={(e) => set(k === 'a' ? { op, a: e.target.value } : { op, b: e.target.value })}
      />
    </Tooltip>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Tooltip content={T.op} className="block">
        <select aria-label={`${field.label} comparison`} className="input w-full py-1 text-xs" value={op} onChange={(e) => set({ op: e.target.value as NumOp, b: e.target.value === 'between' ? f.b : undefined })}>
          {OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Tooltip>
      <div className="flex items-center gap-1.5">
        {box('a', op === 'between' ? 'min' : 'value')}
        {op === 'between' && (
          <>
            <span className="text-slate-500">and</span>
            {box('b', 'max')}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {field.signed && quick('gt', 'Above 0', T.above0)}
        {field.signed && quick('lt', 'Below 0', T.below0)}
        <span className="ml-auto text-[10px] text-slate-500">
          Range {fmtStat(stats.min, field.unit)} … {fmtStat(stats.max, field.unit)}
        </span>
      </div>
    </div>
  );
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function DateFilter<T>({ field, f, set, stats }: { field: Field<T>; f: FieldFilter; set: (p: Partial<FieldFilter>) => void; stats: { min?: number | string; max?: number | string; weekdays: Set<number> } }) {
  const min = typeof stats.min === 'string' ? stats.min : undefined;
  const max = typeof stats.max === 'string' ? stats.max : undefined;
  const days = f.days ?? [];
  const weekdays = WEEK_ORDER.filter((d) => stats.weekdays.has(d) || days.includes(d));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Tooltip content={T.from} className="min-w-0 flex-1">
          <input aria-label={`${field.label} from`} type="date" className="input w-full py-1 text-xs" value={f.from ?? ''} min={min} max={f.to || max} onChange={(e) => set({ from: e.target.value || undefined })} />
        </Tooltip>
        <span className="text-slate-500">→</span>
        <Tooltip content={T.to} className="min-w-0 flex-1">
          <input aria-label={`${field.label} to`} type="date" className="input w-full py-1 text-xs" value={f.to ?? ''} min={f.from || min} max={max} onChange={(e) => set({ to: e.target.value || undefined })} />
        </Tooltip>
      </div>
      {field.type === 'datetime' && (
        <div className="flex items-center gap-1.5">
          <Tooltip content={T.timeFrom} className="min-w-0 flex-1">
            <input aria-label={`${field.label} from time`} type="time" className="input w-full py-1 text-xs" value={f.timeFrom ?? ''} onChange={(e) => set({ timeFrom: e.target.value || undefined })} />
          </Tooltip>
          <span className="text-slate-500">→</span>
          <Tooltip content={T.timeTo} className="min-w-0 flex-1">
            <input aria-label={`${field.label} to time`} type="time" className="input w-full py-1 text-xs" value={f.timeTo ?? ''} onChange={(e) => set({ timeTo: e.target.value || undefined })} />
          </Tooltip>
        </div>
      )}
      {weekdays.length > 1 && (
        <div role="group" aria-label={`${field.label}: weekdays`} className="flex flex-wrap gap-1">
          {weekdays.map((d) => {
            const on = days.includes(d);
            return (
              <Tooltip key={d} content={{ ...T.weekday, title: WEEKDAYS[d]! }}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ days: on ? days.filter((x) => x !== d) : [...days, d] })}
                  className={clsx('rounded-full border px-2 py-0.5 text-[11px]', on ? 'border-accent bg-accent text-white' : 'border-ink-700 bg-ink-850 text-slate-400 hover:text-slate-200')}
                >
                  {WEEKDAYS[d]}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- above and inside the table ------------------------------------------------------------------

/**
 * "Showing 3 of 41 trades" with a chip per filter and Clear — only while a column filter is on.
 * `partial`: the list loads in pages and more are on the server (the filters search the loaded rows).
 */
export function FilterSummary<T>({ table, noun, partial = table.partial, className }: { table: Table<T>; noun: string; partial?: boolean; className?: string }) {
  if (!table.active) return null;
  const on = table.fields.filter((f) => isOn(table.filters[f.key]));
  return (
    <div className={clsx('flex flex-wrap items-center gap-1.5 border-b border-ink-700/60 bg-ink-850/40 px-3 py-1.5 text-[11px] text-slate-400', className)}>
      <Tooltip content={T.summary}>
        <span className="inline-flex cursor-help items-center gap-1">
          <ListFilter className="h-3.5 w-3.5 text-accent-soft" />
          Showing <span className="font-semibold tabular-nums text-slate-200">{table.rows.length.toLocaleString('en-IN')}</span> of {table.total.toLocaleString('en-IN')}
          {partial ? ' loaded' : ''} {noun}
        </span>
      </Tooltip>
      {on.map((f) => (
        <span key={f.key} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 py-0.5 pl-2 pr-1 text-slate-200">
          {describe(f, table.filters[f.key]!)}
          <Tooltip content={T.chip}>
            <button type="button" aria-label={`Remove filter: ${describe(f, table.filters[f.key]!)}`} className="rounded-full p-0.5 text-slate-400 hover:bg-ink-700 hover:text-slate-200" onClick={() => table.setFilter(f.key, undefined)}>
              <X className="h-3 w-3" />
            </button>
          </Tooltip>
        </span>
      ))}
      <Tooltip content={T.clearAll}>
        <button type="button" className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-ink-800 hover:text-slate-200" onClick={table.clear}>
          Clear all
        </button>
      </Tooltip>
      {partial && (
        <Tooltip content={T.partial} className="ml-auto">
          <span className="cursor-help text-slate-500">Load more below to search further</span>
        </Tooltip>
      )}
    </div>
  );
}

/** A full-width row when the column filters hide every row. */
export function NoMatchRow<T>({ table, colSpan }: { table: Table<T>; colSpan: number }) {
  if (table.rows.length || !table.total) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-6 text-center text-xs text-slate-500">
        <Tooltip content={T.noMatch}>
          <span className="cursor-help">No rows match the column filters.</span>
        </Tooltip>{' '}
        <Tooltip content={T.clearAll}>
          <button type="button" className="text-accent-soft hover:underline" onClick={table.clear}>
            Clear filters
          </button>
        </Tooltip>
      </td>
    </tr>
  );
}
