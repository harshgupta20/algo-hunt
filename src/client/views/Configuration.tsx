'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Power, Trash2, Zap } from 'lucide-react';
import clsx from 'clsx';
import type { AlertConfiguration, AlertConfigurationInput, ExpiryType, StrikeSelection, Timeframe } from '@ash/shared';
import { DEFAULT_RSI_SYNC_PARAMS, BUILTIN_STRATEGY_NAME, fixedFields, fixedUnderlyings, isSpecific, marketOf } from '@ash/shared';
import { api } from '../lib/api';
import { Badge, Card, EmptyState, Help, IconButton, PageHeader, Spinner } from '../components/ui';
import { InfoTip } from '../components/Tooltip';
import { CustomStrikeSelect, LockedFields, MarketBadge } from '../components/market';
import { GroupsManager } from '../components/GroupsManager';
import { FieldLabel } from '../components/Tooltip';
import { HELP } from '../lib/help';

const DEFAULT_FORM = {
  mode: 'single' as 'single' | 'group',
  underlying: 'NIFTY',
  groupId: '',
  expiryType: 'current-weekly' as ExpiryType,
  strikeSelection: 'ATM' as StrikeSelection,
  customStrike: undefined as number | undefined,
  timeframe: '15m' as Timeframe,
  strategy: 'rsi-sync',
  rsiPeriod: DEFAULT_RSI_SYNC_PARAMS.rsiPeriod,
  futureLevel: DEFAULT_RSI_SYNC_PARAMS.futureLevel,
  callLevel: DEFAULT_RSI_SYNC_PARAMS.callLevel,
  putLevel: DEFAULT_RSI_SYNC_PARAMS.putLevel,
};

