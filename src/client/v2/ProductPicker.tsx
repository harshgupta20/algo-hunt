'use client';

/**
 * Search-and-pick products (indices, stocks, commodities). With a strategy,
 * products lacking a leg it needs are marked and can't be picked.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { X } from 'lucide-react';
import type { ProductKind, StrategyDefinition, V2Product } from '@/shared/v2';
import { PRODUCT_KIND_LABEL, incompatibility } from '@/shared/v2';
import { Tooltip } from '../components/Tooltip';
import { Spinner } from '../components/ui';
import { v2Api } from './api';
import { ProductLegs, Segmented } from './components';
import { H } from './help';

export function ProductPicker({
  selected,
  onChange,
  multiple = true,
  definition,
  max = 50,
  compact = false,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  definition?: StrategyDefinition;
  max?: number;
  /** Narrow containers: symbol + legs only (name and type in the tooltip). */
  compact?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'' | ProductKind>('');
  const list = useQuery({ queryKey: ['v2-products', search, kind], queryFn: () => v2Api.products({ search: search || undefined, kind: kind || undefined, limit: 150 }), staleTime: 60_000 });
  const chosen = useQuery({ queryKey: ['v2-products-ids', selected], queryFn: () => v2Api.products({ ids: selected }), enabled: selected.length > 0, staleTime: 60_000 });
  const toggle = (p: V2Product) => {
    if (selected.includes(p.id)) onChange(selected.filter((x) => x !== p.id));
    else if (!multiple) onChange([p.id]);
    else if (selected.length < max) onChange([...selected, p.id]);
  };

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const p = chosen.data?.find((x) => x.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-slate-200">
                {p?.symbol ?? id}
                <Tooltip content={{ title: 'Remove', body: `Remove ${p?.symbol ?? id} from the selection.` }}>
                  <button type="button" aria-label={`Remove ${id}`} onClick={() => onChange(selected.filter((x) => x !== id))} className="text-slate-400 hover:text-bear">
                    <X className="w-3 h-3" />
                  </button>
                </Tooltip>
              </span>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={H.products.search}>
          <input aria-label="Search products" className={clsx('input py-1 text-xs', compact ? 'w-full' : 'w-56')} placeholder="Search NIFTY, RELIANCE, GOLD…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Tooltip>
        <Segmented
          label="Product type"
          value={kind}
          onChange={setKind}
          options={[
            { value: '' as const, label: 'All', help: { title: 'All products', body: 'Indices, stocks and commodities.' } },
            { value: 'INDEX' as const, label: 'Indices', help: { title: 'Indices', body: 'NIFTY, BANKNIFTY, FINNIFTY, SENSEX…' } },
            { value: 'STOCK' as const, label: 'Stocks', help: { title: 'Stocks', body: 'NSE cash stocks; F&O stocks also have futures and options.' } },
            { value: 'COMMODITY' as const, label: 'Commodities', help: { title: 'Commodities', body: 'MCX: gold, silver, crude oil, natural gas, base metals.' } },
          ]}
        />
        {multiple && <span className="text-[11px] text-slate-500">{selected.length} selected</span>}
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-700/60 divide-y divide-ink-700/40">
        {list.isLoading && (
          <div className="p-3">
            <Spinner />
          </div>
        )}
        {list.data?.length === 0 && <p className="p-3 text-xs text-slate-500">No products match{search ? ` “${search}”` : ''}. Sync products from the Products tab if the list is empty.</p>}
        {list.data?.map((p) => {
          const problems = definition ? incompatibility(definition, p) : [];
          const on = selected.includes(p.id);
          const disabled = problems.length > 0 && !on;
          return (
            <Tooltip key={p.id} content={{ title: `${p.symbol} — ${p.name}`, body: `${PRODUCT_KIND_LABEL[p.kind]} · ${p.market} session${p.lotSize ? ` · lot ${p.lotSize}` : ''}`, note: problems.join(' · ') || undefined }} className="flex">
              <label className={clsx('flex flex-1 items-center gap-3 px-3 py-1.5 text-xs', disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-ink-850')}>
                <input type={multiple ? 'checkbox' : 'radio'} checked={on} disabled={disabled} onChange={() => toggle(p)} />
                <span className={clsx('font-medium text-slate-200', compact ? 'flex-1' : 'w-28')}>{p.symbol}</span>
                {!compact && <span className="flex-1 truncate text-slate-400">{p.name}</span>}
                {!compact && <span className="text-[10px] text-slate-500 w-20">{PRODUCT_KIND_LABEL[p.kind]}</span>}
                <ProductLegs product={p} />
                {problems.length > 0 && <span className="text-[10px] text-warn">can’t run</span>}
              </label>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
