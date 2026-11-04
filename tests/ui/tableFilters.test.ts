import { describe as group, expect, it } from 'vitest';
import { applyTable, describe, fieldStats, filterRows, isOn, rowOk, sortRows, valueOptions, type Field, type Filters } from '@/client/components/table/filtering';

interface Trade {
  id: string;
  product: string;
  side: 'BUY' | 'SELL';
  net: number | null;
  entryAt: string; // ISO (UTC)
  expiries: string[];
  reason?: string;
}

const rows: Trade[] = [
  // 29 Oct 2026 14:30 IST = 09:00 UTC (a Thursday)
  { id: 'a', product: 'BANKEX', side: 'BUY', net: -450.98, entryAt: '2026-10-29T09:00:00Z', expiries: ['2026-10-29'], reason: 'STOP' },
  // 27 Oct 2026 09:20 IST (Tuesday)
  { id: 'b', product: 'NIFTY', side: 'SELL', net: 1200, entryAt: '2026-10-27T03:50:00Z', expiries: ['2026-10-28', '2026-11-04'], reason: 'TARGET' },
  { id: 'c', product: 'BANKNIFTY', side: 'BUY', net: 0, entryAt: '2026-10-28T08:15:00Z', expiries: [] },
  { id: 'd', product: 'NIFTY', side: 'BUY', net: null, entryAt: '2026-11-02T05:00:00Z', expiries: ['2026-11-04'], reason: 'STOP' },
];

const F = {
  product: { key: 'product', label: 'Product', type: 'text', value: (t) => t.product },
  side: { key: 'side', label: 'Side', type: 'enum', value: (t) => t.side, display: (v) => (v === 'BUY' ? 'Buy' : 'Sell') },
  net: { key: 'net', label: 'Net P&L', type: 'number', value: (t) => t.net, unit: '₹', signed: true },
  opened: { key: 'opened', label: 'Opened', type: 'datetime', value: (t) => t.entryAt },
  expiry: { key: 'expiry', label: 'Expiry', type: 'date', value: (t) => t.expiries },
  reason: { key: 'reason', label: 'Why', type: 'enum', value: (t) => t.reason },
} satisfies Record<string, Field<Trade>>;
const fields = Object.values(F) as Field<Trade>[];
const ids = (list: Trade[]) => list.map((t) => t.id);
const run = (filters: Filters) => ids(filterRows(rows, fields, filters));

