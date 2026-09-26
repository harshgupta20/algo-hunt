'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import type { ProductKind } from '@/shared/v2';
import { PRODUCT_KIND_LABEL } from '@/shared/v2';
import { Tooltip } from '../components/Tooltip';
import { Card, EmptyState, Spinner } from '../components/ui';
import { v2Api } from './api';
import { ProductLegs, Segmented } from './components';
import { shortDate } from './format';
import { H } from './help';

export function ProductsTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'' | ProductKind>('');
  const list = useQuery({ queryKey: ['v2-products', search, kind, 'tab'], queryFn: () => v2Api.products({ search: search || undefined, kind: kind || undefined, limit: 300 }) });
  const sync = useMutation({
    mutationFn: v2Api.syncProducts,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['v2-products'] });
      qc.invalidateQueries({ queryKey: ['v2-status'] });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip content={H.products.sync}>
          <button type="button" className="btn-ghost" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync from Kite
          </button>
        </Tooltip>
        {sync.data && (
          <span className="text-xs text-bull">
            Synced {sync.data.products.toLocaleString('en-IN')} products ({sync.data.instruments.toLocaleString('en-IN')} contracts)
          </span>
        )}
        {sync.error && <span className="text-xs text-bear">{(sync.error as Error).message}</span>}
        <Tooltip content={H.products.search}>
          <input aria-label="Search products" className="input py-1.5 text-xs w-56 ml-auto" placeholder="Search NIFTY, RELIANCE, GOLD…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Tooltip>
        <Segmented
          label="Product type"
          value={kind}
          onChange={setKind}
          options={[
            { value: '' as const, label: 'All', help: { title: 'All', body: 'Every product.' } },
            { value: 'INDEX' as const, label: 'Indices', help: { title: 'Indices', body: 'NSE / BSE indices.' } },
            { value: 'STOCK' as const, label: 'Stocks', help: { title: 'Stocks', body: 'NSE stocks (cash, and F&O where listed).' } },
            { value: 'COMMODITY' as const, label: 'Commodities', help: { title: 'Commodities', body: 'MCX commodities.' } },
          ]}
        />
      </div>
      <Card className="p-0 overflow-hidden">
        {list.isLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : list.data?.length ? (
          <div className="overflow-x-auto max-h-[36rem]">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500 bg-ink-850 sticky top-0">
                <tr>
                  <th className="px-4 py-2">Product</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Session</th>
                  <th className="px-4 py-2">Legs</th>
                  <th className="px-4 py-2">Futures</th>
                  <th className="px-4 py-2">Option expiries</th>
                  <th className="px-4 py-2 text-right">Strike gap</th>
                  <th className="px-4 py-2 text-right">Lot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/40">
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-1.5">
                      <div className="font-medium text-slate-200">{p.symbol}</div>
                      <div className="text-[11px] text-slate-500">{p.name}</div>
                    </td>
                    <td className="px-4 py-1.5 text-slate-400">{PRODUCT_KIND_LABEL[p.kind]}</td>
                    <td className="px-4 py-1.5 text-slate-400">{p.market === 'MCX' ? 'MCX' : 'NSE'}</td>
                    <td className="px-4 py-1.5">
                      <ProductLegs product={p} />
                    </td>
                    <td className="px-4 py-1.5 text-slate-400">{p.futureExpiries.slice(0, 3).map(shortDate).join(' · ') || '—'}</td>
                    <td className="px-4 py-1.5 text-slate-400">
                      {p.optionExpiries.slice(0, 4).map(shortDate).join(' · ') || '—'}
                      {p.optionExpiries.length > 4 ? ` +${p.optionExpiries.length - 4}` : ''}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{p.strikeStep ?? '—'}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{p.lotSize ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No products" hint="Connect Kite (Settings → Broker Connection) and press “Sync from Kite”." />
        )}
      </Card>
    </div>
  );
}
