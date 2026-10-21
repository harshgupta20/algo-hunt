'use client';

/** What a backtest / screen covers: a stock list, indices (NIFTY 50, BANKNIFTY, SENSEX…), one of your watchlists, or stocks / indices picked by hand. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { X } from 'lucide-react';
import type { EqPreset, EqStockSource } from '@/shared/equity';
import { EQ_PRESETS } from '@/shared/equity';
import { Tooltip } from '../components/Tooltip';
import { Segmented } from '../components/ui';
import { Cell } from '../components/form';
import { eqApi } from './api';
import { countLabel } from './format';
import { E } from './help';

/** How the stocks are chosen (the same shape the backtest request carries, so the history can run it again). */
export type StockSource = EqStockSource;

const indexPreset = (p: EqPreset) => EQ_PRESETS.find((x) => x.value === p)?.of === 'INDICES';
/** The picker's tab for a source: an index preset is the Indices tab. */
const tabOf = (s: StockSource) => (s.kind === 'PRESET' && indexPreset(s.preset) ? 'INDICES' : s.kind);

/** The symbols a source stands for (a preset / watchlist is looked up). */
export function useSymbols(source: StockSource): { symbols: string[]; loading: boolean; label: string } {
  const preset = useQuery({
    queryKey: ['eq-stocks', 'preset', source.kind === 'PRESET' ? source.preset : null],
    queryFn: () => eqApi.stocks({ preset: (source as { preset: EqPreset }).preset, limit: 5000 }),
    enabled: source.kind === 'PRESET',
    staleTime: 10 * 60_000,
  });
  const lists = useQuery({ queryKey: ['eq-watchlists'], queryFn: eqApi.watchlists, enabled: source.kind === 'WATCHLIST' });
  if (source.kind === 'PICK') return { symbols: source.symbols, loading: false, label: `${source.symbols.length} picked` };
  if (source.kind === 'WATCHLIST') {
    const w = lists.data?.find((x) => x.id === source.id);
    return { symbols: w?.symbols ?? [], loading: lists.isLoading, label: w?.name ?? 'Watchlist' };
  }
  return { symbols: preset.data?.stocks.map((s) => s.symbol) ?? [], loading: preset.isLoading, label: source.preset };
}

