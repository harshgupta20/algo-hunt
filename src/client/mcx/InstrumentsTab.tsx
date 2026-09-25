'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { MCX2_GROUP_LABEL } from '@/shared/mcx';
import { Tooltip } from '../components/Tooltip';
import { Card, EmptyState, Spinner } from '../components/ui';
import { mcxApi } from './api';
import { InstrumentTag } from './components';
import { H } from './help';

export function InstrumentsTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState({ underlying: '', type: '', search: '' });
  const products = useQuery({ queryKey: ['mcx2-products'], queryFn: mcxApi.products });
  const list = useQuery({
    queryKey: ['mcx2-instruments', filter],
    queryFn: () => mcxApi.instruments({ ...filter, limit: 300 }),
    enabled: Boolean(filter.underlying || filter.search),
  });
  const sync = useMutation({
    mutationFn: mcxApi.syncInstruments,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcx2-products'] });
      qc.invalidateQueries({ queryKey: ['mcx2-instruments'] });
      qc.invalidateQueries({ queryKey: ['mcx2-status'] });
    },
  });
  const groups = [...new Set((products.data ?? []).map((p) => p.group))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip content={H.instruments.sync}>
          <button type="button" className="btn-ghost" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync from Kite
          </button>
        </Tooltip>
        {sync.data && <span className="text-xs text-bull">Synced {sync.data.count.toLocaleString('en-IN')} contracts</span>}
        {sync.error && <span className="text-xs text-bear">{(sync.error as Error).message}</span>}
      </div>

      <Card className="p-0 overflow-hidden">
        {products.isLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-ink-850">
                <tr>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5">Futures</th>
                  <th className="px-4 py-2.5">Option expiries (strikes)</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g} className="divide-y divide-ink-700/50">
                  <tr>
                    <td colSpan={3} className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      {MCX2_GROUP_LABEL[g]}
                    </td>
                  </tr>
                  {products.data!
                    .filter((p) => p.group === g)
                    .map((p) => (
                      <tr key={p.symbol} className="hover:bg-ink-850/60 cursor-pointer" onClick={() => setFilter({ ...filter, underlying: p.symbol })}>
                        <td className="px-4 py-2">
                          <div className="text-fg font-medium">{p.symbol}</div>
                          <div className="text-xs text-slate-500">{p.name}</div>
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {p.futures.length ? (
                            p.futures.map((f) => (
                              <span key={f.id} className="mr-3 whitespace-nowrap">
                                <span className="text-leg-fut font-semibold">FUT</span> <span className="text-slate-300">{f.expiry}</span>
                              </span>
                            ))
                          ) : (
                            <span className="text-warn">not synced</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-400">
                          {p.optionExpiries.length ? p.optionExpiries.map((e) => `${e.expiry} (${e.strikes})`).join(' · ') : p.futures.length ? 'futures only' : '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={H.editor.product}>
          <select aria-label="Product" className="input py-1.5 text-xs" value={filter.underlying} onChange={(e) => setFilter({ ...filter, underlying: e.target.value })}>
            <option value="">All products</option>
            {products.data?.map((p) => (
              <option key={p.symbol} value={p.symbol}>
                {p.symbol}
              </option>
            ))}
          </select>
        </Tooltip>
        <Tooltip content={H.instruments.type}>
          <select aria-label="Contract type" className="input py-1.5 text-xs" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
            <option value="">All types</option>
            <option value="MCX_FUTURE">Futures</option>
            <option value="CE">Calls (CE)</option>
            <option value="PE">Puts (PE)</option>
          </select>
        </Tooltip>
        <Tooltip content={H.instruments.search}>
          <input aria-label="Search symbol" className="input py-1.5 text-xs w-56" placeholder="Search symbol…" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
        </Tooltip>
      </div>
      {(filter.underlying || filter.search) && (
        <Card className="p-0 overflow-hidden">
          {list.isLoading ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : list.data?.items.length ? (
            <div className="overflow-x-auto max-h-[28rem]">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500 bg-ink-850 sticky top-0">
                  <tr>
                    <th className="px-4 py-2">Contract</th>
                    <th className="px-4 py-2">Symbol</th>
                    <th className="px-4 py-2">Expiry</th>
                    <th className="px-4 py-2 text-right">Strike</th>
                    <th className="px-4 py-2 text-right">Lot</th>
                    <th className="px-4 py-2 text-right">Tick</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700/40">
                  {list.data.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-1.5">
                        <InstrumentTag i={i} />
                      </td>
                      <td className="px-4 py-1.5 font-mono text-slate-400">{i.symbol}</td>
                      <td className="px-4 py-1.5">{i.expiry}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{i.strike ?? '—'}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{i.lotSize}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{i.tickSize}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.data.total > list.data.items.length && <p className="px-4 py-2 text-[11px] text-slate-500">Showing {list.data.items.length} of {list.data.total} — narrow the filter.</p>}
            </div>
          ) : (
            <EmptyState title="No contracts match" />
          )}
        </Card>
      )}
    </div>
  );
}
