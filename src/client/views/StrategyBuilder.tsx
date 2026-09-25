'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Sparkles, Rocket } from 'lucide-react';
import clsx from 'clsx';
import type { BuilderCatalog, ExpiryType, Group, StrategyDef, StrategyDefInput, StrategyMarket, Timeframe } from '@ash/shared';
import { UNDERLYINGS, describeFixed, describeOpen, fixedUnderlyings, isSpecific } from '@ash/shared';
import { MarketBadge } from '../components/market';
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
  market: StrategyMarket;
  root: Group;
}

function fromDef(def: StrategyDef, resetName = false): FormState {
  return {
    name: resetName ? '' : def.name,
    description: def.description ?? '',
    category: def.category ?? '',
    notes: def.notes ?? '',
    market: def.market ?? {},
    root: def.root,
  };
}

/** New strategies default to a common pro setup: any underlying, weekly ATM, 15-minute candles. */
function blankForm(catalog: BuilderCatalog): FormState {
  return {
    name: '',
    description: '',
    category: 'Custom',
    notes: '',
    market: { expiryType: 'current-weekly', strikeSelection: 'ATM', timeframe: '15m' },
    root: { ...newGroup('AND'), children: [newCondition(catalog)] },
  };
}

const ANY = '';

/** The "Applies to" section: fix each market field, or leave it open for runs to choose. */
function AppliesTo({ market, onChange }: { market: StrategyMarket; onChange: (m: StrategyMarket) => void }) {
  const metaQ = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const groupsQ = useQuery({ queryKey: ['groups'], queryFn: api.listGroups });
  const chosen = fixedUnderlyings(market);
  const set = (patch: Partial<StrategyMarket>) => {
    const next = { ...market, ...patch };
    // Drop open (undefined / empty) fields so the stored profile stays minimal.
    for (const k of Object.keys(next) as Array<keyof StrategyMarket>) {
      const v = next[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete next[k];
    }
    onChange(next);
  };
  const toggle = (sym: string) => set({ underlyings: chosen.includes(sym) ? chosen.filter((x) => x !== sym) : [...chosen, sym] });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300">
          Applies to <InfoTip content={HELP.market.appliesTo} />
        </h2>
        <MarketBadge market={market} compact />
      </div>

      <FieldLabel help={HELP.market.underlyings}>Underlyings</FieldLabel>
      <div className="flex flex-wrap items-center gap-1.5">
        <Help content={{ title: 'All underlyings', body: 'Universal across underlyings — choose one (or a group) each time you run it.' }}>
          <button
            type="button"
            aria-pressed={chosen.length === 0}
            onClick={() => set({ underlyings: [] })}
            className={clsx(
              'rounded-md px-2.5 py-1 text-xs border font-medium',
              chosen.length === 0 ? 'bg-accent text-white border-accent' : 'bg-ink-800 border-ink-700 text-slate-400',
            )}
          >
            All
          </button>
        </Help>
        {UNDERLYINGS.map((u) => (
          <Help
            key={u.symbol}
            content={{
              title: `${u.symbol} — ${u.name}`,
              body: chosen.includes(u.symbol) ? 'Included. Click to remove.' : 'Click to fix the strategy to this underlying (pick several for a basket).',
              note: `${u.kind === 'index' ? 'Index' : 'Stock'} · ${u.derivativeExchange} · strikes every ${u.strikeInterval}`,
            }}
          >
            <button
              type="button"
              aria-pressed={chosen.includes(u.symbol)}
              onClick={() => toggle(u.symbol)}
              className={clsx(
                'rounded-md px-2.5 py-1 text-xs border',
                chosen.includes(u.symbol) ? 'bg-accent/20 border-accent/40 text-accent-soft font-semibold' : 'bg-ink-800 border-ink-700 text-slate-400',
              )}
            >
              {u.symbol}
            </button>
          </Help>
        ))}
        {(groupsQ.data?.length ?? 0) > 0 && (
          <Help content={{ title: 'Use a group', body: 'Fill the underlyings from a saved group (e.g. Indices). You can still adjust them after.' }}>
            <select
              className="input py-1 text-xs"
              value=""
              aria-label="Use a group"
              onChange={(e) => {
                const g = groupsQ.data?.find((x) => x.id === e.target.value);
                if (g) set({ underlyings: g.members });
              }}
            >
              <option value="">Use a group…</option>
              {groupsQ.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.members.length})
                </option>
              ))}
            </select>
          </Help>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <div>
          <FieldLabel help={HELP.field.expiry}>Expiry</FieldLabel>
          <select className="input w-full" value={market.expiryType ?? ANY} onChange={(e) => set({ expiryType: (e.target.value || undefined) as ExpiryType | undefined })}>
            <option value={ANY}>Any — choose when running</option>
            {metaQ.data?.expiryTypes.map((x) => (
              <option key={x.type} value={x.type}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel help={{ ...HELP.field.strike, note: 'A fixed strike price (CUSTOM) is chosen per run, since it depends on the underlying.' }}>Strike</FieldLabel>
          <select
            className="input w-full"
            value={market.strikeSelection ?? ANY}
            onChange={(e) => set({ strikeSelection: (e.target.value || undefined) as StrategyMarket['strikeSelection'] })}
          >
            <option value={ANY}>Any — choose when running</option>
            {metaQ.data?.strikeSelections
              .filter((x) => x !== 'CUSTOM')
              .map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
          </select>
        </div>
        <div>
          <FieldLabel help={HELP.field.timeframe}>Timeframe</FieldLabel>
          <select className="input w-full" value={market.timeframe ?? ANY} onChange={(e) => set({ timeframe: (e.target.value || undefined) as Timeframe | undefined })}>
            <option value={ANY}>Any — choose when running</option>
            {metaQ.data?.timeframes.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        className={clsx(
          'mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed',
          isSpecific(market) ? 'border-accent/30 bg-accent/5 text-slate-300' : 'border-ink-700 bg-ink-850 text-slate-400',
        )}
      >
        {isSpecific(market) ? (
          <>
            <span className="font-semibold text-accent-soft">Specific.</span> Runs exactly on <span className="text-slate-200">{describeFixed(market)}</span>.
            Backtests only ask for a date range{chosen.length > 1 ? '; creating monitors adds one per underlying' : '; creating a monitor is one click'}.
          </>
        ) : (
          <>
            <span className="font-semibold text-slate-200">Universal.</span> {describeFixed(market) ? <>Fixed: <span className="text-slate-200">{describeFixed(market)}</span>. </> : null}
            Backtests and monitors will ask for the <span className="text-slate-200">{describeOpen(market)}</span>.
          </>
        )}
      </div>
    </Card>
  );
}

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
        market: form.market,
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
                <FieldLabel help={HELP.builder.description}>Description</FieldLabel>
                <input className="input w-full" value={form.description} onChange={(e) => set({ description: e.target.value })} />
              </div>
            </div>
          </Card>

          <AppliesTo market={form.market} onChange={(market) => set({ market })} />

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
            <div className="mt-4 pt-3 border-t border-ink-700/60">
              <MarketBadge market={form.market} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
