'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, LineChart, Lock, Pencil, Plus, Power, Sparkles, Trash2 } from 'lucide-react';
import type { StrategyDef } from '@ash/shared';
import { api } from '../lib/api';
import { Badge, Card, EmptyState, ScenarioBadge, Spinner, StrategyStatusBadge } from '../components/ui';
import { LegTag } from '../components/signal';
import { fmtRelative } from '../lib/format';

export interface LibraryActions {
  onNew: () => void;
  onEdit: (id: string) => void;
  onBacktest: (strategy: string) => void;
  /** Open the builder pre-filled with the built-in strategy as a starting point. */
  onCustomizeBuiltin: () => void;
}

function BuiltinCard({ onBacktest, onCustomizeBuiltin }: Pick<LibraryActions, 'onBacktest' | 'onCustomizeBuiltin'>) {
  const builtins = useQuery({ queryKey: ['strategies'], queryFn: api.strategies });
  if (builtins.isLoading) return <Spinner />;
  return (
    <>
      {builtins.data?.map((s) => (
        <Card key={s.key} className="border-l-4 border-l-accent">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-fg font-semibold">{s.name}</h2>
                <Badge tone="accent">
                  <Lock className="w-3 h-3 mr-1" /> Built-in
                </Badge>
                <StrategyStatusBadge status="active" />
              </div>
              <p className="text-sm text-slate-400 mt-1">{s.description}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button className="btn-primary text-xs" onClick={() => onBacktest(s.key)}>
                <LineChart className="w-4 h-4" /> Backtest
              </button>
              <button className="btn-ghost text-xs" onClick={onCustomizeBuiltin} title="Copy into the builder and change the rules">
                <Sparkles className="w-4 h-4" /> Customize a copy
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5">
              <LegTag leg="future" /> <span className="text-bull font-semibold">≥ {s.defaultParams.futureLevel}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <LegTag leg="call" /> <span className="text-bull font-semibold">≥ {s.defaultParams.callLevel}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <LegTag leg="put" /> <span className="text-bear font-semibold">≤ {s.defaultParams.putLevel}</span>
            </span>
            <span className="text-slate-500">RSI period {s.defaultParams.rsiPeriod} · closed candles only</span>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {s.scenarios.map((sc) => (
              <div key={sc.id} className="flex items-start gap-2 rounded-lg bg-ink-850 px-3 py-2">
                <ScenarioBadge scenario={sc.id} compact />
                <div className="text-xs">
                  <div className="text-slate-200 font-medium">{sc.title}</div>
                  <div className="text-slate-500 mt-0.5">{sc.description}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}

export function StrategyLibrary({ onNew, onEdit, onBacktest, onCustomizeBuiltin }: LibraryActions) {
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ['strategies-custom'], queryFn: api.listStrategies });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['strategies-custom'] });
  const dup = useMutation({ mutationFn: (id: string) => api.duplicateStrategy(id), onSuccess: invalidate });
  const publish = useMutation({ mutationFn: (id: string) => api.publishStrategy(id), onSuccess: invalidate });
  const disable = useMutation({ mutationFn: (id: string) => api.disableStrategy(id), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id: string) => api.deleteStrategy(id), onSuccess: invalidate });

  const remove = (s: StrategyDef) => {
    if (window.confirm(`Delete "${s.name}"? Monitors using it will stop evaluating.`)) del.mutate(s.id);
  };

  return (
    <div className="space-y-6">
      <BuiltinCard onBacktest={onBacktest} onCustomizeBuiltin={onCustomizeBuiltin} />

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-300">Your strategies</h2>
          <button className="btn-primary text-xs" onClick={onNew}>
            <Plus className="w-4 h-4" /> New strategy
          </button>
        </div>

        {strategies.isLoading ? (
          <Spinner />
        ) : (strategies.data?.length ?? 0) === 0 ? (
          <Card>
            <EmptyState
              title="No custom strategies yet"
              hint="Build one from rules, or start from the built-in RSI strategy with “Customize a copy”."
            />
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-ink-850">
                  <tr>
                    <th className="px-4 py-3">Strategy</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Runs on</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700/50">
                  {strategies.data!.map((s) => (
                    <tr key={s.id} className="hover:bg-ink-850/60">
                      <td className="px-4 py-3">
                        <button className="text-fg font-medium hover:text-accent-soft text-left" onClick={() => onEdit(s.id)}>
                          {s.name}
                        </button>
                        <div className="text-xs text-slate-500">
                          {s.description || s.category || '—'} · v{s.version}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StrategyStatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {s.underlying} · {s.strikeSelection} · {s.timeframe}
                      </td>
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtRelative(s.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button className="btn-ghost py-1 px-2 text-xs" onClick={() => onBacktest(s.id)}>
                            <LineChart className="w-3.5 h-3.5" /> Backtest
                          </button>
                          <button className="btn-ghost py-1 px-2 text-xs" onClick={() => onEdit(s.id)}>
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button title="Duplicate" className="btn-ghost py-1 px-2" onClick={() => dup.mutate(s.id)}>
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            title={s.status === 'active' ? 'Disable (stop using in monitors)' : 'Publish (usable by monitors)'}
                            className={s.status === 'active' ? 'btn-ghost py-1 px-2 hover:text-warn' : 'btn-ghost py-1 px-2 text-bull'}
                            onClick={() => (s.status === 'active' ? disable : publish).mutate(s.id)}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button title="Delete" className="btn-ghost py-1 px-2 hover:text-bear" onClick={() => remove(s)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
