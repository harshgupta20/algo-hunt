import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Save, Sparkles, Rocket } from 'lucide-react';
import type { BuilderCatalog, ExpiryType, Group, StrategyDef, StrategyDefInput, StrategyScope, StrikeSelection, Timeframe } from '@ash/shared';
import { api } from '../lib/api';
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { RuleTreeEditor, newCondition, newGroup } from './builder/ConditionBuilder';
import { groupText } from '../lib/strategyText';

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

export function StrategyBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const catalogQ = useQuery({ queryKey: ['builder-catalog'], queryFn: api.builderCatalog });
  const underlyingsQ = useQuery({ queryKey: ['underlyings'], queryFn: api.underlyings });
  const metaQ = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const existingQ = useQuery({ queryKey: ['strategy', id], queryFn: () => api.getStrategy(id!), enabled: Boolean(id) });

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (form) return;
    if (id) {
      if (existingQ.data) setForm(fromDef(existingQ.data));
    } else if (catalogQ.data) {
      setForm(blankForm(catalogQ.data));
    }
  }, [id, existingQ.data, catalogQ.data, form]);

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
    onSuccess: (s) => navigate(`/library`),
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
      <PageHeader
        title={id ? 'Edit Strategy' : 'Strategy Builder'}
        subtitle="Compose a strategy from rules — it runs in live alerts and the analyzer through the same engine."
        actions={
          <div className="flex gap-2">
            {!id && (
              <button className="btn-ghost text-xs" onClick={loadTemplate}>
                <Sparkles className="w-4 h-4" /> RSI template
              </button>
            )}
            <button className="btn-ghost text-xs" onClick={() => save.mutate('draft')} disabled={save.isPending}>
              <Save className="w-4 h-4" /> Save Draft
            </button>
            <button className="btn-primary text-xs" onClick={() => save.mutate('active')} disabled={save.isPending}>
              <Rocket className="w-4 h-4" /> Publish
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-bear/30 bg-bear/10 px-4 py-2 text-sm text-bear">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Metadata</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="label">Name</label>
                <input className="input w-full" value={form.name} placeholder="e.g. Momentum Breakout" onChange={(e) => set({ name: e.target.value })} />
              </div>
              <div>
                <label className="label">Category</label>
                <input className="input w-full" value={form.category} onChange={(e) => set({ category: e.target.value })} />
              </div>
              <div>
                <label className="label">Scope</label>
                <select className="input w-full" value={form.scope} onChange={(e) => set({ scope: e.target.value as StrategyScope })}>
                  {SCOPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="label">Description</label>
                <input className="input w-full" value={form.description} onChange={(e) => set({ description: e.target.value })} />
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Scope & Context</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="label">Underlying</label>
                <select className="input w-full" value={form.underlying} onChange={(e) => set({ underlying: e.target.value })}>
                  {underlyingsQ.data?.map((u) => (
                    <option key={u.symbol} value={u.symbol}>
                      {u.symbol}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Expiry</label>
                <select className="input w-full" value={form.expiryType} onChange={(e) => set({ expiryType: e.target.value as ExpiryType })}>
                  {metaQ.data?.expiryTypes.map((x) => (
                    <option key={x.type} value={x.type}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Strike</label>
                <select className="input w-full" value={form.strikeSelection} onChange={(e) => set({ strikeSelection: e.target.value as StrikeSelection })}>
                  {metaQ.data?.strikeSelections.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Timeframe</label>
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
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Conditions</h2>
            <RuleTreeEditor root={form.root} catalog={catalogQ.data} onChange={(root) => set({ root })} />
          </Card>
        </div>

        <div>
          <Card className="sticky top-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Preview</h2>
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
