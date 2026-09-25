'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Play, Power, Trash2, Zap } from 'lucide-react';
import clsx from 'clsx';
import type { AlertConfiguration, AlertConfigurationInput, ExpiryType, McxProductGroup, StrikeSelection, Timeframe } from '@ash/shared';
import {
  BUILTIN_STRATEGY_NAME,
  DEFAULT_RSI_SYNC_PARAMS,
  EXPIRY_TYPES,
  MCX_GROUP_LABEL,
  effectiveExpiryType,
  expiryLabel,
  fixedFields,
  fixedUnderlyings,
  isMcx,
  isSpecific,
  marketOf,
  runsOnSegment,
} from '@ash/shared';
import { api } from '../../lib/api';
import { HELP } from '../../lib/help';
import { Badge, Card, EmptyState, Help, IconButton, Spinner } from '../../components/ui';
import { FieldLabel, InfoTip, Tooltip } from '../../components/Tooltip';
import { CustomStrikeSelect, LockedFields, MarketBadge } from '../../components/market';
import { usesOptionLegs } from './shared';

const GROUPS: McxProductGroup[] = ['bullion', 'energy', 'base-metals'];

const DEFAULT_FORM = {
  products: [] as string[],
  groupName: '',
  expiryType: 'near-month' as ExpiryType,
  strikeSelection: 'ATM' as StrikeSelection,
  customStrike: undefined as number | undefined,
  timeframe: '15m' as Timeframe,
  strategy: 'rsi-sync',
  rsiPeriod: DEFAULT_RSI_SYNC_PARAMS.rsiPeriod,
  futureLevel: DEFAULT_RSI_SYNC_PARAMS.futureLevel,
  callLevel: DEFAULT_RSI_SYNC_PARAMS.callLevel,
  putLevel: DEFAULT_RSI_SYNC_PARAMS.putLevel,
};

/**
 * MCX commodity monitors: the same monitor engine as NSE/BSE, with commodity
 * products, monthly contracts and the MCX session. Picking several products
 * creates one monitor per product as a group.
 */
