'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Sparkles, Rocket } from 'lucide-react';
import type { BuilderCatalog, ExpiryType, Group, StrategyDef, StrategyDefInput, StrategyScope, StrikeSelection, Timeframe } from '@ash/shared';
import { api } from '../lib/api';
import { Card, EmptyState, Help, Spinner } from '../components/ui';
import { RuleTreeEditor, newCondition, newGroup } from './builder/ConditionBuilder';
import { groupText } from '../lib/strategyText';
import { FieldLabel, InfoTip } from '../components/Tooltip';
import { HELP } from '../lib/help';

interface FormState {
  name: string;
  description: string;
  category: string;
  notes: string;
  scope: StrategyScope;
  underlying: string;
  expiryType: ExpiryType;
  strikeSelection: StrikeSelection;
  timeframe: Timeframe;
  root: Group;
}

function fromDef(def: StrategyDef, resetName = false): FormState {
  return {
    name: resetName ? '' : def.name,
    description: def.description ?? '',
    category: def.category ?? '',
    notes: def.notes ?? '',
    scope: def.scope,
    underlying: def.underlying,
    expiryType: def.expiryType,
    strikeSelection: def.strikeSelection,
    timeframe: def.timeframe,
    root: def.root,
  };
}

function blankForm(catalog: BuilderCatalog): FormState {
  return {
    name: '',
    description: '',
    category: 'Custom',
    notes: '',
    scope: 'options',
    underlying: 'NIFTY',
    expiryType: 'current-weekly',
    strikeSelection: 'ATM',
    timeframe: '15m',
    root: { ...newGroup('AND'), children: [newCondition(catalog)] },
  };
}

const SCOPES: Array<{ value: StrategyScope; label: string }> = [
  { value: 'options', label: 'Options' },
  { value: 'index-futures', label: 'Index Futures' },
  { value: 'stock-futures', label: 'Stock Futures' },
  { value: 'spot', label: 'Spot (soon)' },
];

