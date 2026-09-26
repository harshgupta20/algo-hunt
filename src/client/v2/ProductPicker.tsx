'use client';

/**
 * Search-and-pick products (indices, stocks, commodities). With a strategy,
 * only products offering every leg it needs are listed.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { X } from 'lucide-react';
import type { ProductKind, StrategyDefinition, V2Product } from '@/shared/v2';
import { MAX_CONNECT, PRODUCT_KIND_LABEL, incompatibility, requiredKinds } from '@/shared/v2';
import { Tooltip } from '../components/Tooltip';
import { Spinner } from '../components/ui';
import { v2Api } from './api';
import { ProductLegs, Segmented } from './components';
import { H } from './help';

/** Rows listed at once (the rest via search / filters). */
const LIST_LIMIT = 500;
/** Chips shown before "+N more". */
const CHIPS_SHOWN = 24;

const symbolOf = (id: string) => id.slice(id.indexOf(':') + 1);

export function ProductPicker({
  selected,
  onChange,
  multiple = true,
  definition,
  max = MAX_CONNECT,
  compact = false,
  connected = [],
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  definition?: StrategyDefinition;
  max?: number;
  /** Narrow containers: symbol + legs only (name and type in the tooltip). */
  compact?: boolean;
  /** Products already connected to this strategy — marked and skipped. */
  connected?: string[];
}) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'' | ProductKind>('');
  const [allChips, setAllChips] = useState(false);
  const needs = definition ? requiredKinds(definition) : undefined;
  const needsKey = needs?.join(',') ?? '';
  const list = useQuery({
    queryKey: ['v2-products', search, kind, needsKey, 'picker'],
    queryFn: () => v2Api.products({ search: search || undefined, kind: kind || undefined, needs, limit: LIST_LIMIT }),
    staleTime: 60_000,
  });
  const counts = useQuery({ queryKey: ['v2-products', 'counts', search, needsKey], queryFn: () => v2Api.productCounts({ search: search || undefined, needs }), staleTime: 60_000 });
  const c = counts.data;
  const n = (v: number | undefined) => (v === undefined ? '' : ` (${v.toLocaleString('en-IN')})`);
  const matching = c ? (kind ? c[kind] : c.total) : undefined;
  const [limitNote, setLimitNote] = useState<string | null>(null);
  const allRef = useRef<HTMLInputElement>(null);
  // Products shown right now that can still be picked (what "Select all" acts on).
  const selectable = (list.data ?? []).filter((p) => !connected.includes(p.id) && (!definition || incompatibility(definition, p).length === 0));
  const shownOn = selectable.filter((p) => selected.includes(p.id)).length;
  const full = selected.length >= max;
  // Ticked when every shown product is in — or when the limit stopped it adding more.
  const allOn = selectable.length > 0 && (shownOn === selectable.length || (full && shownOn > 0));
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = shownOn > 0 && !allOn;
  }, [shownOn, allOn]);
  useEffect(() => setLimitNote(null), [search, kind]);
  const toggleAll = () => {
    if (allOn) {
      const ids = new Set(selectable.map((p) => p.id));
      setLimitNote(null);
      onChange(selected.filter((id) => !ids.has(id)));
      return;
    }
    const missing = selectable.map((p) => p.id).filter((id) => !selected.includes(id));
    const room = Math.max(0, max - selected.length);
    setLimitNote(missing.length > room ? `Added ${room} — at most ${max} products can be selected here.` : null);
    onChange([...selected, ...missing.slice(0, room)]);
  };
  const toggle = (p: V2Product) => {
    if (selected.includes(p.id)) onChange(selected.filter((x) => x !== p.id));
    else if (!multiple) onChange([p.id]);
    else if (selected.length < max) onChange([...selected, p.id]);
    else setLimitNote(`At most ${max} products can be selected here.`);
  };
  const chips = allChips ? selected : selected.slice(0, CHIPS_SHOWN);
  const linkedShown = (list.data ?? []).filter((p) => connected.includes(p.id)).length;
  const legsText = needs?.filter((k) => k !== 'PE' || !needs.includes('CE')).map((k) => (k === 'CE' || k === 'PE' ? 'options' : k === 'FUT' ? 'futures' : 'spot')).join(' + ');

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-slate-200">
              {symbolOf(id)}
              <Tooltip content={{ title: 'Remove', body: `Remove ${symbolOf(id)} from the selection.` }}>
                <button type="button" aria-label={`Remove ${id}`} onClick={() => onChange(selected.filter((x) => x !== id))} className="text-slate-400 hover:text-bear">
                  <X className="w-3 h-3" />
                </button>
              </Tooltip>
            </span>
          ))}
          {selected.length > CHIPS_SHOWN && (
            <Tooltip content={{ title: allChips ? 'Show fewer' : 'Show all selected', body: allChips ? `Collapse the list back to the first ${CHIPS_SHOWN}.` : `List all ${selected.length} selected products.` }}>
              <button type="button" className="text-xs text-accent hover:underline px-1" onClick={() => setAllChips(!allChips)}>
                {allChips ? 'Show fewer' : `+${selected.length - CHIPS_SHOWN} more`}
              </button>
            </Tooltip>
          )}
          {multiple && selected.length > 1 && (
            <Tooltip content={{ title: 'Clear all', body: `Remove all ${selected.length} selected products.` }}>
              <button type="button" className="text-xs text-slate-400 hover:text-bear px-1" onClick={() => (onChange([]), setLimitNote(null))}>
                Clear all
              </button>
            </Tooltip>
          )}
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
            { value: '' as const, label: `All${n(c?.total)}`, help: { title: 'All products', body: 'Indices, stocks and commodities.', note: legsText ? `Counts only products with ${legsText} — what this strategy needs.` : undefined } },
            { value: 'INDEX' as const, label: `Indices${n(c?.INDEX)}`, help: { title: 'Indices', body: 'NIFTY, BANKNIFTY, FINNIFTY, SENSEX…' } },
            { value: 'STOCK' as const, label: `Stocks${n(c?.STOCK)}`, help: { title: 'Stocks', body: 'NSE cash stocks; F&O stocks also have futures and options.' } },
            { value: 'COMMODITY' as const, label: `Commodities${n(c?.COMMODITY)}`, help: { title: 'Commodities', body: 'MCX: gold, silver, crude oil, natural gas, base metals.' } },
          ]}
        />
        {multiple && (
          <Tooltip content={{ title: 'Selected', body: 'Products ticked so far, across every search and filter.', note: `At most ${max} at once.` }}>
            <span className="text-[11px] text-slate-500">
              <span className="font-semibold text-slate-300">{selected.length}</span> selected
            </span>
          </Tooltip>
        )}
      </div>
      {matching !== undefined && list.data && (
        <Tooltip
          content={{
            title: 'Products listed',
            body: legsText ? `Only products with ${legsText} are listed — the legs this strategy uses. Cash-only stocks can’t run it.` : 'Every product matching the search and type.',
            note: `Up to ${LIST_LIMIT} are listed at once; search to find the rest.`,
          }}
        >
          <p className="text-[11px] text-slate-500">
            {list.data.length < matching ? (
              <>
                Showing <span className="font-semibold text-slate-300">{list.data.length.toLocaleString('en-IN')}</span> of{' '}
                <span className="font-semibold text-slate-300">{matching.toLocaleString('en-IN')}</span> — search to narrow the list
              </>
            ) : (
              <>
                <span className="font-semibold text-slate-300">{matching.toLocaleString('en-IN')}</span> product{matching === 1 ? '' : 's'}
                {search ? ` matching “${search}”` : ''}
              </>
            )}
            {legsText && ` with ${legsText}`}
            {linkedShown > 0 && ` · ${linkedShown} already connected`}
          </p>
        </Tooltip>
      )}
      {multiple && selectable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip
            content={{
              title: allOn ? 'Clear the listed products' : 'Select all listed products',
              body: allOn
                ? `Unticks the ${shownOn} listed product${shownOn === 1 ? '' : 's'} that are selected. Products picked under other searches or filters stay selected.`
                : `Ticks every product in the list below (${selectable.length}) — use the search or the Indices / Stocks / Commodities filter first to choose which.${connected.length ? ' Products already connected are skipped.' : ''}`,
              note: `At most ${max} products can be selected here.`,
            }}
          >
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
              <input ref={allRef} type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all listed products" />
              Select all listed ({selectable.length.toLocaleString('en-IN')})
            </label>
          </Tooltip>
          {limitNote && <span className="text-[11px] text-warn">{limitNote}</span>}
        </div>
      )}
      <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-700/60 divide-y divide-ink-700/40">
        {list.isLoading && (
          <div className="p-3">
            <Spinner />
          </div>
        )}
        {list.data?.length === 0 && (
          <p className="p-3 text-xs text-slate-500">
            No products{legsText ? ` with ${legsText}` : ''} match{search ? ` “${search}”` : ''}. Sync products from the Products tab if the list is empty.
          </p>
        )}
        {list.data?.map((p) => {
          const problems = definition ? incompatibility(definition, p) : [];
          const linked = connected.includes(p.id);
          const on = selected.includes(p.id);
          const disabled = (problems.length > 0 || linked) && !on;
          return (
            <Tooltip
              key={p.id}
              content={{ title: `${p.symbol} — ${p.name}`, body: `${PRODUCT_KIND_LABEL[p.kind]} · ${p.market} session${p.lotSize ? ` · lot ${p.lotSize}` : ''}`, note: linked ? 'Already connected to this strategy.' : problems.join(' · ') || undefined }}
              className="flex"
            >
              <label className={clsx('flex flex-1 items-center gap-3 px-3 py-1.5 text-xs', disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-ink-850')}>
                <input type={multiple ? 'checkbox' : 'radio'} checked={on} disabled={disabled} onChange={() => toggle(p)} />
                <span className={clsx('font-medium text-slate-200', compact ? 'flex-1' : 'w-28')}>{p.symbol}</span>
                {!compact && <span className="flex-1 truncate text-slate-400">{p.name}</span>}
                {!compact && <span className="text-[10px] text-slate-500 w-20">{PRODUCT_KIND_LABEL[p.kind]}</span>}
                <ProductLegs product={p} />
                {linked && <span className="text-[10px] text-slate-400">connected</span>}
                {problems.length > 0 && <span className="text-[10px] text-warn">can’t run</span>}
              </label>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
