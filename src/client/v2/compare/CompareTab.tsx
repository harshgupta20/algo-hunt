'use client';

/**
 * Compare: run one strategy over past candles on many products and rank them by
 * how often it would have alerted (alerts only — no trade scoring).
 */
import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, ChevronDown, ChevronRight, Link2, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { CompareResult, ConnectionConfig } from '@/shared/v2';
import { EXPIRY_MODES, legName } from '@/shared/v2';
import { InfoTip, Tooltip } from '../../components/Tooltip';
import { Card, EmptyState, Spinner } from '../../components/ui';
import { V2ApiError, v2Api } from '../api';
import { Cell, InstrumentChip, LegBadge, LegPrices, Section, Segmented, TraceView, UnitTag } from '../components';
import { DEFAULT_CONFIG } from '../connections/ConnectionsTab';
import { candleRange, daysAgo, istToday } from '../format';
import { H } from '../help';
import { ProductPicker } from '../ProductPicker';

export function CompareTab({ initialStrategyId }: { initialStrategyId?: string }) {
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ['v2-strategies'], queryFn: v2Api.strategies });
  const [strategyId, setStrategyId] = useState(initialStrategyId ?? '');
  const [products, setProducts] = useState<string[]>([]);
  const [range, setRange] = useState({ from: daysAgo(4), to: istToday() });
  const [expiry, setExpiry] = useState<ConnectionConfig['expiry']>({ mode: 'CURRENT' });
  const [shift, setShift] = useState(0);
  const [trigger, setTrigger] = useState<'ON_TRANSITION' | 'WHILE_TRUE'>('ON_TRANSITION');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [connected, setConnected] = useState<Record<string, string>>({});
  useEffect(() => {
    if (initialStrategyId) setStrategyId(initialStrategyId);
  }, [initialStrategyId]);
  const strategy = strategies.data?.find((s) => s.id === strategyId);
  const hasOptions = strategy?.definition.legs.some((l) => l.kind === 'CE' || l.kind === 'PE');

  const run = useMutation({
    mutationFn: () => v2Api.compare({ strategyId, products, from: range.from, to: range.to, expiry, strikeShift: shift, trigger }),
    onSuccess: (r) => {
      setResult(r);
      setOpen(null);
    },
  });
  const connect = useMutation({
    mutationFn: (productId: string) => v2Api.createConnections(strategyId, [productId], { ...DEFAULT_CONFIG, expiry, strikeShifts: [shift] }),
    onSuccess: (_r, productId) => {
      setConnected((c) => ({ ...c, [productId]: 'Connected (switched off) — switch it on in Connections' }));
      qc.invalidateQueries({ queryKey: ['v2-connections'] });
      qc.invalidateQueries({ queryKey: ['v2-strategies'] });
    },
    onError: (e, productId) => setConnected((c) => ({ ...c, [productId]: e instanceof V2ApiError ? (e.issues?.[0]?.message ?? e.message) : String(e) })),
  });

  return (
    <div className="flex flex-col gap-4">
      <Section title="Compare a strategy across products" help={H.compare.run}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip content={H.connection.strategy}>
              <select aria-label="Strategy" className="input py-1.5 text-sm min-w-[16rem]" value={strategyId} onChange={(e) => (setStrategyId(e.target.value), setResult(null), setProducts([]))}>
                <option value="">Choose a strategy…</option>
                {strategies.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Tooltip>
            {strategy?.definition.legs.map((l) => (
              <LegBadge key={l.id} leg={l} />
            ))}
          </div>
          {strategy && (
            <>
              <ProductPicker selected={products} onChange={setProducts} definition={strategy.definition} max={20} />
              <div className="flex flex-wrap items-end gap-5">
                <Cell label="Period" help={H.compare.range}>
                  <input type="date" aria-label="From" className="input py-1 text-xs" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
                  <span className="text-xs text-slate-500">to</span>
                  <input type="date" aria-label="To" className="input py-1 text-xs" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
                </Cell>
                <Cell label={hasOptions ? 'Option expiry' : 'Futures expiry'} help={H.connection.expiry}>
                  <select aria-label="Expiry" className="input py-1 text-xs" value={expiry.mode} onChange={(e) => setExpiry({ mode: e.target.value as 'CURRENT' })}>
                    {EXPIRY_MODES.filter((m) => m.mode !== 'SPECIFIC').map((m) => (
                      <option key={m.mode} value={m.mode}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Cell>
                {hasOptions && (
                  <Cell label="Strike position" help={H.compare.strikeShift}>
                    <select aria-label="Strike position" className="input py-1 text-xs" value={shift} onChange={(e) => setShift(Number(e.target.value))}>
                      {[-3, -2, -1, 0, 1, 2, 3].map((s) => (
                        <option key={s} value={s}>
                          {s === 0 ? 'Around ATM' : `${s > 0 ? '+' : ''}${s} strike${Math.abs(s) === 1 ? '' : 's'}`}
                        </option>
                      ))}
                    </select>
                  </Cell>
                )}
                <Cell label="Alert when" help={H.connection.trigger}>
                  <Segmented
                    label="Alert trigger"
                    value={trigger}
                    onChange={setTrigger}
                    options={[
                      { value: 'ON_TRANSITION', label: 'Becomes true', help: { title: 'Becomes true', body: 'Count the first candle it turns true after being false.' } },
                      { value: 'WHILE_TRUE', label: 'While true', help: { title: 'While true', body: 'Count every candle it is true.' } },
                    ]}
                  />
                </Cell>
                <Tooltip content={H.compare.run}>
                  <button type="button" className="btn-primary" disabled={!products.length || run.isPending} onClick={() => run.mutate()}>
                    {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />} Compare {products.length || ''} product{products.length === 1 ? '' : 's'}
                  </button>
                </Tooltip>
              </div>
              {run.isPending && <p className="text-xs text-slate-500">Fetching candles for every product (Kite allows ~3 requests per second) — this can take a little while.</p>}
              {run.error && <p className="text-xs text-bear">{(run.error as Error).message}</p>}
            </>
          )}
          {!strategies.data?.length && !strategies.isLoading && <EmptyState title="No strategies yet" hint="Create a strategy first." />}
        </div>
      </Section>

      {result && strategy && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-700/60 text-xs text-slate-400">
            {result.from} → {result.to} · {result.requests} data request(s) · {result.notes.join(' ')}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500 bg-ink-850">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">
                    <span className="inline-flex items-center gap-1">
                      Alerts <InfoTip content={H.compare.alerts} />
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <span className="inline-flex items-center gap-1">
                      Coverage <InfoTip content={H.compare.coverage} />
                    </span>
                  </th>
                  <th className="px-3 py-2">Contracts</th>
                  <th className="px-3 py-2">Notes</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {result.products.map((p, idx) => {
                  const isOpen = open === p.productId;
                  const coverage = p.candles ? Math.round((p.decided / p.candles) * 100) : 0;
                  return (
                    <Fragment key={p.productId}>
                      <tr className={clsx(p.alerts.length && 'cursor-pointer hover:bg-ink-850/60')} onClick={() => p.alerts.length && setOpen(isOpen ? null : p.productId)}>
                        <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {p.alerts.length ? isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" /> : <span className="w-3.5" />}
                            <span className="font-medium text-slate-200">{p.productId.split(':')[1]}</span>
                            <span className="text-slate-500">{p.productName}</span>
                          </div>
                        </td>
                        <td className={clsx('px-3 py-2 text-right tabular-nums font-semibold', p.alerts.length ? 'text-bull' : 'text-slate-500')}>{p.alerts.length}</td>
                        <td className={clsx('px-3 py-2 text-right tabular-nums', coverage < 60 ? 'text-warn' : 'text-slate-300')}>
                          {p.decided}/{p.candles} ({coverage}%)
                        </td>
                        <td className="px-3 py-2">
                          {p.unit ? (
                            <div className="flex flex-col gap-0.5">
                              <UnitTag unit={p.unit} symbol={p.productId.split(':')[1]!} />
                              <span className="flex flex-wrap gap-x-3">
                                {strategy.definition.legs.map((l) => {
                                  const i = p.unit!.legs[l.id];
                                  return (
                                    <Tooltip key={l.id} content={{ title: legName(l), body: i?.symbol ?? 'not listed' }}>
                                      <span>{i ? <InstrumentChip i={i} /> : <span className="text-warn">—</span>}</span>
                                    </Tooltip>
                                  );
                                })}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px] max-w-md">
                          {p.errors.map((e) => (
                            <div key={e} className="text-warn">
                              {e}
                            </div>
                          ))}
                          {p.notes.map((n) => (
                            <div key={n} className="text-slate-500">
                              {n}
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {connected[p.productId] ? (
                            <span className="text-[11px] text-slate-400">{connected[p.productId]}</span>
                          ) : (
                            <Tooltip content={H.compare.connect}>
                              <button type="button" className="btn-ghost py-1 text-xs" disabled={connect.isPending || !p.unit} onClick={() => connect.mutate(p.productId)}>
                                <Link2 className="w-3.5 h-3.5" /> Connect
                              </button>
                            </Tooltip>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} className="px-6 py-3 bg-ink-850/50">
                            {p.alerts.map((a) => (
                              <div key={a.candleTime} className="py-2 border-b border-ink-700/40 last:border-0">
                                <div className="flex flex-wrap items-center gap-3 mb-1">
                                  <span className="text-xs font-medium text-slate-200">{candleRange(a.candleTime, result.triggerTimeframe)}</span>
                                  <LegPrices prices={a.prices} legs={strategy.definition.legs} />
                                </div>
                                <TraceView trace={a.trace} />
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {strategies.isLoading && <Spinner />}
    </div>
  );
}