export function StockPicker({ value, onChange }: { value: StockSource; onChange: (s: StockSource) => void }) {
  const presets = useQuery({ queryKey: ['eq-presets'], queryFn: eqApi.presets, staleTime: 10 * 60_000 });
  const lists = useQuery({ queryKey: ['eq-watchlists'], queryFn: eqApi.watchlists });
  const { symbols, loading } = useSymbols(value);
  const [search, setSearch] = useState('');
  const results = useQuery({ queryKey: ['eq-stocks', 'search', search], queryFn: () => eqApi.stocks({ search, limit: 40 }), enabled: value.kind === 'PICK' && search.trim().length > 0, staleTime: 60_000 });
  const picked = value.kind === 'PICK' ? value.symbols : [];
  const toggle = (sym: string) => onChange({ kind: 'PICK', symbols: picked.includes(sym) ? picked.filter((s) => s !== sym) : [...picked, sym] });
  const presetInfo = value.kind === 'PRESET' ? presets.data?.find((p) => p.preset === value.preset) : undefined;
  const tab = tabOf(value);
  const listOf = (of: 'STOCKS' | 'INDICES') => (presets.data ?? []).filter((p) => p.of === of);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Cell label="Stocks / indices" help={E.picker.source}>
          <Segmented
            label="Stock source"
            value={tab}
            onChange={(k) =>
              onChange(
                k === 'PRESET' ? { kind: 'PRESET', preset: 'NIFTY50' } : k === 'INDICES' ? { kind: 'PRESET', preset: 'IDX_FNO' } : k === 'WATCHLIST' ? { kind: 'WATCHLIST', id: lists.data?.[0]?.id ?? '' } : { kind: 'PICK', symbols: [] },
              )
            }
            options={[
              { value: 'PRESET', label: 'Stock list', help: E.picker.preset },
              { value: 'INDICES', label: 'Indices', help: E.picker.indices },
              { value: 'WATCHLIST', label: 'Watchlist', help: E.picker.watchlist },
              { value: 'PICK', label: 'Pick', help: E.picker.pick },
            ]}
          />
        </Cell>
        {value.kind === 'PRESET' && (
          <Cell label={tab === 'INDICES' ? 'Indices' : 'List'} help={tab === 'INDICES' ? E.picker.indices : E.picker.preset}>
            <select aria-label={tab === 'INDICES' ? 'Index group' : 'Stock list'} className="input py-1 text-xs" value={value.preset} onChange={(e) => onChange({ kind: 'PRESET', preset: e.target.value as EqPreset })}>
              {listOf(tab === 'INDICES' ? 'INDICES' : 'STOCKS').map((p) => (
                <option key={p.preset} value={p.preset}>
                  {p.label} ({p.count.toLocaleString('en-IN')})
                </option>
              ))}
            </select>
          </Cell>
        )}
        {value.kind === 'WATCHLIST' && (
          <Cell label="Watchlist" help={E.picker.watchlist}>
            {lists.data?.length ? (
              <select aria-label="Watchlist" className="input py-1 text-xs" value={value.id} onChange={(e) => onChange({ kind: 'WATCHLIST', id: e.target.value })}>
                {lists.data.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.symbols.length})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-slate-500">No watchlists yet — make one in the Watchlists tab.</span>
            )}
          </Cell>
        )}
        {value.kind === 'PICK' && (
          <Cell label="Search" help={E.picker.search}>
            <input aria-label="Search stocks and indices" className="input py-1 text-xs w-56" placeholder="RELIANCE, Tata, BANKNIFTY, SENSEX…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Cell>
        )}
        <Tooltip content={E.picker.count}>
          <span className="mb-1 text-[11px] text-slate-500">{loading ? '…' : countLabel(symbols)}</span>
        </Tooltip>
      </div>
      {presetInfo?.note && <p className="text-[11px] text-warn">{presetInfo.note}</p>}
      {value.kind === 'PICK' && (
        <>
          {picked.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {picked.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-slate-200">
                  {s}
                  <Tooltip content={{ title: 'Remove', body: `Remove ${s}.` }}>
                    <button type="button" aria-label={`Remove ${s}`} className="text-slate-400 hover:text-bear" onClick={() => toggle(s)}>
                      <X className="w-3 h-3" />
                    </button>
                  </Tooltip>
                </span>
              ))}
              <Tooltip content={E.picker.clear}>
                <button type="button" className="px-1 text-xs text-slate-400 hover:text-bear" onClick={() => onChange({ kind: 'PICK', symbols: [] })}>
                  Clear
                </button>
              </Tooltip>
            </div>
          )}
          {search.trim() && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-ink-700/60 divide-y divide-ink-700/40">
              {results.data?.stocks.map((s) => (
                <Tooltip key={s.symbol} content={{ ...E.picker.pick, title: s.symbol, note: [s.name, s.sector].filter(Boolean).join(' · ') }} className="block">
                  <label className={clsx('flex cursor-pointer items-center gap-3 px-3 py-1.5 text-xs hover:bg-ink-800', picked.includes(s.symbol) && 'bg-accent/5')}>
                    <input type="checkbox" checked={picked.includes(s.symbol)} onChange={() => toggle(s.symbol)} aria-label={`Pick ${s.symbol}`} />
                    <span className="w-28 font-medium text-slate-200">{s.symbol}</span>
                    {s.index && <span className="rounded border border-accent/40 px-1 text-[10px] font-semibold uppercase tracking-wide text-accent-soft">Index</span>}
                    <span className="truncate text-slate-400">{s.name}</span>
                    {s.sector && <span className="ml-auto text-[11px] text-slate-500">{s.sector}</span>}
                  </label>
                </Tooltip>
              ))}
              {results.data?.stocks.length === 0 && <p className="p-3 text-xs text-slate-500">No NSE stock or index matches “{search}”.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
