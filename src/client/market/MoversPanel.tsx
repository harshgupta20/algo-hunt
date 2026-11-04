'use client';

/** The lists traders scan every day: gainers, losers, active, volume shockers, 52-week extremes, gaps, setups. */
import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { deriveMovers } from '@/shared/market/analytics';
import type { MarketMap, MoversData } from '@/shared/market/types';
import { Tooltip } from '../components/Tooltip';
import { ColumnHead, FilterSummary, NoMatchRow, useTable, type Column } from '../components/table/ColumnFilters';
import { Section } from '../components/ui';
import { fmtPct, fmtPrice, fmtRupees } from './format';
import { M } from './help';
import { Pct, Skeleton, StarButton, type useWatchlist } from './parts';

type Tab = 'gainers' | 'losers' | 'active' | 'volume' | 'highs' | 'lows' | 'gapUp' | 'gapDown' | 'openLow' | 'openHigh' | 'circuits' | 'preOpen';

const LABEL: Record<Tab, string> = {
  gainers: 'Gainers',
  losers: 'Losers',
  active: 'Most active',
  volume: 'Volume shockers',
  highs: '52W high',
  lows: '52W low',
  gapUp: 'Gap up',
  gapDown: 'Gap down',
  openLow: 'Open = Low',
  openHigh: 'Open = High',
  circuits: 'Circuits',
  preOpen: 'Pre-open',
};

interface Row {
  symbol: string;
  name: string;
  ltp: number;
  pct: number;
  extra?: ReactNode;
  /** The extra column's value as a number / word (for sorting and filters). */
  x?: number | string | null;
}

/** What the tab's extra column holds. */
const EXTRA: Partial<Record<Tab, { type: 'number' | 'enum'; unit?: string; help: string }>> = {
  active: { type: 'number', unit: '₹', help: 'Value traded today.' },
  gapUp: { type: 'number', unit: '%', help: 'Open vs the previous close.' },
  gapDown: { type: 'number', unit: '%', help: 'Open vs the previous close.' },
  openLow: { type: 'number', unit: '₹', help: 'Today’s opening price (= the day’s low).' },
  openHigh: { type: 'number', unit: '₹', help: 'Today’s opening price (= the day’s high).' },
  circuits: { type: 'enum', help: 'Upper or lower circuit.' },
  volume: { type: 'number', unit: '×', help: 'Today’s volume ÷ the 1-week average.' },
};

