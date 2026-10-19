'use client';

/** Watchlists: your own stock lists — start from an index list or pick stocks one by one. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ListPlus, Plus, Save, Trash2, X } from 'lucide-react';
import type { EqPreset, EqWatchlist } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { EmptyState, IconButton } from '../../components/ui';
import { Cell } from '../../components/form';
import { InlineSpinner, SkeletonRows } from '../../components/loaders';
import { eqApi } from '../api';
import { ago } from '../format';
import { E } from '../help';

function Editor({ list, onDone }: { list: EqWatchlist | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(list?.name ?? '');
  const [symbols, setSymbols] = useState<string[]>(list?.symbols ?? []);
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(false);
  const presets = useQuery({ queryKey: ['eq-presets'], queryFn: eqApi.presets, staleTime: 10 * 60_000 });
  const results = useQuery({ queryKey: ['eq-stocks', 'search', search], queryFn: () => eqApi.stocks({ search, limit: 30 }), enabled: search.trim().length > 0, staleTime: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['eq-watchlists'] });
  const save = useMutation({ mutationFn: () => (list ? eqApi.updateWatchlist(list.id, { name, symbols }) : eqApi.createWatchlist({ name, symbols })), onSuccess: () => (refresh(), onDone()) });
  const remove = useMutation({ mutationFn: () => eqApi.removeWatchlist(list!.id), onSuccess: () => (refresh(), onDone()) });
  const addPreset = useMutation({
    mutationFn: (preset: EqPreset) => eqApi.stocks({ preset, limit: 5000 }),
    onSuccess: (r) => setSymbols((cur) => [...cur, ...r.stocks.map((s) => s.symbol).filter((s) => !cur.includes(s))]),
  });
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  const toggle = (s: string) => setSymbols((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Cell label="Name" help={E.watchlists.name}>
          <input aria-label="Watchlist name" className="input py-1.5 text-sm w-64" value={name} placeholder="e.g. Swing candidates" onChange={(e) => setName(e.target.value)} />
        </Cell>
        <Cell label="Add a whole list" help={E.watchlists.addPreset}>
          <select aria-label="Add a whole list" className="input py-1 text-xs" value="" disabled={addPreset.isPending} onChange={(e) => e.target.value && addPreset.mutate(e.target.value as EqPreset)}>
            <option value="">Choose…</option>
            {(presets.data ?? [])
              .filter((p) => p.preset !== 'ALL')
              .map((p) => (
                <option key={p.preset} value={p.preset}>
                  {p.label} ({p.count})
                </option>
              ))}
          </select>
        </Cell>
        <Cell label="Search" help={E.picker.search}>
          <input aria-label="Search stocks to add" className="input py-1 text-xs w-56" placeholder="RELIANCE, Tata, bank…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Cell>
        <span className="mb-1 text-[11px] text-slate-500">
          <span className="font-semibold text-slate-300">{symbols.length}</span> stocks
        </span>
      </div>
      {search.trim() && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-ink-700/60 divide-y divide-ink-700/40">
          {results.data?.stocks.map((s) => (
            <label key={s.symbol} className={clsx('flex cursor-pointer items-center gap-3 px-3 py-1.5 text-xs hover:bg-ink-800', symbols.includes(s.symbol) && 'bg-accent/5')}>
              <input type="checkbox" checked={symbols.includes(s.symbol)} onChange={() => toggle(s.symbol)} aria-label={`Add ${s.symbol}`} />
              <span className="w-28 font-medium text-slate-200">{s.symbol}</span>
              <span className="truncate text-slate-400">{s.name}</span>
              {s.sector && <span className="ml-auto text-[11px] text-slate-500">{s.sector}</span>}
            </label>
          ))}
          {results.data?.stocks.length === 0 && <p className="p-3 text-xs text-slate-500">No NSE stock matches “{search}”.</p>}
        </div>
      )}
      {symbols.length > 0 && (
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {symbols.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-slate-200">
              {s}
              <Tooltip content={{ ...E.watchlists.removeStock, body: `Take ${s} off the list.` }}>
                <button type="button" aria-label={`Remove ${s}`} className="text-slate-400 hover:text-bear" onClick={() => toggle(s)}>
                  <X className="w-3 h-3" />
                </button>
              </Tooltip>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Tooltip content={E.watchlists.save}>
          <button type="button" className="btn-primary py-1.5 text-sm" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <InlineSpinner /> : <Save className="w-4 h-4" />} Save
          </button>
        </Tooltip>
        <Tooltip content={{ title: 'Close', body: 'Back to the list without saving.' }}>
          <button type="button" className="btn-ghost py-1.5 text-sm" onClick={onDone}>
            Close
          </button>
        </Tooltip>
        {list && (
          <Tooltip content={confirm ? { ...E.watchlists.remove, title: 'Click again to delete' } : E.watchlists.remove} className="ml-auto">
            <button type="button" className={clsx('btn-ghost py-1.5 text-sm', confirm && 'bg-bear/15 text-bear')} onClick={() => (confirm ? remove.mutate() : setConfirm(true))}>
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </Tooltip>
        )}
      </div>
      {(save.error || remove.error || addPreset.error) && <p className="text-xs text-bear">{((save.error ?? remove.error ?? addPreset.error) as Error).message}</p>}
    </div>
  );
}

export function WatchlistsTab() {
  const lists = useQuery({ queryKey: ['eq-watchlists'], queryFn: eqApi.watchlists });
  const [editing, setEditing] = useState<EqWatchlist | 'new' | null>(null);
  if (editing) return <Editor key={editing === 'new' ? 'new' : editing.id} list={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Watchlists</h2>
        <Tooltip content={E.watchlists.new} className="ml-auto">
          <button type="button" className="btn-primary py-1.5 text-sm" onClick={() => setEditing('new')}>
            <Plus className="w-4 h-4" /> New watchlist
          </button>
        </Tooltip>
      </div>
      {lists.isLoading && <SkeletonRows rows={3} />}
      {lists.error && <p className="text-xs text-bear">{(lists.error as Error).message}</p>}
      {lists.data?.length === 0 && <EmptyState title="No watchlists yet" hint="Make one to backtest and screen your own stock lists." />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {lists.data?.map((w) => (
          <div key={w.id} className="card flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <button type="button" className="text-left text-sm font-semibold text-slate-100 hover:text-accent-soft" onClick={() => setEditing(w)}>
                {w.name}
              </button>
              <span className="text-[11px] text-slate-500">
                {w.symbols.length} stocks · {ago(w.updatedAt)}
              </span>
              <IconButton help={{ title: 'Edit', body: 'Rename, add or remove stocks.' }} onClick={() => setEditing(w)} className="ml-auto p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800">
                <ListPlus className="w-3.5 h-3.5" />
              </IconButton>
            </div>
            <p className="line-clamp-2 text-xs text-slate-400">{w.symbols.slice(0, 30).join(', ')}{w.symbols.length > 30 ? ` +${w.symbols.length - 30} more` : ''}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