export function McxMonitors() {
  const qc = useQueryClient();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  const products = useQuery({ queryKey: ['mcx-products'], queryFn: api.mcxProducts });
  const meta = useQuery({ queryKey: ['meta', 'MCX'], queryFn: () => api.meta('MCX') });
  const configs = useQuery({ queryKey: ['configs'], queryFn: api.listConfigs });
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, refetchInterval: 15_000 });
  const customStrategies = useQuery({ queryKey: ['strategies-custom'], queryFn: api.listStrategies });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['configs'] });
    void qc.invalidateQueries({ queryKey: ['snapshots'] });
  };

  // The strategy's market profile decides which fields this form asks for.
  const def = customStrategies.data?.find((x) => x.id === form.strategy);
  const market = marketOf(form.strategy, def);
  const fixed = fixedFields(market);
  const basket = fixedUnderlyings(market);
  const chosen = basket.length ? basket : form.products;
  const byId = new Map(products.data?.map((p) => [p.symbol, p]));
  const needsOptions = usesOptionLegs(form.strategy, def);
  const futuresOnly = chosen.filter((s) => byId.get(s)?.available && !byId.get(s)?.hasOptions);
  const anyOptions = chosen.some((s) => byId.get(s)?.hasOptions);
  const needsStrikePrice = !fixed.strikeSelection && form.strikeSelection === 'CUSTOM';
  const strategyName = form.strategy === 'rsi-sync' ? BUILTIN_STRATEGY_NAME : (def?.name ?? 'This strategy');

  const blocked =
    chosen.length === 0
      ? 'Pick at least one product.'
      : needsOptions && futuresOnly.length
        ? `${strategyName} reads the Call / Put legs, but ${futuresOnly.join(', ')} ${futuresOnly.length > 1 ? 'are' : 'is'} futures-only. Pick products with options or a strategy that only reads the Future.`
        : needsStrikePrice && (chosen.length !== 1 || form.customStrike === undefined)
          ? 'A CUSTOM strike needs exactly one product and a strike price.'
          : undefined;

  // Fixed fields come from the strategy (the server enforces them too).
  const params = () => ({
    expiryType: market.expiryType ? effectiveExpiryType(market.expiryType, 'MCX') : form.expiryType,
    strikeSelection: market.strikeSelection ?? form.strikeSelection,
    customStrike: needsStrikePrice ? form.customStrike : undefined,
    timeframe: market.timeframe ?? form.timeframe,
    strategy: form.strategy,
    params: {
      rsiPeriod: Number(form.rsiPeriod),
      futureLevel: Number(form.futureLevel),
      callLevel: Number(form.callLevel),
      putLevel: Number(form.putLevel),
    },
  });

  const createMut = useMutation({
    mutationFn: (input: AlertConfigurationInput) => api.createConfig(input),
    onSuccess: (c) => {
      invalidate();
      setNotice(`${c.underlying} monitor created — activate it to start watching.`);
    },
    onError: (e: Error) => setNotice(e.message),
  });
  const createGroupMut = useMutation({
    mutationFn: (body: { members: string[]; groupName?: string }) => api.createConfigGroup({ ...body, ...params() }),
    onSuccess: (r) => {
      invalidate();
      setNotice(`Group monitor created (${r.configs.length} products).`);
    },
    onError: (e: Error) => setNotice(e.message),
  });
  const activateMut = useMutation({
    mutationFn: (id: string) => api.activateConfig(id),
    onSuccess: (c) => {
      invalidate();
      setNotice(`${c.underlying} monitor active — evaluated on every closed ${c.timeframe} candle during the MCX session.`);
    },
    onError: (e: Error) => setNotice(e.message),
  });
  const deactivateMut = useMutation({ mutationFn: (id: string) => api.deactivateConfig(id), onSuccess: invalidate });
  const deleteMut = useMutation({ mutationFn: (id: string) => api.deleteConfig(id), onSuccess: invalidate });
  const activateGroupMut = useMutation({
    mutationFn: (gid: string) => api.activateConfigGroup(gid),
    onSuccess: (r) => {
      invalidate();
      setNotice(`Activated ${r.activated}/${r.total}.${r.errors.length ? ` Failed: ${r.errors.join('; ')}` : ''}`);
    },
    onError: (e: Error) => setNotice(e.message),
  });
  const deactivateGroupMut = useMutation({ mutationFn: (gid: string) => api.deactivateConfigGroup(gid), onSuccess: invalidate });
  const deleteGroupMut = useMutation({ mutationFn: (gid: string) => api.deleteConfigGroup(gid), onSuccess: invalidate });

  const submit = () => {
    if (blocked) return;
    if (chosen.length === 1) {
      createMut.mutate({ underlying: chosen[0]!, ...params() });
      return;
    }
    const groupName = form.groupName.trim() || (basket.length ? def?.name : undefined) || `MCX · ${chosen.join(', ')}`;
    createGroupMut.mutate({ members: chosen, groupName });
  };

  const toggleProduct = (sym: string) =>
    setForm({
      ...form,
      customStrike: undefined,
      products: form.products.includes(sym) ? form.products.filter((x) => x !== sym) : [...form.products, sym],
    });

  const mcxConfigs = configs.data?.filter((c) => isMcx(c.underlying)) ?? [];
  const snapOf = (id: string) => snapshots.data?.find((s) => s.configId === id);
  const stratName = (id: string) =>
    id === 'rsi-sync' ? BUILTIN_STRATEGY_NAME : (customStrategies.data?.find((s) => s.id === id)?.name ?? 'Custom strategy');
  const contractsOf = (id: string) => {
    const c = snapOf(id)?.contracts;
    return c ? [c.future?.tradingSymbol, c.call?.tradingSymbol, c.put?.tradingSymbol].filter(Boolean).join(' · ') : '';
  };
  const hiddenStrategies = customStrategies.data?.filter((s) => s.status === 'active' && !runsOnSegment(s.market, 'MCX')).length ?? 0;

  return (
    <div>
      {notice && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent-soft flex justify-between gap-3">
          <span>{notice}</span>
          <IconButton help={{ title: 'Dismiss', body: 'Hide this message.' }} onClick={() => setNotice(null)} className="px-1">
            ✕
          </IconButton>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-4">
              New MCX Monitor
              <InfoTip
                content={{
                  title: 'MCX monitor',
                  body: 'Watches a commodity’s future (and ATM call/put where options are listed) with a strategy, firing alerts on closed candles during the MCX session.',
                }}
              />
            </h2>
            <div className="space-y-4">
              <div>
                <FieldLabel help={HELP.field.strategy}>Strategy</FieldLabel>
                <select
                  className="input w-full"
                  value={form.strategy}
                  onChange={(e) => setForm({ ...form, strategy: e.target.value, customStrike: undefined })}
                >
                  <option value="rsi-sync">{BUILTIN_STRATEGY_NAME} (built-in)</option>
                  {customStrategies.data
                    ?.filter((s) => s.status === 'active' && runsOnSegment(s.market, 'MCX'))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <MarketBadge market={market} compact />
                  <LockedFields market={market} segment="MCX" />
                </div>
                {hiddenStrategies > 0 && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
                    {hiddenStrategies} NSE/BSE-pinned {hiddenStrategies === 1 ? 'strategy is' : 'strategies are'} hidden
                    <InfoTip content={HELP.mcx.strategyNotHere} />
                  </p>
                )}
                {isSpecific(market) && <p className="mt-2 text-xs text-slate-500">This strategy fixes its whole setup — nothing else to choose.</p>}
              </div>

              {!fixed.underlying && (
                <div>
                  <FieldLabel help={HELP.mcx.product}>Products</FieldLabel>
                  {products.isLoading ? (
                    <Spinner />
                  ) : (
                    <div className="space-y-2">
                      {GROUPS.map((g) => (
                        <div key={g}>
                          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">{MCX_GROUP_LABEL[g]}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {products.data
                              ?.filter((p) => p.group === g)
                              .map((p) => {
                                const on = form.products.includes(p.symbol);
                                return (
                                  <Tooltip
                                    key={p.symbol}
                                    content={{
                                      title: `${p.symbol} — ${p.name}`,
                                      body: !p.available
                                        ? HELP.mcx.notSynced.body
                                        : on
                                          ? 'Selected. Click to remove.'
                                          : 'Click to monitor this product (pick several for a group).',
                                      note: !p.available
                                        ? undefined
                                        : p.hasOptions
                                          ? `Futures + options${p.optionsLiquid ? '' : ' (thin)'} · strikes every ${p.strikeInterval ?? '—'}`
                                          : 'Futures only — strategies must read just the Future.',
                                    }}
                                  >
                                    <button
                                      type="button"
                                      aria-pressed={on}
                                      disabled={!p.available}
                                      onClick={() => toggleProduct(p.symbol)}
                                      className={clsx(
                                        'rounded-md px-2.5 py-1 text-xs border disabled:opacity-40 disabled:cursor-not-allowed',
                                        on ? 'bg-accent/20 border-accent/40 text-accent-soft font-semibold' : 'bg-ink-800 border-ink-700 text-slate-400',
                                      )}
                                    >
                                      {p.symbol}
                                      {p.available && !p.hasOptions && <span className="ml-1 text-[9px] text-slate-500">FUT</span>}
                                    </button>
                                  </Tooltip>
                                );
                              })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {form.products.length > 1 && (
                    <div className="mt-3">
                      <FieldLabel help={HELP.mcx.groupName}>Group name</FieldLabel>
                      <input
                        className="input w-full"
                        placeholder={`MCX · ${form.products.join(', ')}`}
                        value={form.groupName}
                        onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}

              {(!fixed.expiryType || !fixed.strikeSelection || !fixed.timeframe) && (
                <div className="grid grid-cols-2 gap-3">
                  {!fixed.expiryType && (
                    <div className="col-span-2">
                      <FieldLabel help={HELP.mcx.expiry}>Contract month</FieldLabel>
                      <select
                        className="input w-full"
                        value={form.expiryType}
                        onChange={(e) => setForm({ ...form, expiryType: e.target.value as ExpiryType, customStrike: undefined })}
                      >
                        {(meta.data?.expiryTypes ?? EXPIRY_TYPES.MCX).map((x) => (
                          <option key={x.type} value={x.type}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {!fixed.strikeSelection && anyOptions && (
                    <div>
                      <FieldLabel help={HELP.mcx.strike}>Strike</FieldLabel>
                      <select
                        className="input w-full"
                        value={form.strikeSelection}
                        onChange={(e) => setForm({ ...form, strikeSelection: e.target.value as StrikeSelection })}
                      >
                        {meta.data?.strikeSelections.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {!fixed.timeframe && (
                    <div className={clsx(!(anyOptions && !fixed.strikeSelection) && 'col-span-2')}>
                      <FieldLabel help={HELP.field.timeframe}>Timeframe</FieldLabel>
                      <select
                        className="input w-full"
                        value={form.timeframe}
                        onChange={(e) => setForm({ ...form, timeframe: e.target.value as Timeframe })}
                      >
                        {meta.data?.timeframes.map((t) => (
                          <option key={t.key} value={t.key}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {needsStrikePrice && anyOptions && (
                    <div className="col-span-2">
                      <FieldLabel help={HELP.market.customStrike}>Strike Price</FieldLabel>
                      {chosen.length !== 1 ? (
                        <p className="text-xs text-warn">A CUSTOM strike needs a single product.</p>
                      ) : (
                        <CustomStrikeSelect
                          underlying={chosen[0]!}
                          expiryType={market.expiryType ?? form.expiryType}
                          value={form.customStrike}
                          onChange={(k) => setForm({ ...form, customStrike: k })}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className={form.strategy === 'rsi-sync' ? 'border-t border-ink-700/60 pt-4' : 'hidden'}>
                <FieldLabel help={HELP.config.rsiLevels}>RSI Levels</FieldLabel>
                <div className="grid grid-cols-4 gap-2">
                  {(['rsiPeriod', 'futureLevel', 'callLevel', 'putLevel'] as const).map((k) => (
                    <div key={k}>
                      <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                        {k === 'rsiPeriod' ? 'Period' : k === 'futureLevel' ? 'Future' : k === 'callLevel' ? 'Call' : 'Put'}
                        <InfoTip content={HELP.config[k === 'rsiPeriod' ? 'period' : k]} />
                      </div>
                      <input type="number" className="input w-full" value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />
                    </div>
                  ))}
                </div>
              </div>

              {blocked && chosen.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-warn">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {blocked}
                </p>
              )}

              <Help content={blocked ? { ...HELP.mcx.create, note: blocked } : HELP.mcx.create} className="w-full">
                <button
                  className="btn-primary w-full justify-center"
                  onClick={submit}
                  disabled={Boolean(blocked) || createMut.isPending || createGroupMut.isPending}
                >
                  <Zap className="w-4 h-4" />{' '}
                  {chosen.length > 1 ? `Create ${chosen.length} Monitors (${chosen.join(', ')})` : 'Create Monitor'}
                </button>
              </Help>
            </div>
          </Card>
          <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
            NSE/BSE index monitors live on
            <Tooltip content={HELP.mcx.toNse}>
              <Link href="/configuration" className="inline-flex items-center gap-0.5 font-medium text-accent-soft hover:underline">
                Configuration <ArrowRight className="w-3 h-3" />
              </Link>
            </Tooltip>
          </p>
        </div>

        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">MCX Monitors</h2>
          {configs.isLoading ? (
            <Spinner />
          ) : mcxConfigs.length === 0 ? (
            <Card>
              <EmptyState title="No MCX monitors yet" hint="Pick a product and strategy on the left to create one." />
            </Card>
          ) : (
            <MonitorList
              configs={mcxConfigs}
              stratName={stratName}
              contractsOf={contractsOf}
              errorOf={(id) => snapOf(id)?.lastError ?? null}
              hasOptions={(u) => byId.get(u)?.hasOptions !== false}
              onActivate={(id) => activateMut.mutate(id)}
              onDeactivate={(id) => deactivateMut.mutate(id)}
              onDelete={(c) => window.confirm(`Delete the ${c.underlying} monitor and all of its alerts?`) && deleteMut.mutate(c.id)}
              onActivateGroup={(gid) => activateGroupMut.mutate(gid)}
              onDeactivateGroup={(gid) => deactivateGroupMut.mutate(gid)}
              onDeleteGroup={(gid, name) => window.confirm(`Delete the "${name}" monitors and all their alerts?`) && deleteGroupMut.mutate(gid)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MonitorList({
  configs,
  stratName,
  contractsOf,
  errorOf,
  hasOptions,
  onActivate,
  onDeactivate,
  onDelete,
  onActivateGroup,
  onDeactivateGroup,
  onDeleteGroup,
}: {
  configs: AlertConfiguration[];
  stratName: (id: string) => string;
  contractsOf: (id: string) => string;
  errorOf: (id: string) => string | null;
  /** False for futures-only products (no strike to show). */
  hasOptions: (underlying: string) => boolean;
  onActivate: (id: string) => void;
  onDeactivate: (id: string) => void;
  onDelete: (c: AlertConfiguration) => void;
  onActivateGroup: (gid: string) => void;
  onDeactivateGroup: (gid: string) => void;
  onDeleteGroup: (gid: string, name: string) => void;
}) {
  const groups = new Map<string, AlertConfiguration[]>();
  const singles: AlertConfiguration[] = [];
  for (const c of configs) {
    if (c.groupId) groups.set(c.groupId, [...(groups.get(c.groupId) ?? []), c]);
    else singles.push(c);
  }
  const month = (c: AlertConfiguration) => expiryLabel(effectiveExpiryType(c.expiryType, 'MCX'));

  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([gid, members]) => {
        const activeCount = members.filter((m) => m.active).length;
        const head = members[0]!;
        const name = head.groupName ?? 'Group';
        return (
          <Card key={gid} className="flex flex-col gap-3 border-accent/20">
            <div className="flex items-center gap-2">
              <span className="text-fg font-semibold">{name}</span>
              <Help content={{ title: 'Active members', body: `${activeCount} of ${members.length} monitors in this group are running.` }}>
                <Badge tone={activeCount > 0 ? 'bull' : 'default'}>
                  {activeCount}/{members.length} active
                </Badge>
              </Help>
              <Help content={HELP.config.groupBadge}>
                <Badge tone="accent">group</Badge>
              </Help>
            </div>
            <div className="text-xs text-slate-400 -mt-1">
              {stratName(head.strategy)} · {month(head)} · {head.timeframe}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <Tooltip key={m.id} content={{ ...HELP.mcx.contract, note: contractsOf(m.id) || 'Not activated yet.' }}>
                  <span
                    tabIndex={0}
                    className={clsx(
                      'rounded-md px-2 py-1 text-xs border cursor-help',
                      m.active && errorOf(m.id)
                        ? 'bg-bear/10 border-bear/30 text-bear'
                        : m.active
                          ? 'bg-bull/10 border-bull/30 text-bull'
                          : 'bg-ink-800 border-ink-700 text-slate-400',
                    )}
                  >
                    {m.underlying}
                  </span>
                </Tooltip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {activeCount < members.length && (
                <Help content={HELP.config.activateAll}>
                  <button className="btn-primary text-xs" onClick={() => onActivateGroup(gid)}>
                    <Play className="w-3.5 h-3.5" /> Activate All
                  </button>
                </Help>
              )}
              {activeCount > 0 && (
                <Help content={HELP.config.deactivateAll}>
                  <button className="btn-ghost text-xs" onClick={() => onDeactivateGroup(gid)}>
                    <Power className="w-3.5 h-3.5" /> Deactivate All
                  </button>
                </Help>
              )}
              <Help content={HELP.config.deleteGroup} className="ml-auto">
                <button className="btn-ghost text-xs text-bear" onClick={() => onDeleteGroup(gid, name)}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete Group
                </button>
              </Help>
            </div>
          </Card>
        );
      })}

      {singles.map((c) => {
        const error = c.active ? errorOf(c.id) : null;
        const contracts = contractsOf(c.id);
        return (
          <Card key={c.id} className="flex flex-col gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-fg font-semibold">{c.underlying}</span>
                {error ? (
                  <Help content={HELP.monitor.error}>
                    <Badge tone="bear">● Error</Badge>
                  </Help>
                ) : c.active ? (
                  <Help content={HELP.monitor.live}>
                    <Badge tone="bull">● Live</Badge>
                  </Help>
                ) : (
                  <Help content={HELP.monitor.idle}>
                    <Badge>○ Idle</Badge>
                  </Help>
                )}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {stratName(c.strategy)} · {month(c)} · {hasOptions(c.underlying) ? `${c.strikeSelection} · ` : 'futures only · '}
                {c.timeframe}
                {c.strategy === 'rsi-sync' ? ` · F${c.params.futureLevel}/C${c.params.callLevel}/P${c.params.putLevel}` : ''}
              </div>
              {contracts && (
                <Tooltip content={HELP.mcx.contract}>
                  <div tabIndex={0} className="text-[11px] font-mono text-slate-500 mt-1 cursor-help">
                    {contracts}
                  </div>
                </Tooltip>
              )}
              {error && <div className="text-xs text-bear mt-1">Last run failed: {error}</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              {c.active ? (
                <Help content={HELP.config.deactivate}>
                  <button className="btn-ghost text-xs" onClick={() => onDeactivate(c.id)}>
                    <Power className="w-3.5 h-3.5" /> Deactivate
                  </button>
                </Help>
              ) : (
                <Help content={HELP.config.activate}>
                  <button className="btn-primary text-xs" onClick={() => onActivate(c.id)}>
                    <Play className="w-3.5 h-3.5" /> Activate
                  </button>
                </Help>
              )}
              <Help content={HELP.config.delete} className="ml-auto">
                <button className="btn-ghost text-xs text-bear" onClick={() => onDelete(c)}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </Help>
            </div>
          </Card>
        );
      })}
    </div>
  );
}


