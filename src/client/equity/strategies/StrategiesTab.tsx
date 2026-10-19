'use client';

/** Saved equity strategies, the template gallery (the trader's three first) and the builder. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FlaskConical, Pencil, Plus, ScanSearch, Sparkles, Trash2 } from 'lucide-react';
import type { EqStrategy, EqStrategyDefinition } from '@/shared/equity';
import { EQ_TEMPLATES, EQ_TIMEFRAME, defaultDefinition, strategySummary } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { Badge, EmptyState, IconButton } from '../../components/ui';
import { SkeletonCards } from '../../components/loaders';
import { eqApi } from '../api';
import { ago } from '../format';
import { E } from '../help';
import { StrategyEditor } from './StrategyEditor';

export type GoTo = (tab: 'backtest' | 'screener', opts: { strategyId?: string; draft?: EqStrategyDefinition }) => void;

function StrategyCard({ s, onEdit, onGo }: { s: EqStrategy; onEdit: () => void; onGo: GoTo }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['eq-strategies'] });
  const duplicate = useMutation({ mutationFn: () => eqApi.duplicateStrategy(s.id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => eqApi.removeStrategy(s.id), onSuccess: refresh });
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  const btn = 'p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800';
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="text-left text-sm font-semibold text-slate-100 hover:text-accent-soft" onClick={onEdit}>
          {s.name}
        </button>
        <Tooltip content={E.list.timeframe}>
          <Badge tone="accent">{EQ_TIMEFRAME[s.definition.timeframe].label}</Badge>
        </Tooltip>
        {s.definition.pyramid.enabled && (
          <Tooltip content={E.editor.pyramid}>
            <Badge>Pyramiding</Badge>
          </Tooltip>
        )}
        <Tooltip content={E.list.version}>
          <span className="text-[11px] text-slate-500">
            v{s.version} · saved {ago(s.updatedAt)}
          </span>
        </Tooltip>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton help={E.list.edit} onClick={onEdit} className={btn}>
            <Pencil className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton help={E.list.backtest} onClick={() => onGo('backtest', { strategyId: s.id })} className={btn}>
            <FlaskConical className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton help={E.list.screen} onClick={() => onGo('screener', { strategyId: s.id })} className={btn}>
            <ScanSearch className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton help={E.list.duplicate} onClick={() => duplicate.mutate()} className={btn}>
            <Copy className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton help={confirm ? { ...E.list.remove, title: 'Click again to delete' } : E.list.remove} onClick={() => (confirm ? remove.mutate() : setConfirm(true))} className={confirm ? 'p-1.5 rounded-md bg-bear/15 text-bear' : 'p-1.5 rounded-md text-slate-400 hover:text-bear hover:bg-bear/10'}>
            <Trash2 className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </div>
      <ul className="flex flex-col gap-0.5 text-xs text-slate-400">
        {strategySummary(s.definition)
          .slice(0, 3)
          .map((l) => (
            <li key={l}>{l}</li>
          ))}
      </ul>
      {(duplicate.error || remove.error) && <p className="text-xs text-bear">{((duplicate.error ?? remove.error) as Error).message}</p>}
    </div>
  );
}

export function StrategiesTab({ editId, onGo }: { editId?: string; onGo: GoTo }) {
  const strategies = useQuery({ queryKey: ['eq-strategies'], queryFn: eqApi.strategies });
  const [editing, setEditing] = useState<{ strategy?: EqStrategy; initial: EqStrategyDefinition } | null>(null);
  // Opened with ?strategy=<id>: straight into its builder, once.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (opened || !editId || !strategies.data) return;
    const s = strategies.data.find((x) => x.id === editId);
    if (s) setEditing({ strategy: s, initial: s.definition });
    setOpened(true);
  }, [editId, strategies.data, opened]);

  if (editing)
    return (
      <StrategyEditor
        key={editing.strategy?.id ?? 'new'}
        strategy={editing.strategy}
        initial={editing.initial}
        onClose={() => setEditing(null)}
        onSaved={(s, then) => (then === 'backtest' ? onGo('backtest', { strategyId: s.id }) : setEditing(null))}
        onTestDraft={(draft) => onGo('backtest', { draft })}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Your strategies</h2>
          <Tooltip content={E.list.new} className="ml-auto">
            <button type="button" className="btn-primary py-1.5 text-sm" onClick={() => setEditing({ initial: defaultDefinition() })}>
              <Plus className="w-4 h-4" /> New strategy
            </button>
          </Tooltip>
        </div>
        {strategies.isLoading && <SkeletonCards count={2} />}
        {strategies.error && <p className="text-xs text-bear">{(strategies.error as Error).message}</p>}
        {strategies.data?.length === 0 && <EmptyState title="No equity strategies yet" hint="Start from a template below — your trader’s three are ready — or build a new one." />}
        <div className="grid gap-3 lg:grid-cols-2">
          {strategies.data?.map((s) => (
            <StrategyCard key={s.id} s={s} onEdit={() => setEditing({ strategy: s, initial: s.definition })} onGo={onGo} />
          ))}
        </div>
      </div>

      {(['Trader', 'Classic'] as const).map((group) => (
        <div key={group} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
            <Sparkles className="w-4 h-4 text-accent-soft" /> {group === 'Trader' ? 'Templates — your trader’s strategies' : 'Templates — classic setups'}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {EQ_TEMPLATES.filter((t) => t.group === group).map((t) => (
              <div key={t.key} className="card flex flex-col gap-2 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-100">{t.label}</span>
                  <Tooltip content={E.list.timeframe}>
                    <Badge tone="accent">{EQ_TIMEFRAME[t.definition.timeframe].label}</Badge>
                  </Tooltip>
                </div>
                <p className="flex-1 text-xs leading-relaxed text-slate-400">{t.description}</p>
                <Tooltip content={E.list.template} className="self-start">
                  <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setEditing({ initial: structuredClone(t.definition) })}>
                    <Pencil className="w-3.5 h-3.5" /> Use template
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
