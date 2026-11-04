/**
 * Column filters and sorting for every table in the app — the logic only (no React), so it can be tested.
 *
 * A table declares its columns; a column holds one or more *fields* (what can be filtered / sorted): e.g. the
 * "Product · strategy" column has product, group and strategy, "Contract" has the symbol, its type, strike and
 * expiry. Each field has a type that decides its filter:
 *   text      contains … · pick values (show only / hide) · blanks
 *   enum      pick values (show only / hide) · blanks
 *   number    =, ≠, >, ≥, <, ≤, between (+ above / below 0 for P&L-like fields) · blanks
 *   date      from / to day · weekdays · blanks                      (value: 'YYYY-MM-DD')
 *   datetime  from / to day · time of day · weekdays · blanks       (value: ISO string or epoch ms; read in IST)
 * A field may give several values for a row (e.g. a product's expiries): the row matches when one of them does.
 */

export type FieldType = 'text' | 'enum' | 'number' | 'date' | 'datetime';
export type Scalar = string | number | boolean | null | undefined;
export type CellValue = Scalar | readonly Scalar[];

export interface Field<T> {
  key: string;
  label: string;
  type: FieldType;
  value: (row: T) => CellValue;
  /** How a value reads in the value list and the filter chips (text / enum). */
  display?: (v: string) => string;
  /** Unit of a number, shown in its inputs and chips: '₹', '%', 'min', 's' … */
  unit?: string;
  /** P&L-like number: offers "above 0" / "below 0" quick picks. */
  signed?: boolean;
  /** Enum values in this order (else A→Z). */
  order?: readonly string[];
  /** Not sortable (default: sortable). */
  noSort?: boolean;
}

export type NumOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';

export interface FieldFilter {
  /** text: the value contains this (any case). */
  contains?: string;
  /** text / enum: the picked values (as strings). */
  values?: string[];
  /** text / enum: hide the picked values instead of showing only them. */
  exclude?: boolean;
  /** number: the comparison and its operand(s), kept as typed. */
  op?: NumOp;
  a?: string;
  b?: string;
  /** date / datetime: first and last IST day, 'YYYY-MM-DD'. */
  from?: string;
  to?: string;
  /** datetime: IST time of day, 'HH:MM' (inclusive). */
  timeFrom?: string;
  timeTo?: string;
  /** date / datetime: weekdays (0 = Sunday … 6 = Saturday). */
  days?: number[];
  /** Rows with no value: hide them, or show only them. */
  blanks?: 'hide' | 'only';
}

export interface SortState {
  key: string;
  desc: boolean;
}

export type Filters = Record<string, FieldFilter>;

const IST = 330 * 60_000;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** No value. ±Infinity is a value (e.g. a profit factor with no losses). */
const isBlank = (v: Scalar) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** The row's values for a field, blanks dropped. */
export function valuesOf<T>(f: Field<T>, row: T): Scalar[] {
  const v = f.value(row);
  const list = Array.isArray(v) ? (v as readonly Scalar[]) : [v as Scalar];
  return list.filter((x) => !isBlank(x));
}

export const keyOf = (v: Scalar): string => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

export function displayOf<T>(f: Field<T>, v: string): string {
  return f.display ? f.display(v) : v;
}

