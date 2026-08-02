import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Power, Trash2, Zap } from 'lucide-react';
import type { AlertConfiguration, AlertConfigurationInput, ExpiryType, StrikeSelection, Timeframe } from '@ash/shared';
import { DEFAULT_RSI_SYNC_PARAMS } from '@ash/shared';
import { api } from '../lib/api';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui';

const DEFAULT_FORM = {
  underlying: 'NIFTY',
  expiryType: 'current-weekly' as ExpiryType,
  strikeSelection: 'ATM' as StrikeSelection,
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
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, refetchInterval: 5000 });
  const customStrategies = useQuery({ queryKey: ['strategies-custom'], queryFn: api.listStrategies });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['configs'] });
    void qc.invalidateQueries({ queryKey: ['snapshots'] });
  };

  const createMut = useMutation({
    mutationFn: (input: AlertConfigurationInput) => api.createConfig(input),
    onSuccess: () => {
      invalidate();
      setNotice('Configuration created.');
    },
    onError: (e: Error) => setNotice(e.message),
  });
  const activateMut = useMutation({ mutationFn: (id: string) => api.activateConfig(id), onSuccess: invalidate, onError: (e: Error) => setNotice(e.message) });
  const deactivateMut = useMutation({ mutationFn: (id: string) => api.deactivateConfig(id), onSuccess: invalidate });
  const deleteMut = useMutation({ mutationFn: (id: string) => api.deleteConfig(id), onSuccess: invalidate });
  const simulateMut = useMutation({
    mutationFn: ({ id, scenario }: { id: string; scenario: 1 | 2 }) => api.simulate(id, scenario),
    onSuccess: (_r, v) => setNotice(`Simulated Scenario ${v.scenario} — check Live Alerts.`),
    onError: (e: Error) => setNotice(e.message),
  });

  const submit = () => {
    createMut.mutate({
      underlying: form.underlying,
      expiryType: form.expiryType,
      strikeSelection: form.strikeSelection,
      timeframe: form.timeframe,
      strategy: form.strategy,
      params: {
        rsiPeriod: Number(form.rsiPeriod),
        futureLevel: Number(form.futureLevel),
        callLevel: Number(form.callLevel),
        putLevel: Number(form.putLevel),
      },
    });
  };

  const strikeOf = (id: string) => snapshots.data?.find((s) => s.configId === id)?.strike;
  const stratName = (id: string) =>
    id === 'rsi-sync' ? 'RSI Multi Confirmation' : customStrategies.data?.find((s) => s.id === id)?.name ?? 'Custom strategy';

  return (
    <div>
      <PageHeader title="Configuration" subtitle="Define what to monitor and tune the RSI-sync strategy." />

      {notice && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent-soft flex justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <Card className="lg:col-span-1">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">New Monitor</h2>
          <div className="space-y-4">
            <div>
              <label className="label">Underlying</label>
              <select className="input w-full" value={form.underlying} onChange={(e) => setForm({ ...form, underlying: e.target.value })}>
                {underlyings.data?.map((u) => (
                  <option key={u.symbol} value={u.symbol}>
                    {u.symbol} — {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Expiry</label>
              <select className="input w-full" value={form.expiryType} onChange={(e) => setForm({ ...form, expiryType: e.target.value as ExpiryType })}>
                {meta.data?.expiryTypes.map((x) => (
                  <option key={x.type} value={x.type}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Strike</label>
                <select className="input w-full" value={form.strikeSelection} onChange={(e) => setForm({ ...form, strikeSelection: e.target.value as StrikeSelection })}>
                  {meta.data?.strikeSelections.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Timeframe</label>
                <select className="input w-full" value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value as Timeframe })}>
                  {meta.data?.timeframes.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label">Strategy</label>
              <select className="input w-full" value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}>
                <option value="rsi-sync">RSI Multi Confirmation (built-in)</option>
                {customStrategies.data
                  ?.filter((s) => s.status === 'active')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className={form.strategy === 'rsi-sync' ? 'border-t border-ink-700/60 pt-4' : 'hidden'}>
              <div className="label">RSI Levels</div>
              <div className="grid grid-cols-4 gap-2">
                {(['rsiPeriod', 'futureLevel', 'callLevel', 'putLevel'] as const).map((k) => (
                  <div key={k}>
                    <div className="text-[10px] text-slate-500 mb-1">
                      {k === 'rsiPeriod' ? 'Period' : k === 'futureLevel' ? 'Future' : k === 'callLevel' ? 'Call' : 'Put'}
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

            <button className="btn-primary w-full justify-center" onClick={submit} disabled={createMut.isPending}>
              <Zap className="w-4 h-4" /> Create Monitor
            </button>
          </div>
        </Card>

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
            <div className="space-y-3">
              {configs.data!.map((c: AlertConfiguration) => {
                const active = snapshots.data?.some((s) => s.configId === c.id) ?? c.active;
                return (
                  <Card key={c.id} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-semibold">{c.underlying}</span>
                          {active ? <Badge tone="bull">Active</Badge> : <Badge>Idle</Badge>}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {stratName(c.strategy)} · {c.strikeSelection} {strikeOf(c.id) ? `(${strikeOf(c.id)})` : ''} · {c.timeframe} · {c.expiryType}
                          {c.strategy === 'rsi-sync' ? ` · F${c.params.futureLevel}/C${c.params.callLevel}/P${c.params.putLevel}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {active ? (
                        <button className="btn-ghost text-xs" onClick={() => deactivateMut.mutate(c.id)}>
                          <Power className="w-3.5 h-3.5" /> Deactivate
                        </button>
                      ) : (
                        <button className="btn-primary text-xs" onClick={() => activateMut.mutate(c.id)}>
                          <Play className="w-3.5 h-3.5" /> Activate
                        </button>
                      )}
                      {active && c.strategy === 'rsi-sync' && (
                        <>
                          <button className="btn-ghost text-xs" onClick={() => simulateMut.mutate({ id: c.id, scenario: 1 })}>
                            Simulate S1
                          </button>
                          <button className="btn-ghost text-xs" onClick={() => simulateMut.mutate({ id: c.id, scenario: 2 })}>
                            Simulate S2
                          </button>
                        </>
                      )}
                      <button className="btn-ghost text-xs text-bear ml-auto" onClick={() => deleteMut.mutate(c.id)}>
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