export function MoversPanel({
  map,
  movers,
  universeLabel,
  onPick,
  watch,
}: {
  map: MarketMap | undefined;
  movers: MoversData | undefined;
  universeLabel: string;
  onPick: (symbol: string) => void;
  watch: ReturnType<typeof useWatchlist>;
}) {
  const [tab, setTab] = useState<Tab>('gainers');
  const derived = useMemo(() => deriveMovers(map?.stocks ?? [], 25), [map]);
  const tabs: Tab[] = ['gainers', 'losers', 'active', 'volume', 'highs', 'lows', 'gapUp', 'gapDown', 'openLow', 'openHigh', 'circuits', ...(movers?.preOpen?.length ? (['preOpen'] as Tab[]) : [])];
  const { rows, extraHead, scope, empty } = useMemo((): { rows: Row[]; extraHead?: string; scope: string; empty: string } => {
    const fromMap = (list: typeof derived.gainers, extra?: (s: (typeof list)[number]) => ReactNode, x?: (s: (typeof list)[number]) => number | string | null) =>
      list.map((s) => ({ symbol: s.symbol, name: s.name, ltp: s.ltp, pct: s.pct, extra: extra?.(s), x: x?.(s) }));
    const needsOpen = map?.source === 'nse' ? 'Needs the opening price — connect Kite.' : 'None today.';
    switch (tab) {
      case 'gainers':
        return { rows: fromMap(derived.gainers), scope: universeLabel, empty: 'No gainers yet.' };
      case 'losers':
        return { rows: fromMap(derived.losers), scope: universeLabel, empty: 'No losers yet.' };
      case 'active':
        return { rows: fromMap(derived.active, (s) => fmtRupees(s.value), (s) => s.value), extraHead: 'Value', scope: universeLabel, empty: 'No trades yet.' };
      case 'gapUp':
        return { rows: derived.gapUp.map((s) => ({ symbol: s.symbol, name: s.name, ltp: s.ltp, pct: s.pct, extra: fmtPct(s.gap), x: s.gap })), extraHead: 'Gap', scope: universeLabel, empty: needsOpen };
      case 'gapDown':
        return { rows: derived.gapDown.map((s) => ({ symbol: s.symbol, name: s.name, ltp: s.ltp, pct: s.pct, extra: fmtPct(s.gap), x: s.gap })), extraHead: 'Gap', scope: universeLabel, empty: needsOpen };
      case 'openLow':
        return { rows: fromMap(derived.openLow, (s) => fmtPrice(s.open), (s) => s.open), extraHead: 'Open', scope: universeLabel, empty: needsOpen };
      case 'openHigh':
        return { rows: fromMap(derived.openHigh, (s) => fmtPrice(s.open), (s) => s.open), extraHead: 'Open', scope: universeLabel, empty: needsOpen };
      case 'circuits':
        return {
          rows: [...fromMap(derived.upperCircuit, () => <span className="text-bull">Upper</span>, () => 'Upper'), ...fromMap(derived.lowerCircuit, () => <span className="text-bear">Lower</span>, () => 'Lower')],
          extraHead: 'Circuit',
          scope: universeLabel,
          empty: map?.source === 'nse' ? 'Circuit limits come from Kite — connect Kite.' : 'No stock at a circuit.',
        };
      case 'volume':
        return { rows: (movers?.volumeShockers ?? []).map((s) => ({ symbol: s.symbol, name: s.name, ltp: s.ltp, pct: s.pct, extra: `${s.times.toFixed(1)}×`, x: s.times })), extraHead: '× 1W avg', scope: 'All NSE stocks', empty: 'No data from NSE.' };
      case 'highs':
        return { rows: (movers?.highs52 ?? []).map((s) => ({ ...s })), scope: 'All NSE stocks', empty: 'No new 52-week highs.' };
      case 'lows':
        return { rows: (movers?.lows52 ?? []).map((s) => ({ ...s })), scope: 'All NSE stocks', empty: 'No new 52-week lows.' };
      case 'preOpen':
        return { rows: (movers?.preOpen ?? []).map((s) => ({ ...s })), scope: 'F&O stocks', empty: 'Pre-open data appears 09:00–09:15.' };
    }
  }, [tab, derived, movers, map, universeLabel]);
  const extra = EXTRA[tab];
  const starred = watch.list;
  const columns = useMemo((): Column<Row>[] => {
    const stars = new Set(starred);
    const cols: Column<Row>[] = [
      {
        key: 'stock',
        label: 'Stock',
        help: { title: 'Stock', body: 'Click a row for the company’s details. ☆ adds it to your watchlist.' },
        fields: [
          { key: 'stock', label: 'Symbol', type: 'text', value: (r) => r.symbol },
          { key: 'name', label: 'Name', type: 'text', value: (r) => r.name },
          { key: 'starred', label: 'Watchlist', type: 'enum', noSort: true, value: (r) => (stars.has(r.symbol) ? 'Starred' : 'Not starred') },
        ],
      },
      { key: 'price', label: 'Price', align: 'right', help: { title: 'Price', body: 'Last traded price.' }, type: 'number', unit: '₹', value: (r) => r.ltp },
      { key: 'today', label: 'Today', align: 'right', help: { title: 'Today', body: 'Change from the previous close.' }, type: 'number', unit: '%', signed: true, value: (r) => r.pct },
    ];
    if (extraHead) cols.push({ key: 'extra', label: extraHead, align: 'right', help: { title: extraHead, body: extra?.help ?? extraHead }, type: extra?.type ?? 'text', unit: extra?.unit, value: (r) => r.x ?? null });
    return cols;
  }, [extraHead, extra, starred]);
  const table = useTable(rows, columns);

  return (
    <Section title="Movers" help={M.movers}>
      <div className="mb-3 flex flex-wrap gap-1">
        {tabs.map((tb) => (
          <Tooltip key={tb} content={M.moverTab[tb]} side="bottom">
            <button
              type="button"
              onClick={() => (setTab(tb), table.setFilter('extra', undefined))}
              className={clsx('rounded-md px-2 py-1 text-xs transition-colors', tb === tab ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400 hover:text-slate-200')}
            >
              {LABEL[tb]}
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
        <span>{scope}</span>
        <span>{rows.length ? (table.active ? `${table.rows.length} of ${rows.length} stocks` : `${rows.length} stocks`) : ''}</span>
      </div>
      {!map && !movers ? (
        <Skeleton className="h-80" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-500">{empty}</p>
      ) : (
        <div className="max-h-[380px] overflow-y-auto">
          <FilterSummary table={table} noun="stocks" className="rounded-md border" />
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-[1] bg-ink-900 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-6" />
                <ColumnHead table={table} k="stock" className="py-1 text-left font-medium" />
                <ColumnHead table={table} k="price" className="text-right font-medium" />
                <ColumnHead table={table} k="today" className="text-right font-medium" />
                {extraHead && <ColumnHead table={table} k="extra" className="pl-3 text-right font-medium" />}
              </tr>
            </thead>
            <tbody>
              <NoMatchRow table={table} colSpan={extraHead ? 5 : 4} />
              {table.rows.map((r) => (
                <tr key={r.symbol} className="cursor-pointer border-t border-ink-700/40 hover:bg-ink-800/60" onClick={() => onPick(r.symbol)}>
                  <td className="py-1.5">
                    <StarButton symbol={r.symbol} watch={watch} />
                  </td>
                  <td className="max-w-[220px] py-1.5">
                    <div className="font-medium text-slate-200">{r.symbol}</div>
                    <div className="truncate text-[10px] text-slate-500">{r.name}</div>
                  </td>
                  <td className="text-right tabular-nums text-slate-300">{fmtPrice(r.ltp)}</td>
                  <td className="text-right">
                    <Pct value={r.pct} className="font-medium" />
                  </td>
                  {extraHead && <td className="pl-3 text-right tabular-nums text-slate-300">{r.extra}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
