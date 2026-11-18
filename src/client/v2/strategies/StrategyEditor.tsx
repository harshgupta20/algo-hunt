'use client';

/**
 * Futures & Options strategy editor — product-agnostic:
 *   1 When        evaluation mode (the clock follows the conditions' timeframes)
 *   2 Conditions  each value picks its instrument (SPOT, FUT, CE / PE at a strike) and timeframe; AND / OR / NOT
 *   3 Paper       optional simulated trades on its alerts (saved with the strategy) — may trade any instrument
 * with a live preview, validation and "try on a product".
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlayCircle, Save, X } from 'lucide-react';
import type { PaperPlan, StrategyDefinition, V2Strategy } from '@/shared/v2';
import { defaultPaperPlan, planLegs, pruneLegs, resolveRules, strategySummary } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { V2ApiError, v2Api, type ExplainResult } from '../api';
import { Section } from '../components';
import { ExplainView } from '../ExplainView';
import { H } from '../help';
import { ProductPicker } from '../ProductPicker';
import { instrumentPicker } from './InstrumentPicker';
import { IssueList, RulesEditor, useStrategyValidation } from './RulesEditor';
import { PaperPlanEditor } from './PaperPlanEditor';
import { InlineSpinner } from '../../components/loaders';

export function StrategyEditor({ strategy, initial, onClose }: { strategy?: V2Strategy; initial: StrategyDefinition; onClose: (saved?: V2Strategy) => void }) {
  const qc = useQueryClient();
  const [def, setDef] = useState<StrategyDefinition>(initial);
  const [serverError, setServerError] = useState<V2ApiError | null>(null);
  const [tryProduct, setTryProduct] = useState<string[]>([]);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [paper, setPaper] = useState<PaperPlan>(() => defaultPaperPlan(initial));
  const [paperDirty, setPaperDirty] = useState(false);
  const savedPaper = useQuery({ queryKey: ['v2-paper-plan', strategy?.id], queryFn: () => v2Api.paperPlan(strategy!.id), enabled: !!strategy });
  useEffect(() => {
    if (savedPaper.data && !paperDirty) setPaper(savedPaper.data);
  }, [savedPaper.data, paperDirty]);
  const validation = useStrategyValidation(def);
  const update = (fn: (d: StrategyDefinition) => StrategyDefinition) => {
    setServerError(null);
    setDef(fn);
  };
  const set = (patch: Partial<StrategyDefinition>) => update((d) => ({ ...d, ...patch }));
  // Legs the trade plan uses (what it trades, its trailing rules).
  const planUses = planLegs(resolveRules(def, paper.rules));
  // Kept while the conditions change: those, legs of rules whose groups are gone for now (so their letters are
  // never handed to another instrument), and — until the saved plan has loaded — every leg the strategy has.
  const savedLegs = strategy?.definition.legs.map((l) => l.id) ?? [];
  const keep = new Set([...planUses, ...planLegs(paper.rules), ...(strategy && !savedPaper.data ? savedLegs : [])]);
  const pickTrade = instrumentPicker(def, update, keep);

  const save = useMutation({
    mutationFn: async () => {
      const rules = resolveRules(def, paper.rules);
      // An instrument picked to trade and then dropped again isn't kept (an untouched strategy is saved as it was).
      const edited = !strategy || JSON.stringify(def) !== JSON.stringify(strategy.definition);
      const clean = edited ? pruneLegs(def, planLegs(rules)) : def;
      // Only the paper settings changed → no new strategy version.
      const unchanged = strategy && JSON.stringify(clean) === JSON.stringify(strategy.definition);
      const s = unchanged ? strategy : strategy ? await v2Api.updateStrategy(strategy.id, clean) : await v2Api.createStrategy(clean);
      if (paperDirty) await v2Api.savePaperPlan(s.id, { ...paper, rules: resolveRules(s.definition, rules) });
      return s;
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['v2-strategies'] });
      if (paperDirty) for (const k of ['v2-paper-plan', 'v2-paper', 'v2-paper-settings']) qc.invalidateQueries({ queryKey: [k] });
      onClose(s);
    },
    onError: (e) => setServerError(e instanceof V2ApiError ? e : new V2ApiError((e as Error).message, 0)),
  });
  const run = useMutation({ mutationFn: () => v2Api.explainDraft(def, tryProduct[0]!), onSuccess: setExplain });

  const issues = serverError?.issues ?? validation.issues;
  const errors = issues.filter((i) => i.severity === 'error');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip content={H.strategy.name} className="flex-1 min-w-[16rem]">
          <input aria-label="Strategy name" className="input text-base font-semibold w-full" value={def.name} onChange={(e) => set({ name: e.target.value })} />
        </Tooltip>
        {strategy && (
          <Tooltip content={H.strategy.version}>
            <span className="text-xs text-slate-500">editing v{strategy.version} → saves v{strategy.version + 1}</span>
          </Tooltip>
        )}
        <Tooltip content={H.strategy.close}>
          <button type="button" className="btn-ghost" onClick={() => onClose()}>
            <X className="w-4 h-4" /> Close
          </button>
        </Tooltip>
        <Tooltip content={H.strategy.save}>
          <button type="button" className="btn-primary" disabled={save.isPending || errors.length > 0} onClick={() => save.mutate()}>
            {save.isPending ? <InlineSpinner /> : <Save className="w-4 h-4" />} Save
          </button>
        </Tooltip>
      </div>
      <Tooltip content={H.strategy.description} className="block">
        <input aria-label="Description" className="input w-full text-xs" placeholder="Description (optional)" value={def.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} />
      </Tooltip>
      <p className="text-[11px] text-slate-500">No product is chosen here — connect the strategy to NSE indices, stocks or MCX commodities afterwards (Connections), or test it on many products (Compare).</p>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <RulesEditor def={def} update={update} keep={keep} />

          <Section step="3 · Paper trading" title="Simulated trades on every alert" help={H.paper.section}>
            {strategy && savedPaper.isLoading ? (
              <InlineSpinner className="w-4 h-4 text-slate-500" />
            ) : (
              <PaperPlanEditor
                def={def}
                onPickInstrument={pickTrade}
                plan={paper}
                onChange={(p) => {
                  setServerError(null);
                  setPaperDirty(true);
                  setPaper(p);
                  // An instrument picked here and dropped again (no condition reads it) leaves the strategy at once;
                  // the saved strategy's own legs stay, so a paper-only change never makes a new version.
                  setDef((d) => pruneLegs(d, [...planLegs(resolveRules(d, p.rules)), ...planLegs(p.rules), ...savedLegs]));
                }}
              />
            )}
          </Section>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4">
          <Section title="Preview" help={H.strategy.preview}>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300 font-mono">{strategySummary(def, planUses)}</pre>
          </Section>
          <Section title="Validation" help={H.strategy.validation} actions={validation.fetching ? <InlineSpinner className="w-3.5 h-3.5 text-slate-500" /> : undefined}>
            {serverError && !serverError.issues && <p className="text-xs text-bear mb-2">{serverError.message}</p>}
            <IssueList issues={issues} checked={validation.checked} />
          </Section>
          <Section
            title="Try on a product"
            help={H.strategy.tryIt}
            actions={
              <Tooltip content={H.strategy.tryIt}>
                <button type="button" className="btn-ghost py-1 text-xs" disabled={run.isPending || !tryProduct.length || errors.length > 0} onClick={() => run.mutate()}>
                  {run.isPending ? <InlineSpinner className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />} Run
                </button>
              </Tooltip>
            }
          >
            <ProductPicker selected={tryProduct} onChange={(ids) => (setTryProduct(ids), setExplain(null))} multiple={false} definition={def} compact />
            {run.error && <p className="mt-2 text-xs text-bear">{(run.error as Error).message}</p>}
            {explain && (
              <div className="mt-3">
                <ExplainView result={explain} legs={def.legs} symbol={tryProduct[0]?.split(':')[1] ?? ''} />
              </div>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