export interface StrategyBuilderProps {
  /** Edit an existing strategy; omit to create a new one. */
  id?: string;
  /** Start a new strategy from the built-in RSI strategy's rules. */
  fromTemplate?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

export function StrategyBuilder({ id, fromTemplate, onSaved, onCancel }: StrategyBuilderProps) {
  const qc = useQueryClient();
  const catalogQ = useQuery({ queryKey: ['builder-catalog'], queryFn: api.builderCatalog });
  const templateQ = useQuery({ queryKey: ['builder-template'], queryFn: api.builderTemplate, enabled: Boolean(fromTemplate && !id) });
  const underlyingsQ = useQuery({ queryKey: ['underlyings'], queryFn: api.underlyings });
  const metaQ = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const existingQ = useQuery({ queryKey: ['strategy', id], queryFn: () => api.getStrategy(id!), enabled: Boolean(id) });

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (form) return;
    if (id) {
      if (existingQ.data) setForm(fromDef(existingQ.data));
    } else if (fromTemplate) {
      if (templateQ.data) setForm(fromDef(templateQ.data, true));
    } else if (catalogQ.data) {
      setForm(blankForm(catalogQ.data));
    }
  }, [id, fromTemplate, existingQ.data, templateQ.data, catalogQ.data, form]);

  const save = useMutation({
    mutationFn: async (status: 'draft' | 'active') => {
      if (!form) throw new Error('not ready');
      if (!form.name.trim()) throw new Error('Name is required');
      const input: StrategyDefInput = {
        name: form.name,
        description: form.description || undefined,
        category: form.category || undefined,
        notes: form.notes || undefined,
        scope: form.scope,
        underlying: form.underlying,
        expiryType: form.expiryType,
        strikeSelection: form.strikeSelection,
        timeframe: form.timeframe,
        root: form.root,
        status,
      };
      return id ? api.updateStrategy(id, input) : api.createStrategy(input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['strategies-custom'] });
      if (id) void qc.invalidateQueries({ queryKey: ['strategy', id] });
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });

  const loadTemplate = async () => {
    const t = await api.builderTemplate();
    setForm(fromDef(t, true));
  };

  if (!form || !catalogQ.data) return <Spinner label="Loading builder…" />;

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Help content={HELP.builder.back}>
            <button className="btn-ghost text-xs" onClick={onCancel}>
              <ArrowLeft className="w-4 h-4" /> Library
            </button>
          </Help>
          <h2 className="text-fg font-semibold">{id ? `Edit · ${existingQ.data?.name ?? ''}` : 'New strategy'}</h2>
        </div>
        <div className="flex gap-2">
          {!id && (
            <Help content={HELP.builder.template}>
              <button className="btn-ghost text-xs" onClick={loadTemplate}>
                <Sparkles className="w-4 h-4" /> RSI template
              </button>
            </Help>
          )}
          <Help content={HELP.builder.saveDraft}>
            <button className="btn-ghost text-xs" onClick={() => save.mutate('draft')} disabled={save.isPending}>
              <Save className="w-4 h-4" /> Save draft
            </button>
          </Help>
          <Help content={HELP.builder.publish}>
            <button className="btn-primary text-xs" onClick={() => save.mutate('active')} disabled={save.isPending}>
              <Rocket className="w-4 h-4" /> Publish
            </button>
          </Help>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-bear/30 bg-bear/10 px-4 py-2 text-sm text-bear">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Metadata</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <FieldLabel help={HELP.builder.name}>Name</FieldLabel>
                <input className="input w-full" value={form.name} placeholder="e.g. Momentum Breakout" onChange={(e) => set({ name: e.target.value })} />
              </div>
              <div>
                <FieldLabel help={HELP.builder.category}>Category</FieldLabel>
                <input className="input w-full" value={form.category} onChange={(e) => set({ category: e.target.value })} />
              </div>
              <div>
                <FieldLabel help={HELP.builder.scope}>Scope</FieldLabel>
                <select className="input w-full" value={form.scope} onChange={(e) => set({ scope: e.target.value as StrategyScope })}>
                  {SCOPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <FieldLabel help={HELP.builder.description}>Description</FieldLabel>
                <input className="input w-full" value={form.description} onChange={(e) => set({ description: e.target.value })} />
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
              Scope & Context <InfoTip content={HELP.builder.context} />
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <FieldLabel help={HELP.field.underlying}>Underlying</FieldLabel>
                <select className="input w-full" value={form.underlying} onChange={(e) => set({ underlying: e.target.value })}>
                  {underlyingsQ.data?.map((u) => (
                    <option key={u.symbol} value={u.symbol}>
                      {u.symbol}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel help={HELP.field.expiry}>Expiry</FieldLabel>
                <select className="input w-full" value={form.expiryType} onChange={(e) => set({ expiryType: e.target.value as ExpiryType })}>
                  {metaQ.data?.expiryTypes.map((x) => (
                    <option key={x.type} value={x.type}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel help={HELP.field.strike}>Strike</FieldLabel>
                <select className="input w-full" value={form.strikeSelection} onChange={(e) => set({ strikeSelection: e.target.value as StrikeSelection })}>
                  {metaQ.data?.strikeSelections.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel help={HELP.field.timeframe}>Timeframe</FieldLabel>
                <select className="input w-full" value={form.timeframe} onChange={(e) => set({ timeframe: e.target.value as Timeframe })}>
                  {metaQ.data?.timeframes.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
              Conditions <InfoTip content={HELP.builder.conditions} />
            </h2>
            <RuleTreeEditor root={form.root} catalog={catalogQ.data} onChange={(root) => set({ root })} />
          </Card>
        </div>

        <div>
          <Card className="sticky top-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 mb-3">
              Preview <InfoTip content={HELP.builder.preview} />
            </h2>
            {form.root.children.length === 0 ? (
              <EmptyState title="No conditions" hint="Add conditions to see a readable summary." />
            ) : (
              <pre className="whitespace-pre-wrap text-sm text-slate-200 font-mono leading-relaxed">{groupText(form.root)}</pre>
            )}
            <div className="mt-4 pt-3 border-t border-ink-700/60 text-xs text-slate-500 space-y-1">
              <div>Underlying: <span className="text-slate-300">{form.underlying}</span></div>
              <div>Strike: <span className="text-slate-300">{form.strikeSelection}</span> · {form.expiryType}</div>
              <div>Timeframe: <span className="text-slate-300">{form.timeframe}</span></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