group('table column filters', () => {
  it('text: contains is case-insensitive and also matches the display', () => {
    expect(run({ product: { contains: 'bank' } })).toEqual(['a', 'c']);
    expect(run({ side: { contains: 'sel' } })).toEqual(['b']); // "Sell" (display), raw is SELL
  });

  it('values: show only / hide, several combine', () => {
    expect(run({ product: { values: ['NIFTY', 'BANKEX'] } })).toEqual(['a', 'b', 'd']);
    expect(run({ product: { values: ['NIFTY'], exclude: true } })).toEqual(['a', 'c']);
  });

  it('hiding a value keeps blank rows; showing only a value drops them', () => {
    expect(run({ reason: { values: ['STOP'], exclude: true } })).toEqual(['b', 'c']);
    expect(run({ reason: { values: ['STOP'] } })).toEqual(['a', 'd']);
  });

  it('numbers: every comparison, blanks never match a comparison', () => {
    expect(run({ net: { op: 'gt', a: '0' } })).toEqual(['b']);
    expect(run({ net: { op: 'lt', a: '0' } })).toEqual(['a']);
    expect(run({ net: { op: 'gte', a: '0' } })).toEqual(['b', 'c']);
    expect(run({ net: { op: 'eq', a: '0' } })).toEqual(['c']);
    expect(run({ net: { op: 'neq', a: '0' } })).toEqual(['a', 'b']);
    expect(run({ net: { op: 'between', a: '1500', b: '-500' } })).toEqual(['a', 'b', 'c']); // either order
    expect(run({ net: { op: 'between', a: '100' } })).toEqual(['b']); // open-ended
    expect(run({ net: { op: 'lte', a: '₹1,200' } })).toEqual(['a', 'b', 'c']); // ₹ and commas are ignored
  });

  it('an operator without a number is not a filter yet', () => {
    expect(isOn({ op: 'gt' })).toBe(false);
    expect(isOn({ op: 'gt', a: '  ' })).toBe(false);
    expect(run({ net: { op: 'gt' } })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('blanks: hide or only', () => {
    expect(run({ net: { blanks: 'only' } })).toEqual(['d']);
    expect(run({ net: { blanks: 'hide' } })).toEqual(['a', 'b', 'c']);
    expect(run({ expiry: { blanks: 'only' } })).toEqual(['c']);
  });

  it('datetime: IST day, time of day and weekday', () => {
    expect(run({ opened: { from: '2026-10-28', to: '2026-10-29' } })).toEqual(['a', 'c']);
    expect(run({ opened: { timeFrom: '14:00' } })).toEqual(['a']); // 14:30 IST; c is 13:45 IST
    expect(run({ opened: { timeTo: '09:30' } })).toEqual(['b']);
    expect(run({ opened: { days: [4] } })).toEqual(['a']); // Thursday
  });

  it('a field with several values matches when one value meets every condition', () => {
    expect(run({ expiry: { from: '2026-11-01' } })).toEqual(['b', 'd']);
    expect(run({ expiry: { days: [3] } })).toEqual(['b', 'd']); // 4 Nov 2026 is a Wednesday
  });

  it('filters on several columns combine', () => {
    expect(run({ product: { values: ['NIFTY'] }, side: { values: ['BUY'] } })).toEqual(['d']);
  });

  it('sorts numbers, text and dates with blanks always last', () => {
    expect(ids(sortRows(rows, F.net, true))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(sortRows(rows, F.net, false))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(sortRows(rows, F.product as Field<Trade>, false))).toEqual(['a', 'c', 'b', 'd']); // ties keep their order
    expect(ids(sortRows(rows, F.opened as Field<Trade>, true))).toEqual(['d', 'a', 'c', 'b']);
  });

  it('applyTable filters, then sorts', () => {
    expect(ids(applyTable(rows, fields, { side: { values: ['BUY'] } }, { key: 'net', desc: true }))).toEqual(['c', 'a', 'd']);
  });

  it('value lists count rows under the other filters', () => {
    const facet = filterRows(rows, fields, { side: { values: ['BUY'] }, product: { values: ['NIFTY'] } }, 'product');
    expect(valueOptions(facet, F.product as Field<Trade>)).toEqual([
      { value: 'BANKEX', label: 'BANKEX', count: 1 },
      { value: 'BANKNIFTY', label: 'BANKNIFTY', count: 1 },
      { value: 'NIFTY', label: 'NIFTY', count: 1 },
    ]);
  });

  it('stats give the range, weekdays and blanks', () => {
    const n = fieldStats(rows, F.net as Field<Trade>);
    expect([n.min, n.max, n.blanks]).toEqual([-450.98, 1200, 1]);
    const d = fieldStats(rows, F.opened as Field<Trade>);
    expect([d.min, d.max, [...d.weekdays].sort()]).toEqual(['2026-10-27', '2026-11-02', [1, 2, 3, 4]]);
  });

  it('describes a filter for its chip', () => {
    expect(describe(F.net as Field<Trade>, { op: 'lt', a: '0' })).toBe('Net P&L < ₹0');
    expect(describe(F.side as Field<Trade>, { values: ['BUY'] })).toBe('Side: Buy');
    expect(describe(F.product as Field<Trade>, { values: ['NIFTY'], exclude: true })).toBe('Product: not NIFTY');
    expect(describe(F.opened as Field<Trade>, { timeFrom: '14:00', days: [4, 1] })).toBe('Opened: after 14:00 · Mon, Thu');
  });

  it('rowOk ignores filters that are off', () => {
    expect(rowOk(F.net as Field<Trade>, rows[3]!, undefined)).toBe(true);
    expect(rowOk(F.net as Field<Trade>, rows[3]!, {})).toBe(true);
  });
});
