'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Pencil, PlayCircle, Plus, Power, PowerOff, Sparkles, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { McxStrategy, McxStrategyDefinition } from '@/shared/mcx';
import { evaluationText, policyText, universeText } from '@/shared/mcx';
import { Tooltip } from '../components/Tooltip';
import { Badge, Card, EmptyState, IconButton, Spinner } from '../components/ui';
import { McxApiError, mcxApi, type ExplainResult } from './api';
import { TriBadge, UnitStateBadge, UnitTag } from './components';
import { istStampIso } from './format';
import { H } from './help';
import { ExplainView } from './editor/DebugViews';
import { blankStrategy, exampleStrategies } from './editor/defaults';
import { StrategyEditor } from './editor/StrategyEditor';

function Units({ strategy }: { strategy: McxStrategy }) {
  const units = useQuery({ queryKey: ['mcx2-units', strategy.id], queryFn: () => mcxApi.units(strategy.id), refetchInterval: 30_000 });
  if (units.isLoading) return <Spinner />;
  const list = units.data ?? [];
  if (!list.length) return <p className="text-xs text-slate-500">Not evaluated yet — the scanner evaluates enabled strategies when their trigger candle closes.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1 pr-3">Strike / future</th>
            <th className="py-1 pr-3">Result</th>
            <th className="py-1 pr-3">State</th>
            <th className="py-1 pr-3">Evaluated</th>
            <th className="py-1">Last alert</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700/40">
          {list.map((u) => (
            <tr key={u.unitKey}>
              <td className="py-1 pr-3">{u.lastEvaluation ? <UnitTag unit={u.lastEvaluation.unit} /> : u.unitKey}</td>
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
    </div>
  );
}

function StrategyCard({ s, onEdit }: { s: McxStrategy; onEdit: () => void }) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<'units' | 'explain' | null>(null);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [error, setError] = useState<McxApiError | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['mcx2-strategies'] });
    qc.invalidateQueries({ queryKey: ['mcx2-status'] });
  };
  const onError = (e: unknown) => setError(e instanceof McxApiError ? e : new McxApiError((e as Error).message, 0));
  const toggle = useMutation({ mutationFn: () => (s.enabled ? mcxApi.disable(s.id) : mcxApi.enable(s.id)), onSuccess: () => (setError(null), refresh()), onError });
  const duplicate = useMutation({ mutationFn: () => mcxApi.duplicateStrategy(s.id), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: () => mcxApi.deleteStrategy(s.id), onSuccess: refresh, onError });
  const run = useMutation({ mutationFn: () => mcxApi.explain(s.id), onSuccess: (r) => (setExplain(r), setPanel('explain')), onError });
  const d = s.definition;
  const btn = 'p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800';

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[14rem]">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{s.name}</h3>
            <Tooltip content={H.strategy.version}>
              <span className="text-[11px] text-slate-500">v{s.version}</span>
            </Tooltip>
            <Tooltip content={s.enabled ? H.strategy.disable : H.strategy.enable}>
              <Badge tone={s.enabled ? 'bull' : 'default'}>{s.enabled ? '● Enabled' : '○ Disabled'}</Badge>
            </Tooltip>
          </div>
          {d.description && <p className="text-xs text-slate-400 mt-0.5">{d.description}</p>}
          <p className="text-xs text-slate-300 mt-1">{universeText(d.universe)}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {evaluationText(d.evaluation)} · {policyText(d.alert)}
            {s.enabledAt && s.enabled && <> · enabled {istStampIso(s.enabledAt)}</>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content={s.enabled ? H.strategy.disable : H.strategy.enable}>
            <button type="button" className={clsx('btn py-1 text-xs', s.enabled ? 'btn-ghost' : 'btn-primary')} disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {toggle.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : s.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
              {s.enabled ? 'Disable' : 'Enable'}
            </button>
          </Tooltip>
          <IconButton help={H.strategy.explain} onClick={() => run.mutate()} className={btn} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
          </IconButton>
          <IconButton help={H.strategy.edit} onClick={onEdit} className={btn}>
            <Pencil className="w-4 h-4" />
          </IconButton>
          <IconButton help={H.strategy.duplicate} onClick={() => duplicate.mutate()} className={btn}>
            <Copy className="w-4 h-4" />
          </IconButton>
          <IconButton
            help={H.strategy.remove}
            onClick={() => {
              if (window.confirm(`Delete “${s.name}” with its history? This cannot be undone.`)) remove.mutate();
            }}
            className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10"
          >
            <Trash2 className="w-4 h-4" />
          </IconButton>
        </div>
      </div>
      {error && (
        <div className="mt-2 text-xs text-bear">
          {error.message}
          {error.issues?.filter((i) => i.severity === 'error').map((i) => (
            <div key={i.message}>• {i.message}</div>
          ))}
        </div>
      )}
      <div className="flex gap-3 mt-3 text-xs">
        <Tooltip content={H.strategy.units}>
          <button type="button" className={clsx('underline-offset-2 hover:underline', panel === 'units' ? 'text-accent-soft' : 'text-slate-400')} onClick={() => setPanel(panel === 'units' ? null : 'units')}>
            Strikes &amp; state
          </button>
        </Tooltip>
        {explain && (
          <Tooltip content={H.strategy.explain}>
            <button type="button" className={clsx('underline-offset-2 hover:underline', panel === 'explain' ? 'text-accent-soft' : 'text-slate-400')} onClick={() => setPanel(panel === 'explain' ? null : 'explain')}>
              Last explanation
            </button>
          </Tooltip>
        )}
      </div>
      {panel === 'units' && (
        <div className="mt-2">
          <Units strategy={s} />
        </div>
      )}
      {panel === 'explain' && explain && (
        <div className="mt-2">
          <ExplainView result={explain} />
        </div>
      )}
    </Card>
  );
}

