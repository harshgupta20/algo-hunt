'use client';

/**
 * Connections: strategy + product(s) → alerts. Create several at once, then
 * switch each on / off, explain it, change its settings or remove it.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Link2, Loader2, Pencil, PlayCircle, Plus, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { ConnectionConfig, StrategyDefinition, V2Strategy } from '@/shared/v2';
import { expiryText, legName, policyText } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { Badge, Card, EmptyState, IconButton, Spinner } from '../../components/ui';
import { V2ApiError, v2Api, type ConnectionRow, type ExplainResult } from '../api';
import { InstrumentChip, LegBadge, ProductLegs, Section, TriBadge, UnitStateBadge, UnitTag } from '../components';
import { ExplainView } from '../ExplainView';
import { fmtNum, istStampIso } from '../format';
import { H } from '../help';
import { ProductPicker } from '../ProductPicker';
import { ConfigEditor } from './ConfigEditor';

export const DEFAULT_CONFIG: ConnectionConfig = {
  expiry: { mode: 'CURRENT' },
  strikeShifts: [0],
  alert: { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION', cooldownMinutes: 30, oncePerCandle: true },
};

/** The contracts each leg resolves to on one product right now. */
function Preview({ definition, strategyId, productId, config }: { definition: StrategyDefinition; strategyId?: string; productId: string; config: ConnectionConfig }) {
  const q = useQuery({ queryKey: ['v2-preview', strategyId, productId, config], queryFn: () => v2Api.previewConnection({ strategyId, productId, config }), retry: false, staleTime: 30_000 });
  const r = q.data;
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-850 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Tooltip content={H.connection.preview}>
          <span className="text-xs font-semibold text-slate-300">Contracts now · {productId.split(':')[1]}</span>
        </Tooltip>
        <IconButton help={{ title: 'Refresh', body: 'Resolve again with the latest price.' }} onClick={() => q.refetch()} className="ml-auto p-1 rounded-md text-slate-500 hover:text-slate-200">
          <RefreshCw className={q.isFetching ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />
        </IconButton>
      </div>
      {q.isLoading && <Spinner label="Resolving…" />}
      {q.error && <p className="text-xs text-bear">{(q.error as Error).message}</p>}
      {r && (
        <>
          {r.references.map((x) => (
            <p key={x.instrument.id} className="text-[11px] text-slate-500">
              ATM from {x.instrument.symbol} {fmtNum(x.ltp)}
              {r.units[0]?.atmStrike !== undefined && <> → ATM {r.units[0].atmStrike}</>}
            </p>
          ))}
          {r.errors.map((e) => (
            <p key={e} className="text-xs text-warn">
              {e}
            </p>
          ))}
          {r.notes.map((e) => (
            <p key={e} className="text-[11px] text-slate-500">
              {e}
            </p>
          ))}
          {r.units.map((u) => (
            <div key={u.key} className="mt-2">
              <UnitTag unit={u} symbol={r.product.symbol} />
              <div className="mt-1 grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-0.5 text-xs">
                {definition.legs.map((l) => {
                  const i = u.legs[l.id];
                  return (
                    <div key={l.id} className="contents">
                      <LegBadge leg={l} />
                      {i ? <InstrumentChip i={i} /> : <span className="text-warn">not listed</span>}
                      <span className="tabular-nums text-slate-400 text-right">{i ? fmtNum(r.quotes[i.id]?.ltp) : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function NewConnection({ strategies, strategyId, onStrategy, onDone }: { strategies: V2Strategy[]; strategyId: string; onStrategy: (id: string) => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [products, setProducts] = useState<string[]>([]);
  const [config, setConfig] = useState<ConnectionConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<V2ApiError | null>(null);
  const strategy = strategies.find((s) => s.id === strategyId);
  const single = useQuery({ queryKey: ['v2-products-ids', products], queryFn: () => v2Api.products({ ids: products }), enabled: products.length === 1 });
  const hasOptions = strategy?.definition.legs.some((l) => l.kind === 'CE' || l.kind === 'PE');
  const create = useMutation({
    mutationFn: () => v2Api.createConnections(strategyId, products, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['v2-connections'] });
      qc.invalidateQueries({ queryKey: ['v2-strategies'] });
      setProducts([]);
      onDone();
    },
    onError: (e) => setError(e instanceof V2ApiError ? e : new V2ApiError((e as Error).message, 0)),
  });

  return (
    <Section title="New connection" help={H.connection.new}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip content={H.connection.strategy}>
            <select aria-label="Strategy" className="input py-1.5 text-sm min-w-[16rem]" value={strategyId} onChange={(e) => (onStrategy(e.target.value), setProducts([]))}>
              <option value="">Choose a strategy…</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Tooltip>
          {strategy && (
            <span className="flex flex-wrap gap-2">
              {strategy.definition.legs.map((l) => (
                <LegBadge key={l.id} leg={l} />
              ))}
            </span>
          )}
        </div>
        {strategy && (
          <>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mb-1.5">Products</p>
              <ProductPicker selected={products} onChange={(ids) => (setProducts(ids), setError(null))} definition={strategy.definition} />
            </div>
            <ConfigEditor
              value={config}
              onChange={setConfig}
              definition={strategy.definition}
              expiries={products.length === 1 ? (hasOptions ? single.data?.[0]?.optionExpiries : single.data?.[0]?.futureExpiries) : undefined}
            />
            {products[0] && <Preview definition={strategy.definition} strategyId={strategy.id} productId={products[0]} config={config} />}
            {error && (
              <div className="text-xs text-bear">
                {error.message}
                {error.issues?.map((i) => (
                  <div key={i.message}>• {i.message}</div>
                ))}
              </div>
            )}
            <div>
              <Tooltip content={H.connection.create}>
                <button type="button" className="btn-primary" disabled={!products.length || create.isPending} onClick={() => create.mutate()}>
                  {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Connect {products.length || ''} product{products.length === 1 ? '' : 's'}
                </button>
              </Tooltip>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

function ConnectionRowView({ c, definition }: { c: ConnectionRow; definition?: StrategyDefinition }) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<'units' | 'explain' | 'edit' | null>(null);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [config, setConfig] = useState(c.config);
  const [error, setError] = useState<V2ApiError | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['v2-connections'] });
    qc.invalidateQueries({ queryKey: ['v2-strategies'] });
    qc.invalidateQueries({ queryKey: ['v2-status'] });
  };
  const onError = (e: unknown) => setError(e instanceof V2ApiError ? e : new V2ApiError((e as Error).message, 0));
  const toggle = useMutation({ mutationFn: () => (c.enabled ? v2Api.disableConnection(c.id) : v2Api.enableConnection(c.id)), onSuccess: () => (setError(null), refresh()), onError });
  const remove = useMutation({ mutationFn: () => v2Api.deleteConnection(c.id), onSuccess: refresh, onError });
  const save = useMutation({ mutationFn: () => v2Api.updateConnection(c.id, config), onSuccess: () => (setPanel(null), setError(null), refresh()), onError });
  const run = useMutation({ mutationFn: () => v2Api.explainConnection(c.id), onSuccess: (r) => (setExplain(r), setPanel('explain')), onError });
  const units = useQuery({ queryKey: ['v2-units', c.id], queryFn: () => v2Api.units(c.id), enabled: panel === 'units', refetchInterval: 30_000 });
  const p = c.product;
  const btn = 'p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800';
  const hasOptions = definition?.legs.some((l) => l.kind === 'CE' || l.kind === 'PE');

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-44">
          <div className="text-sm font-medium text-fg">{p?.symbol ?? c.productId}</div>
          <div className="text-[11px] text-slate-500 truncate">{p?.name ?? 'not in catalogue'}</div>
        </div>
        {p && <ProductLegs product={p} />}
        <span className="text-[11px] text-slate-400 flex-1 min-w-[14rem]">
          {expiryText(c.config.expiry)}
          {hasOptions && c.config.strikeShifts.length > 1 ? ` · ${c.config.strikeShifts.length} strike positions` : ''} · {policyText(c.config.alert)}
          {c.enabled && c.enabledAt && <> · on since {istStampIso(c.enabledAt)}</>}
        </span>
        <Tooltip content={c.enabled ? H.connection.disable : H.connection.enable}>
          <button type="button" className={clsx('btn py-1 text-xs', c.enabled ? 'btn-ghost' : 'btn-primary')} disabled={toggle.isPending} onClick={() => toggle.mutate()}>
            {toggle.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : c.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
            {c.enabled ? 'Switch off' : 'Switch on'}
          </button>
        </Tooltip>
        <Tooltip content={c.enabled ? H.connection.disable : H.connection.enable}>
          <Badge tone={c.enabled ? 'bull' : 'default'}>{c.enabled ? '● On' : '○ Off'}</Badge>
        </Tooltip>
        <IconButton help={H.connection.explain} onClick={() => run.mutate()} className={btn} disabled={run.isPending}>
          {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
        </IconButton>
        <IconButton help={H.connection.units} onClick={() => setPanel(panel === 'units' ? null : 'units')} className={btn}>
          {panel === 'units' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </IconButton>
        <IconButton help={H.connection.edit} onClick={() => setPanel(panel === 'edit' ? null : 'edit')} className={btn}>
          <Pencil className="w-4 h-4" />
        </IconButton>
        <IconButton
          help={H.connection.remove}
          onClick={() => {
            if (window.confirm(`Disconnect ${p?.symbol ?? c.productId} from “${c.strategyName}”? Its alerts are deleted too.`)) remove.mutate();
          }}
          className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10"
        >
          <Trash2 className="w-4 h-4" />
        </IconButton>
      </div>
      {error && (
        <div className="mt-2 text-xs text-bear">
          {error.message}
          {error.issues?.filter((i) => i.severity === 'error').map((i) => (
            <div key={i.message}>• {i.message}</div>
          ))}
        </div>
      )}
      {panel === 'edit' && definition && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-ink-700/60 bg-ink-850 p-3">
          <ConfigEditor value={config} onChange={setConfig} definition={definition} expiries={hasOptions ? p?.optionExpiries : p?.futureExpiries} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary py-1 text-xs" disabled={save.isPending} onClick={() => save.mutate()}>
              Save settings
            </button>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => (setConfig(c.config), setPanel(null))}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {panel === 'units' && (
        <div className="mt-3">
          {units.isLoading ? (
            <Spinner />
          ) : units.data?.length ? (
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Unit</th>
                  <th className="py-1 pr-3">Result</th>
                  <th className="py-1 pr-3">State</th>
                  <th className="py-1 pr-3">Evaluated</th>
                  <th className="py-1">Last alert</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/40">
                {units.data.map((u) => (
                  <tr key={u.unitKey}>
                    <td className="py-1 pr-3">{u.lastEvaluation ? <UnitTag unit={u.lastEvaluation.unit} symbol={p?.symbol ?? ''} /> : u.unitKey}</td>
                    <td className="py-1 pr-3">
                      <TriBadge value={u.lastResult} />
                    </td>
                    <td className="py-1 pr-3">
                      <UnitStateBadge state={u.state} />
                    </td>
                    <td className="py-1 pr-3 text-slate-400">{u.updatedAt ? istStampIso(u.updatedAt) : '—'}</td>
                    <td className="py-1 text-slate-400">{u.lastAlertAt ? istStampIso(u.lastAlertAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-slate-500">Not evaluated yet — switched-on connections are evaluated when their trigger candle closes during market hours.</p>
          )}
        </div>
      )}
      {panel === 'explain' && explain && definition && (
        <div className="mt-3">
          <ExplainView result={explain} legs={definition.legs} symbol={p?.symbol ?? ''} />
        </div>
      )}
    </div>
  );
}

export function ConnectionsTab({ initialStrategyId }: { initialStrategyId?: string }) {
  const strategies = useQuery({ queryKey: ['v2-strategies'], queryFn: v2Api.strategies });
  const connections = useQuery({ queryKey: ['v2-connections'], queryFn: () => v2Api.connections(), refetchInterval: 60_000 });
  const [strategyId, setStrategyId] = useState(initialStrategyId ?? '');
  const [showNew, setShowNew] = useState(Boolean(initialStrategyId));
  useEffect(() => {
    if (initialStrategyId) {
      setStrategyId(initialStrategyId);
      setShowNew(true);
    }
  }, [initialStrategyId]);

  if (strategies.isLoading || connections.isLoading) return <Spinner />;
  const list = connections.data ?? [];
  const byStrategy = (strategies.data ?? []).map((s) => ({ s, rows: list.filter((c) => c.strategyId === s.id) })).filter((g) => g.rows.length);

  return (
    <div className="flex flex-col gap-4">
      {!showNew && (
        <Tooltip content={H.connection.new}>
          <button type="button" className="btn-primary self-start" onClick={() => setShowNew(true)} disabled={!strategies.data?.length}>
            <Plus className="w-4 h-4" /> New connection
          </button>
        </Tooltip>
      )}
      {!strategies.data?.length && <EmptyState title="No strategies yet" hint="Create a strategy first (Strategies tab), then connect it to products here." />}
      {showNew && !!strategies.data?.length && <NewConnection strategies={strategies.data} strategyId={strategyId} onStrategy={setStrategyId} onDone={() => setShowNew(false)} />}
      {byStrategy.length === 0 && !!strategies.data?.length && <EmptyState title="No connections yet" hint="Connect a strategy to one or more products to start getting alerts." />}
      {byStrategy.map(({ s, rows }) => (
        <Card key={s.id} className="p-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-ink-700/60">
            <h3 className="text-sm font-semibold text-fg">{s.name}</h3>
            <span className="flex flex-wrap gap-2">
              {s.definition.legs.map((l) => (
                <Tooltip key={l.id} content={{ title: legName(l), body: 'A leg of this strategy.' }}>
                  <span>
                    <LegBadge leg={l} />
                  </span>
                </Tooltip>
              ))}
            </span>
            <span className="ml-auto text-[11px] text-slate-500">
              {rows.filter((r) => r.enabled).length}/{rows.length} on
            </span>
          </div>
          <div className="divide-y divide-ink-700/50">
            {rows.map((c) => (
              <ConnectionRowView key={c.id} c={c} definition={s.definition} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
