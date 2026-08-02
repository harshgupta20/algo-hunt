import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, LineChart, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import type { StrategyDef } from '@ash/shared';
import { api } from '../lib/api';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { fmtRelative } from '../lib/format';

function StatusBadge({ status }: { status: StrategyDef['status'] }) {
  const tone = status === 'active' ? 'bull' : status === 'draft' ? 'warn' : 'default';
  return <Badge tone={tone}>{status}</Badge>;
}

export function StrategyLibrary() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const strategies = useQuery({ queryKey: ['strategies-custom'], queryFn: api.listStrategies });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['strategies-custom'] });
  const dup = useMutation({ mutationFn: (id: string) => api.duplicateStrategy(id), onSuccess: invalidate });
  const publish = useMutation({ mutationFn: (id: string) => api.publishStrategy(id), onSuccess: invalidate });
  const disable = useMutation({ mutationFn: (id: string) => api.disableStrategy(id), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id: string) => api.deleteStrategy(id), onSuccess: invalidate });

  return (
    <div>
      <PageHeader
        title="Strategy Library"
        subtitle="Your no-code strategies. Each runs in live alerts and the analyzer through the same engine."
        actions={
          <Link to="/builder" className="btn-primary text-xs">
            <Plus className="w-4 h-4" /> New Strategy
          </Link>
        }
      />

      {strategies.isLoading ? (
        <Spinner />
      ) : (strategies.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState title="No strategies yet" hint="Create your first strategy — start from scratch or the RSI template." />
          <div className="text-center">
            <Link to="/builder" className="btn-primary">
              <Plus className="w-4 h-4" /> New Strategy
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-ink-850">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {strategies.data!.map((s) => (
                  <tr key={s.id} className="hover:bg-ink-850/60">
                    <td className="px-4 py-3">
                      <button className="text-white font-medium hover:text-accent-soft" onClick={() => navigate(`/strategy/${s.id}`)}>
                        {s.name}
                      </button>
                      {s.description && <div className="text-xs text-slate-500">{s.description}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{s.category ?? '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">v{s.version}</td>
                    <td className="px-4 py-3 text-slate-400">{fmtRelative(s.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5 text-slate-400">
                        <button title="Backtest" className="hover:text-accent-soft" onClick={() => navigate(`/strategy/${s.id}`)}>
                          <LineChart className="w-4 h-4" />
                        </button>
                        <button title="Edit" className="hover:text-accent-soft" onClick={() => navigate(`/builder/${s.id}`)}>
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button title="Duplicate" className="hover:text-accent-soft" onClick={() => dup.mutate(s.id)}>
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          title={s.status === 'active' ? 'Disable' : 'Publish'}
                          className="hover:text-warn"
                          onClick={() => (s.status === 'active' ? disable : publish).mutate(s.id)}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button title="Delete" className="hover:text-bear" onClick={() => del.mutate(s.id)}>
                          <Trash2 className="w-4 h-4" />
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
  );
}