export function StrategiesTab() {
  const [editing, setEditing] = useState<{ strategy?: McxStrategy; initial: McxStrategyDefinition } | null>(null);
  const strategies = useQuery({ queryKey: ['mcx2-strategies'], queryFn: mcxApi.strategies });
  const products = useQuery({ queryKey: ['mcx2-products'], queryFn: mcxApi.products });

  if (editing) return <StrategyEditor strategy={editing.strategy} initial={editing.initial} onClose={() => setEditing(null)} />;

  const fromTemplate = (key: string) => {
    const t = exampleStrategies().find((x) => x.key === key);
    if (!t) return;
    const d = structuredClone(t.definition);
    // The SILVER example uses a specific expiry: pick the nearest listed one.
    if (key === 'silver-hammer' && d.universe.target.kind === 'OPTION') {
      const first = products.data?.find((p) => p.symbol === 'SILVER')?.optionExpiries[0]?.expiry;
      if (first) d.universe.target.expiry = { mode: 'SPECIFIC', date: first };
    }
    setEditing({ initial: d });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={H.strategy.new}>
          <button type="button" className="btn-primary" onClick={() => setEditing({ initial: blankStrategy() })}>
            <Plus className="w-4 h-4" /> New strategy
          </button>
        </Tooltip>
        {exampleStrategies().map((t) => (
          <Tooltip key={t.key} content={{ ...H.strategy.template, title: t.label, body: t.description }}>
            <button type="button" className="btn-ghost text-xs" onClick={() => fromTemplate(t.key)}>
              <Sparkles className="w-3.5 h-3.5 text-accent-soft" /> {t.label}
            </button>
          </Tooltip>
        ))}
      </div>
      {strategies.isLoading && <Spinner />}
      {strategies.error && <p className="text-sm text-bear">{(strategies.error as Error).message}</p>}
      {strategies.data?.length === 0 && <EmptyState title="No MCX V2 strategies yet" hint="Create one, or start from an example above." />}
      {strategies.data?.map((s) => <StrategyCard key={s.id} s={s} onEdit={() => setEditing({ strategy: s, initial: s.definition })} />)}
    </div>
  );
}