export function Configuration() {
  const qc = useQueryClient();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  const underlyings = useQuery({ queryKey: ['underlyings'], queryFn: api.underlyings });
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const configs = useQuery({ queryKey: ['configs'], queryFn: api.listConfigs });
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, refetchInterval: 15_000 });
  const customStrategies = useQuery({ queryKey: ['strategies-custom'], queryFn: api.listStrategies });
  const groups = useQuery({ queryKey: ['groups'], queryFn: api.listGroups });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['configs'] });
    void qc.invalidateQueries({ queryKey: ['snapshots'] });
  };

  // The chosen strategy's market profile decides which fields this form asks for.
  const def = customStrategies.data?.find((x) => x.id === form.strategy);
  const market = marketOf(form.strategy, def);
  const fixed = fixedFields(market);
  const basket = fixedUnderlyings(market);
  const multiUnderlying = basket.length > 1 || (!fixed.underlying && form.mode === 'group');
  const singleUnderlying = basket[0] ?? form.underlying;
  const needsStrikePrice = !fixed.strikeSelection && form.strikeSelection === 'CUSTOM';

  // Fixed fields come from the strategy (the server enforces them too).
  const params = () => ({
    expiryType: market.expiryType ?? form.expiryType,
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
    onSuccess: () => {
      invalidate();
      setNotice('Configuration created.');
    },
    onError: (e: Error) => setNotice(e.message),
  });
  const createGroupMut = useMutation({
    mutationFn: (body: { members: string[]; groupName?: string }) =>
      api.createConfigGroup({ ...body, ...params() }),
    onSuccess: (r) => {
      invalidate();
      setNotice(`Group monitor created (${r.configs.length} underlyings).`);
    },
    onError: (e: Error) => setNotice(e.message),
  });
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
  const activateMut = useMutation({
    mutationFn: (id: string) => api.activateConfig(id),
    onSuccess: (c) => {
      invalidate();
      setNotice(`${c.underlying} monitor active — evaluated on every closed ${c.timeframe} candle.`);
    },
    onError: (e: Error) => setNotice(e.message),
  });
  const deactivateMut = useMutation({ mutationFn: (id: string) => api.deactivateConfig(id), onSuccess: invalidate });
  const deleteMut = useMutation({ mutationFn: (id: string) => api.deleteConfig(id), onSuccess: invalidate });

  const submit = () => {
    if (basket.length > 1) {
      createGroupMut.mutate({ members: basket, groupName: def?.name });
      return;
    }
    if (basket.length === 1) {
      createMut.mutate({ underlying: basket[0]!, ...params() });
      return;
    }
    if (form.mode === 'group') {
      const group = groups.data?.find((g) => g.id === form.groupId);
      if (!group) {
        setNotice('Select a group first.');
        return;
      }
      createGroupMut.mutate({ members: group.members, groupName: group.name });
    } else {
      createMut.mutate({ underlying: form.underlying, ...params() });
    }
  };

  const snapOf = (id: string) => snapshots.data?.find((s) => s.configId === id);
  const strikeOf = (id: string) => snapOf(id)?.strike || undefined;
  const stratName = (id: string) =>
    id === 'rsi-sync' ? BUILTIN_STRATEGY_NAME : customStrategies.data?.find((s) => s.id === id)?.name ?? 'Custom strategy';

  return (
    <div>
      <PageHeader title="Configuration" subtitle="Define what to monitor and tune the RSI-sync strategy." />

      {notice && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent-soft flex justify-between">
          <span>{notice}</span>
          <IconButton help={{ title: 'Dismiss', body: 'Hide this message.' }} onClick={() => setNotice(null)} className="px-1">
            ✕
          </IconButton>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form + groups */}
        <div className="lg:col-span-1 space-y-6">
        <Card>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-4">
            New Monitor
            <InfoTip content={{ title: 'Monitor', body: 'A monitor watches one underlying’s Future, ATM Call and ATM Put with a strategy and fires alerts on closed candles.' }} />
          </h2>
          <div className="space-y-4">
            <div>
              <FieldLabel help={HELP.field.strategy}>Strategy</FieldLabel>
              <select className="input w-full" value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value, customStrike: undefined })}>
                <option value="rsi-sync">{BUILTIN_STRATEGY_NAME} (built-in)</option>
                {customStrategies.data
                  ?.filter((s) => s.status === 'active')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <MarketBadge market={market} compact />
                <LockedFields market={market} />
              </div>
              {isSpecific(market) && (
                <p className="mt-2 text-xs text-slate-500">This strategy fixes its whole setup — nothing else to choose.</p>
              )}
            </div>

            {!fixed.underlying && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="flex rounded-lg overflow-hidden border border-ink-700 text-xs w-fit">
                    {(['single', 'group'] as const).map((m) => (
                      <Help
                        key={m}
                        content={
                          m === 'single'
                            ? { title: 'Single', body: 'One monitor for one underlying.' }
                            : { title: 'Group', body: 'One monitor per member of a saved underlying group, created and switched together.' }
                        }
                      >
                        <button
                          onClick={() => setForm({ ...form, mode: m })}
                          className={clsx('px-3 py-1 capitalize', form.mode === m ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400')}
                        >
                          {m}
                        </button>
                      </Help>
                    ))}
                  </div>
                  <InfoTip content={HELP.config.mode} />
                </div>
                {form.mode === 'single' ? (
                  <>
                    <FieldLabel help={HELP.field.underlying}>Underlying</FieldLabel>
                    <select className="input w-full" value={form.underlying} onChange={(e) => setForm({ ...form, underlying: e.target.value, customStrike: undefined })}>
                      {underlyings.data?.map((u) => (
                        <option key={u.symbol} value={u.symbol}>
                          {u.symbol} — {u.name}
                        </option>
                      ))}
                    </select>
                    {underlyings.data?.length === 0 && (
                      <p className="text-xs text-warn mt-1">
                        No instruments yet — connect Zerodha Kite in Settings to load the F&amp;O instrument master.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <FieldLabel help={HELP.config.group}>Group</FieldLabel>
                    <select className="input w-full" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                      <option value="">Select a group…</option>
                      {groups.data?.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.members.length})
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}

            {(!fixed.expiryType || !fixed.strikeSelection || !fixed.timeframe) && (
              <div className="grid grid-cols-2 gap-3">
                {!fixed.expiryType && (
                  <div className="col-span-2">
                    <FieldLabel help={HELP.field.expiry}>Expiry</FieldLabel>
                    <select className="input w-full" value={form.expiryType} onChange={(e) => setForm({ ...form, expiryType: e.target.value as ExpiryType, customStrike: undefined })}>
                      {meta.data?.expiryTypes.map((x) => (
                        <option key={x.type} value={x.type}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {!fixed.strikeSelection && (
                  <div>
                    <FieldLabel help={HELP.field.strike}>Strike</FieldLabel>
                    <select className="input w-full" value={form.strikeSelection} onChange={(e) => setForm({ ...form, strikeSelection: e.target.value as StrikeSelection })}>
                      {meta.data?.strikeSelections.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {!fixed.timeframe && (
                  <div>
                    <FieldLabel help={HELP.field.timeframe}>Timeframe</FieldLabel>
                    <select className="input w-full" value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value as Timeframe })}>
                      {meta.data?.timeframes.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {needsStrikePrice && (
                  <div className="col-span-2">
                    <FieldLabel help={HELP.market.customStrike}>Strike Price</FieldLabel>
                    {multiUnderlying ? (
                      <p className="text-xs text-warn">A CUSTOM strike needs a single underlying.</p>
                    ) : (
                      <CustomStrikeSelect
                        underlying={singleUnderlying}
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
                    <input
                      type="number"
                      className="input w-full"
                      value={form[k]}
                      onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
                    />
                  </div>
                ))}
              </div>
            </div>

            <Help
              content={
                basket.length > 1
                  ? { ...HELP.config.create, title: `Create ${basket.length} monitors`, body: `One monitor per underlying in this strategy: ${basket.join(', ')}. They start idle — activate them together.` }
                  : HELP.config.create
              }
              className="w-full"
            >
              <button
                className="btn-primary w-full justify-center"
                onClick={submit}
                disabled={createMut.isPending || createGroupMut.isPending || (needsStrikePrice && (multiUnderlying || form.customStrike === undefined))}
              >
                <Zap className="w-4 h-4" />{' '}
                {basket.length > 1
                  ? `Create ${basket.length} Monitors (${basket.join(', ')})`
                  : form.mode === 'group' && !fixed.underlying
                    ? 'Create Group Monitor'
                    : 'Create Monitor'}
              </button>
            </Help>
          </div>
        </Card>
        <GroupsManager />
        </div>

        {/* Config list */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Monitors</h2>
          {configs.isLoading ? (
            <Spinner />
          ) : (configs.data?.length ?? 0) === 0 ? (
            <Card>
              <EmptyState title="No monitors yet" hint="Create one on the left to begin." />
            </Card>
          ) : (
            (() => {
              const groupOf = new Map<string, AlertConfiguration[]>();
              const singles: AlertConfiguration[] = [];
              configs.data!.forEach((c) => {
                if (c.groupId) {
                  const arr = groupOf.get(c.groupId) ?? [];
                  arr.push(c);
                  groupOf.set(c.groupId, arr);
                } else singles.push(c);
              });
              const isActive = (c: AlertConfiguration) => c.active;
              return (
                <div className="space-y-3">
                  {[...groupOf.entries()].map(([gid, members]) => {
                    const activeCount = members.filter(isActive).length;
                    const head = members[0]!;
                    return (
                      <Card key={gid} className="flex flex-col gap-3 border-accent/20">
                        <div className="flex items-center gap-2">
                          <span className="text-fg font-semibold">{head.groupName ?? 'Group'}</span>
                          <Help content={{ title: 'Active members', body: `${activeCount} of ${members.length} monitors in this group are running.` }}>
                            <Badge tone={activeCount > 0 ? 'bull' : 'default'}>{activeCount}/{members.length} active</Badge>
                          </Help>
                          <Help content={HELP.config.groupBadge}>
                            <Badge tone="accent">group</Badge>
                          </Help>
                        </div>
                        <div className="text-xs text-slate-400 -mt-1">
                          {stratName(head.strategy)} · {head.strikeSelection} · {head.timeframe} · {head.expiryType}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {members.map((m) => (
                            <span
                              key={m.id}
                              className={clsx(
                                'rounded-md px-2 py-1 text-xs border',
                                isActive(m) ? 'bg-bull/10 border-bull/30 text-bull' : 'bg-ink-800 border-ink-700 text-slate-400',
                              )}
                            >
                              {m.underlying}
                              {strikeOf(m.id) ? ` ${strikeOf(m.id)}` : ''}
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {activeCount < members.length && (
                            <Help content={HELP.config.activateAll}>
                              <button className="btn-primary text-xs" onClick={() => activateGroupMut.mutate(gid)}>
                                <Play className="w-3.5 h-3.5" /> Activate All
                              </button>
                            </Help>
                          )}
                          {activeCount > 0 && (
                            <Help content={HELP.config.deactivateAll}>
                              <button className="btn-ghost text-xs" onClick={() => deactivateGroupMut.mutate(gid)}>
                                <Power className="w-3.5 h-3.5" /> Deactivate All
                              </button>
                            </Help>
                          )}
                          <Help content={HELP.config.deleteGroup} className="ml-auto">
                            <button
                              className="btn-ghost text-xs text-bear"
                              onClick={() => {
                                if (window.confirm(`Delete the "${head.groupName ?? 'group'}" monitors and all their alerts?`)) deleteGroupMut.mutate(gid);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete Group
                            </button>
                          </Help>
                        </div>
                      </Card>
                    );
                  })}

                  {singles.map((c) => {
                    const active = isActive(c);
                    return (
                      <Card key={c.id} className="flex flex-col gap-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-fg font-semibold">{c.underlying}</span>
                              {active && snapOf(c.id)?.lastError ? (
                                <Help content={HELP.monitor.error}>
                                  <Badge tone="bear">● Error</Badge>
                                </Help>
                              ) : active ? (
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
                              {stratName(c.strategy)} · {c.strikeSelection} {strikeOf(c.id) ? `(${strikeOf(c.id)})` : ''} · {c.timeframe} · {c.expiryType}
                              {c.strategy === 'rsi-sync' ? ` · F${c.params.futureLevel}/C${c.params.callLevel}/P${c.params.putLevel}` : ''}
                            </div>
                            {active && snapOf(c.id)?.lastError && (
                              <div className="text-xs text-bear mt-1">Last run failed: {snapOf(c.id)!.lastError}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {active ? (
                            <Help content={HELP.config.deactivate}>
                              <button className="btn-ghost text-xs" onClick={() => deactivateMut.mutate(c.id)}>
                                <Power className="w-3.5 h-3.5" /> Deactivate
                              </button>
                            </Help>
                          ) : (
                            <Help content={HELP.config.activate}>
                              <button className="btn-primary text-xs" onClick={() => activateMut.mutate(c.id)}>
                                <Play className="w-3.5 h-3.5" /> Activate
                              </button>
                            </Help>
                          )}
                          <Help content={HELP.config.delete} className="ml-auto">
                            <button
                              className="btn-ghost text-xs text-bear"
                              onClick={() => {
                                if (window.confirm(`Delete the ${c.underlying} monitor and all of its alerts?`)) deleteMut.mutate(c.id);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </Help>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
}