const parseNum = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s.replace(/[,₹%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** IST day, time of day and weekday of a date / datetime value. */
export function istParts(v: Scalar, type: 'date' | 'datetime'): { day: string; time: string; weekday: number } | null {
  if (isBlank(v) || typeof v === 'boolean') return null;
  if (type === 'date') {
    const day = String(v).slice(0, 10);
    const d = new Date(`${day}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : { day, time: '00:00', weekday: d.getUTCDay() };
  }
  const ms = typeof v === 'number' ? v : Date.parse(String(v));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + IST);
  const iso = d.toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 16), weekday: d.getUTCDay() };
}

/** Is any part of this filter switched on? */
export function isOn(f: FieldFilter | undefined): boolean {
  if (!f) return false;
  return !!(
    f.contains?.trim() ||
    f.values?.length ||
    (f.op && (parseNum(f.a) !== null || (f.op === 'between' && parseNum(f.b) !== null))) ||
    f.from ||
    f.to ||
    f.timeFrom ||
    f.timeTo ||
    f.days?.length ||
    f.blanks
  );
}

/** Conditions other than the blanks choice. */
function hasConditions(f: FieldFilter): boolean {
  return isOn({ ...f, blanks: undefined });
}

function numberOk(n: number, f: FieldFilter): boolean {
  const a = parseNum(f.a);
  const b = parseNum(f.b);
  switch (f.op) {
    case 'eq':
      return a === null || Math.abs(n - a) < 1e-9;
    case 'neq':
      return a === null || Math.abs(n - a) >= 1e-9;
    case 'gt':
      return a === null || n > a;
    case 'gte':
      return a === null || n >= a;
    case 'lt':
      return a === null || n < a;
    case 'lte':
      return a === null || n <= a;
    case 'between': {
      const lo = a !== null && b !== null ? Math.min(a, b) : a;
      const hi = a !== null && b !== null ? Math.max(a, b) : b;
      return (lo === null || n >= lo) && (hi === null || n <= hi);
    }
    default:
      return true;
  }
}

/** One value against every condition of the filter (blanks are handled by the caller). */
function valueOk<T>(field: Field<T>, v: Scalar, f: FieldFilter): boolean {
  switch (field.type) {
    case 'text':
    case 'enum': {
      const key = keyOf(v);
      const q = f.contains?.trim().toLowerCase();
      if (q && !key.toLowerCase().includes(q) && !displayOf(field, key).toLowerCase().includes(q)) return false;
      if (f.values?.length) return f.values.includes(key) !== !!f.exclude;
      return true;
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v);
      return !Number.isNaN(n) && numberOk(n, f);
    }
    case 'date':
    case 'datetime': {
      const p = istParts(v, field.type);
      if (!p) return false;
      if (f.from && p.day < f.from) return false;
      if (f.to && p.day > f.to) return false;
      if (field.type === 'datetime') {
        if (f.timeFrom && p.time < f.timeFrom) return false;
        if (f.timeTo && p.time > f.timeTo) return false;
      }
      if (f.days?.length && !f.days.includes(p.weekday)) return false;
      return true;
    }
  }
}

/** Does the row pass this field's filter? */
export function rowOk<T>(field: Field<T>, row: T, f: FieldFilter | undefined): boolean {
  if (!f || !isOn(f)) return true;
  const vals = valuesOf(field, row);
  const hiding = (field.type === 'text' || field.type === 'enum') && !!f.exclude && !!f.values?.length;
  // A row with no value: kept unless blanks are hidden or a condition needs a value ("hide X" doesn't).
  if (!vals.length) return f.blanks === 'only' || (f.blanks !== 'hide' && (!hasConditions(f) || (hiding && !hasOtherThanValues(f))));
  if (f.blanks === 'only') return false;
  if (!hasConditions(f)) return true;
  // "Hide these values": a row is hidden when any of its values is picked.
  if (hiding) {
    if (vals.some((v) => f.values!.includes(keyOf(v)))) return false;
    const rest: FieldFilter = { ...f, values: undefined, exclude: undefined };
    return !hasConditions(rest) || vals.some((v) => valueOk(field, v, rest));
  }
  return vals.some((v) => valueOk(field, v, f));
}

/** Anything besides picked values (and blanks)? */
function hasOtherThanValues(f: FieldFilter): boolean {
  return hasConditions({ ...f, values: undefined, exclude: undefined });
}

/** Rows that pass every filter (optionally ignoring one field — for that field's own value counts). */
export function filterRows<T>(rows: readonly T[], fields: readonly Field<T>[], filters: Filters, except?: string): T[] {
  const on = fields.filter((fl) => fl.key !== except && isOn(filters[fl.key]));
  if (!on.length) return rows.slice();
  return rows.filter((r) => on.every((fl) => rowOk(fl, r, filters[fl.key])));
}

function sortKey<T>(field: Field<T>, row: T): number | string | null {
  const v = valuesOf(field, row)[0];
  if (v === undefined) return null;
  if (field.type === 'number') {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isNaN(n) ? null : n;
  }
  if (field.type === 'datetime') {
    const ms = typeof v === 'number' ? v : Date.parse(String(v));
    return Number.isFinite(ms) ? ms : null;
  }
  return displayOf(field, keyOf(v));
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' }) : null;

/** Rows sorted by a field; rows without a value always last; ties keep their order. */
export function sortRows<T>(rows: readonly T[], field: Field<T> | undefined, desc: boolean): T[] {
  if (!field) return rows.slice();
  const keyed = rows.map((r, i) => ({ r, i, k: sortKey(field, r) }));
  const order = field.type === 'enum' && field.order ? field.order : null;
  keyed.sort((x, y) => {
    if (x.k === null || y.k === null) return x.k === y.k ? x.i - y.i : x.k === null ? 1 : -1;
    let c: number;
    if (typeof x.k === 'number' && typeof y.k === 'number') c = x.k === y.k ? 0 : x.k < y.k ? -1 : 1;
    else if (order) c = order.indexOf(String(x.k)) - order.indexOf(String(y.k));
    else c = collator ? collator.compare(String(x.k), String(y.k)) : String(x.k).localeCompare(String(y.k));
    return c === 0 ? x.i - y.i : desc ? -c : c;
  });
  return keyed.map((x) => x.r);
}

/** Filtered, then sorted. */
export function applyTable<T>(rows: readonly T[], fields: readonly Field<T>[], filters: Filters, sort: SortState | null): T[] {
  const out = filterRows(rows, fields, filters);
  return sort ? sortRows(out, fields.find((f) => f.key === sort.key && !f.noSort), sort.desc) : out;
}

export interface ValueOption {
  value: string;
  label: string;
  count: number;
}

/** A text / enum field's distinct values with how many rows have each (under the other fields' filters). */
export function valueOptions<T>(rows: readonly T[], field: Field<T>): ValueOption[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const k of new Set(valuesOf(field, r).map(keyOf))) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out = [...counts].map(([value, count]) => ({ value, label: displayOf(field, value), count }));
  const order = field.order;
  if (order) return out.sort((a, b) => (order.indexOf(a.value) + 1 || 1e9) - (order.indexOf(b.value) + 1 || 1e9) || a.label.localeCompare(b.label));
  return collator ? out.sort((a, b) => collator.compare(a.label, b.label)) : out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Range, weekdays and blanks seen in a field (to bound the inputs and offer only what exists). */
export function fieldStats<T>(rows: readonly T[], field: Field<T>): { min?: number | string; max?: number | string; weekdays: Set<number>; blanks: number } {
  const weekdays = new Set<number>();
  let min: number | string | undefined;
  let max: number | string | undefined;
  let blanks = 0;
  for (const r of rows) {
    const vals = valuesOf(field, r);
    if (!vals.length) blanks++;
    for (const v of vals) {
      if (field.type === 'number') {
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isNaN(n)) continue;
        if (min === undefined || n < (min as number)) min = n;
        if (max === undefined || n > (max as number)) max = n;
      } else if (field.type === 'date' || field.type === 'datetime') {
        const p = istParts(v, field.type);
        if (!p) continue;
        weekdays.add(p.weekday);
        if (min === undefined || p.day < (min as string)) min = p.day;
        if (max === undefined || p.day > (max as string)) max = p.day;
      }
    }
  }
  return { min, max, weekdays, blanks };
}

// ---- describing a filter (the chips above a filtered table) -------------------------------------

const OP_TEXT: Record<NumOp, string> = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'between' };

export function withUnit(n: string, unit: string | undefined): string {
  if (!unit) return n;
  if (unit === '₹') return n.startsWith('-') ? `−₹${n.slice(1)}` : `₹${n}`;
  if (unit === '%') return `${n}%`;
  return `${n} ${unit}`;
}

const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });

/** "Net P&L < ₹0", "Side: Buy", "Opened: 1 Oct 26 → 29 Oct 26 · 14:00–15:30 · Thu" … */
export function describe<T>(field: Field<T>, f: FieldFilter): string {
  const parts: string[] = [];
  if (field.type === 'text' || field.type === 'enum') {
    if (f.contains?.trim()) parts.push(`contains “${f.contains.trim()}”`);
    if (f.values?.length) {
      const names = f.values.map((v) => displayOf(field, v));
      const list = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
      parts.push(f.exclude ? `not ${list}` : list);
    }
  } else if (field.type === 'number' && f.op) {
    const a = parseNum(f.a);
    const b = parseNum(f.b);
    if (f.op === 'between') {
      if (a !== null && b !== null) parts.push(`${withUnit(String(Math.min(a, b)), field.unit)} – ${withUnit(String(Math.max(a, b)), field.unit)}`);
      else if (a !== null) parts.push(`≥ ${withUnit(String(a), field.unit)}`);
      else if (b !== null) parts.push(`≤ ${withUnit(String(b), field.unit)}`);
    } else if (a !== null) parts.push(`${OP_TEXT[f.op]} ${withUnit(String(a), field.unit)}`);
  } else if (field.type === 'date' || field.type === 'datetime') {
    if (f.from || f.to) parts.push(f.from && f.to ? (f.from === f.to ? shortDay(f.from) : `${shortDay(f.from)} → ${shortDay(f.to)}`) : f.from ? `from ${shortDay(f.from)}` : `to ${shortDay(f.to!)}`);
    if (f.timeFrom || f.timeTo) parts.push(f.timeFrom && f.timeTo ? `${f.timeFrom}–${f.timeTo}` : f.timeFrom ? `after ${f.timeFrom}` : `before ${f.timeTo}`);
    if (f.days?.length) parts.push([...f.days].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((d) => WEEKDAYS[d]).join(', '));
  }
  if (f.blanks === 'only') parts.push('blank only');
  else if (f.blanks === 'hide') parts.push('no blanks');
  const sep = field.type === 'number' && !parts[0]?.startsWith('blank') && !parts[0]?.startsWith('no ') ? ' ' : ': ';
  return `${field.label}${sep}${parts.join(' · ')}`;
}
