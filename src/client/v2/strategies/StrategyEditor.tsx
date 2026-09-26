'use client';

/**
 * V2 strategy editor — product-agnostic:
 *   1 Legs        1–4 placeholders (SPOT, FUT, CE / PE relative to ATM)
 *   2 When        evaluation mode + trigger timeframe
 *   3 Conditions  any leg vs any leg (or a number), AND / OR / NOT
 * with a live preview, validation and "try on a product".
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, PlayCircle, Save, X, XCircle } from 'lucide-react';
import clsx from 'clsx';
import type { ExprNode, LegId, LegKind, StrategyDefinition, V2Strategy } from '@/shared/v2';
import { TIMEFRAMES, strategySummary } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { V2ApiError, v2Api, type ExplainResult } from '../api';
import { Cell, Section, Segmented } from '../components';
import { ExplainView } from '../ExplainView';
import { H } from '../help';
import { ProductPicker } from '../ProductPicker';
import { dominantSeries, legSeries, nextLegId, usedLegs } from './defaults';
import { ExpressionEditor } from './ExpressionEditor';
import { LegsEditor } from './LegsEditor';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function StrategyEditor({ strategy, initial, onClose }: { strategy?: V2Strategy; initial: StrategyDefinition; onClose: (saved?: V2Strategy) => void }) {
  const qc = useQueryClient();
  const [def, setDef] = useState<StrategyDefinition>(initial);
  const [serverError, setServerError] = useState<V2ApiError | null>(null);
  const [tryProduct, setTryProduct] = useState<string[]>([]);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const debounced = useDebounced(def, 400);
  const validation = useQuery({ queryKey: ['v2-validate', debounced], queryFn: () => v2Api.validateStrategy(debounced), retry: false });
  const set = (patch: Partial<StrategyDefinition>) => {
    setServerError(null);
    setDef((d) => ({ ...d, ...patch }));
  };
  const used = usedLegs(def.expression);
  /** Quick add from a condition's Leg list or the one-leg hint; returns the new leg's id. */
  const addLeg = (kind: LegKind): LegId | undefined => {
    const id = nextLegId(def.legs);
    if (!id) return undefined;
    setServerError(null);
    setDef((d) => ({ ...d, legs: [...d.legs, kind === 'CE' || kind === 'PE' ? { id, kind, strikeOffset: 0 } : { id, kind }] }));
    return id;
  };
  const defaultSeries = dominantSeries(def.expression, legSeries(def.legs[0]?.id ?? 'A', def.evaluation.triggerTimeframe));

  const save = useMutation({
    mutationFn: () => (strategy ? v2Api.updateStrategy(strategy.id, def) : v2Api.createStrategy(def)),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['v2-strategies'] });
      onClose(s);
    },
    onError: (e) => setServerError(e instanceof V2ApiError ? e : new V2ApiError((e as Error).message, 0)),
  });
  const run = useMutation({ mutationFn: () => v2Api.explainDraft(def, tryProduct[0]!), onSuccess: setExplain });

  const issues = serverError?.issues ?? validation.data?.issues ?? [];
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

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
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </Tooltip>
      </div>
      <Tooltip content={H.strategy.description} className="block">
        <input aria-label="Description" className="input w-full text-xs" placeholder="Description (optional)" value={def.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} />
      </Tooltip>
      <p className="text-[11px] text-slate-500">No product is chosen here — connect the strategy to NSE indices, stocks or MCX commodities afterwards (Connections), or test it on many products (Compare).</p>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <Section step="1 · Legs" title="What the strategy watches" help={H.legs.section}>
            <LegsEditor legs={def.legs} onChange={(legs) => set({ legs })} used={used} />
          </Section>

          <Section step="2 · When" title="Evaluation clock" help={H.editor.triggerTf}>
            <div className="flex flex-wrap items-end gap-4">
              <Cell label="Mode" help={H.editor.mode}>
                <Segmented
                  label="Evaluation mode"
                  value={def.evaluation.mode}
                  onChange={(mode) => set({ evaluation: { ...def.evaluation, mode } })}
                  options={[
                    { value: 'COMPLETED_CANDLE', label: 'Completed candle', help: { title: 'Completed candle', body: 'Evaluate once when each trigger candle closes, on closed candles only.' } },
                    { value: 'LIVE_CANDLE', label: 'Live candle', help: { title: 'Live candle', body: 'Evaluate every minute on forming candles (faster, but can change before the close).' } },
                  ]}
                />
              </Cell>
              <Cell label="Trigger timeframe" help={H.editor.triggerTf}>
                <select
                  aria-label="Trigger timeframe"
                  className="input py-1 text-xs"
                  value={def.evaluation.triggerTimeframe}
                  onChange={(e) => set({ evaluation: { ...def.evaluation, triggerTimeframe: e.target.value as StrategyDefinition['evaluation']['triggerTimeframe'] } })}
                >
                  {TIMEFRAMES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Cell>
            </div>
          </Section>

          <Section step="3 · Conditions" title="When should it alert?" help={H.editor.conditions}>
            <ExpressionEditor expression={def.expression} onChange={(expression: ExprNode) => set({ expression })} defaultSeries={defaultSeries} legs={def.legs} onAddLeg={addLeg} />
          </Section>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4">
          <Section title="Preview" help={H.strategy.preview}>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300 font-mono">{strategySummary(def)}</pre>
          </Section>
          <Section title="Validation" help={H.strategy.validation} actions={validation.isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" /> : undefined}>
            {serverError && !serverError.issues && <p className="text-xs text-bear mb-2">{serverError.message}</p>}
            {errors.length === 0 && warnings.length === 0 && validation.data && (
              <p className="flex items-center gap-1.5 text-xs text-bull">
                <CheckCircle2 className="w-3.5 h-3.5" /> No problems found
              </p>
            )}
            <ul className="flex flex-col gap-1.5">
              {[...errors, ...warnings].map((i) => (
                <li key={`${i.path}:${i.message}`} className={clsx('flex items-start gap-1.5 text-xs', i.severity === 'error' ? 'text-bear' : 'text-warn')}>
                  {i.severity === 'error' ? <XCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />}
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section
            title="Try on a product"
            help={H.strategy.tryIt}
            actions={
              <Tooltip content={H.strategy.tryIt}>
                <button type="button" className="btn-ghost py-1 text-xs" disabled={run.isPending || !tryProduct.length || errors.length > 0} onClick={() => run.mutate()}>
                  {run.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />} Run
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
