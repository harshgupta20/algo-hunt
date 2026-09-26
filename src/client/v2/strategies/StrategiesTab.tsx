'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Copy, Link2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { StrategyDefinition, V2Strategy } from '@/shared/v2';
import { TIMEFRAME, nodeText } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { Badge, Card, EmptyState, IconButton, Spinner } from '../../components/ui';
import { v2Api, type StrategyRow } from '../api';
import { LegBadge } from '../components';
import { istStampIso } from '../format';
import { H } from '../help';
import { blankStrategy, exampleStrategies } from './defaults';
import { StrategyEditor } from './StrategyEditor';

function StrategyCard({ s, onEdit, onGo }: { s: StrategyRow; onEdit: () => void; onGo: (tab: 'connections' | 'compare', id: string) => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['v2-strategies'] });
  const duplicate = useMutation({ mutationFn: () => v2Api.duplicateStrategy(s.id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => v2Api.deleteStrategy(s.id), onSuccess: refresh });
  const d = s.definition;
  const btn = 'p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800';
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[16rem]">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{s.name}</h3>
            <Tooltip content={H.strategy.version}>
              <span className="text-[11px] text-slate-500">v{s.version}</span>
            </Tooltip>
            <Tooltip content={H.status.connections}>
              <Badge tone={s.enabledConnections ? 'bull' : 'default'}>
                {s.enabledConnections}/{s.connections} connected on
              </Badge>
            </Tooltip>
          </div>
          {d.description && <p className="text-xs text-slate-400 mt-0.5">{d.description}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-1.5">
            {d.legs.map((l) => (
              <LegBadge key={l.id} leg={l} />
            ))}
            <span className="text-[11px] text-slate-500">
              · {d.evaluation.mode === 'COMPLETED_CANDLE' ? 'completed' : 'live'} {TIMEFRAME[d.evaluation.triggerTimeframe].label} candles · updated {istStampIso(s.updatedAt)}
            </span>
          </div>
          <pre className="mt-2 whitespace-pre-wrap text-[11px] text-slate-400 font-mono">{nodeText(d.expression, d.legs)}</pre>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content={H.strategy.connect}>
            <button type="button" className="btn-primary py-1 text-xs" onClick={() => onGo('connections', s.id)}>
              <Link2 className="w-3.5 h-3.5" /> Connect
            </button>
          </Tooltip>
          <Tooltip content={H.strategy.compare}>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => onGo('compare', s.id)}>
              <BarChart3 className="w-3.5 h-3.5" /> Compare
            </button>
          </Tooltip>
          <IconButton help={H.strategy.edit} onClick={onEdit} className={btn}>
            <Pencil className="w-4 h-4" />
          </IconButton>
          <IconButton help={H.strategy.duplicate} onClick={() => duplicate.mutate()} className={btn}>
            <Copy className="w-4 h-4" />
          </IconButton>
          <IconButton
            help={H.strategy.remove}
            onClick={() => {
              if (window.confirm(`Delete “${s.name}” with its ${s.connections} connection(s) and their alerts? This cannot be undone.`)) remove.mutate();
            }}
            className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10"
          >
            <Trash2 className="w-4 h-4" />
          </IconButton>
        </div>
      </div>
    </Card>
  );
}

export function StrategiesTab({ onGo }: { onGo: (tab: 'connections' | 'compare', strategyId: string) => void }) {
  const [editing, setEditing] = useState<{ strategy?: V2Strategy; initial: StrategyDefinition } | null>(null);
  const strategies = useQuery({ queryKey: ['v2-strategies'], queryFn: v2Api.strategies });

  if (editing) return <StrategyEditor strategy={editing.strategy} initial={editing.initial} onClose={() => setEditing(null)} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={H.strategy.new}>
          <button type="button" className="btn-primary" onClick={() => setEditing({ initial: blankStrategy() })}>
            <Plus className="w-4 h-4" /> New strategy
          </button>
        </Tooltip>
        {exampleStrategies().map((t) => (
          <Tooltip key={t.key} content={{ ...H.strategy.example, title: t.label, body: t.description }}>
            <button type="button" className="btn-ghost text-xs" onClick={() => setEditing({ initial: structuredClone(t.definition) })}>
              <Sparkles className="w-3.5 h-3.5 text-accent-soft" /> {t.label}
            </button>
          </Tooltip>
        ))}
      </div>
      {strategies.isLoading && <Spinner />}
      {strategies.error && <p className="text-sm text-bear">{(strategies.error as Error).message}</p>}
      {strategies.data?.length === 0 && <EmptyState title="No strategies yet" hint="Create one — or start from an example above. Products are connected afterwards." />}
      {strategies.data?.map((s) => <StrategyCard key={s.id} s={s} onEdit={() => setEditing({ strategy: s, initial: s.definition })} onGo={onGo} />)}
    </div>
  );
}
