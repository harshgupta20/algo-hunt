'use client';

/**
 * MCX V2 strategy editor, in the order a trader thinks:
 *   1 WHAT + WHERE — product, contracts (expiry, CE/PE, strikes), reference future
 *   2 WHEN         — evaluation mode + trigger timeframe (the clock)
 *   3 CONDITIONS   — AND / OR / NOT tree of conditions and patterns
 *   4 ALERT        — channels, transition vs while-true, cooldown, once per candle
 * with a live preview, validation, resolved contracts, "test now" and replay.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, History, Loader2, PlayCircle, Save, X, XCircle } from 'lucide-react';
import clsx from 'clsx';
import type { ExprNode, McxStrategy, McxStrategyDefinition } from '@/shared/mcx';
import { MCX2_TIMEFRAMES, strategySummary } from '@/shared/mcx';
import { Tooltip } from '../../components/Tooltip';
import { Spinner } from '../../components/ui';
import { McxApiError, mcxApi, type ExplainResult, type ReplayResult } from '../api';
import { Cell, Section, Segmented, Toggle } from '../components';
import { istToday } from '../format';
import { H } from '../help';
import { ExplainView, ReplayView } from './DebugViews';
import { dominantSeries, targetSeries } from './defaults';
import { ExpressionEditor } from './ExpressionEditor';
import { ResolvedInstruments, UniverseEditor } from './UniverseEditor';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const daysAgo = (n: number) => new Date(Date.now() + 330 * 60_000 - n * 86_400_000).toISOString().slice(0, 10);

export function StrategyEditor({ strategy, initial, onClose }: { strategy?: McxStrategy; initial: McxStrategyDefinition; onClose: (saved?: McxStrategy) => void }) {
  const qc = useQueryClient();
  const [def, setDef] = useState<McxStrategyDefinition>(initial);
  const [serverIssues, setServerIssues] = useState<McxApiError | null>(null);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [range, setRange] = useState({ from: daysAgo(2), to: istToday() });
  const products = useQuery({ queryKey: ['mcx2-products'], queryFn: mcxApi.products });
  const debounced = useDebounced(def, 500);
  const validation = useQuery({ queryKey: ['mcx2-validate', debounced], queryFn: () => mcxApi.validate(debounced), retry: false });
  const set = (patch: Partial<McxStrategyDefinition>) => {
    setServerIssues(null);
    setDef((d) => ({ ...d, ...patch }));
  };

  const product = products.data?.find((p) => p.symbol === def.universe.underlying);
  const fixedOptions = useMemo(() => (product?.futures ?? []).map((f) => ({ id: f.id, symbol: f.symbol })), [product]);
  const defaultSeries = dominantSeries(def.expression, targetSeries(def.evaluation.triggerTimeframe));

  const save = useMutation({
    mutationFn: () => (strategy ? mcxApi.updateStrategy(strategy.id, def) : mcxApi.createStrategy(def)),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['mcx2-strategies'] });
      onClose(s);
    },
    onError: (e) => setServerIssues(e instanceof McxApiError ? e : new McxApiError((e as Error).message, 0)),
  });
  const test = useMutation({ mutationFn: () => mcxApi.explainDraft(def), onSuccess: setExplain });
  const runReplay = useMutation({ mutationFn: () => mcxApi.replay({ definition: def, from: range.from, to: range.to }), onSuccess: setReplay });

  const issues = serverIssues?.issues ?? validation.data?.issues ?? [];
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const live = def.evaluation.mode === 'LIVE_CANDLE';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Strategy name" className="input text-base font-semibold flex-1 min-w-[16rem]" value={def.name} onChange={(e) => set({ name: e.target.value })} />
        {strategy && (
          <Tooltip content={H.strategy.version}>
            <span className="text-xs text-slate-500">editing v{strategy.version} → saves v{strategy.version + 1}</span>
          </Tooltip>
        )}
        <Tooltip content={H.editor.cancel}>
          <button type="button" className="btn-ghost" onClick={() => onClose()}>
            <X className="w-4 h-4" /> Close
          </button>
        </Tooltip>
        <Tooltip content={H.editor.save}>
          <button type="button" className="btn-primary" disabled={save.isPending || errors.length > 0} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </Tooltip>
      </div>
      <Tooltip content={H.editor.description} className="block">
        <input aria-label="Description" className="input w-full text-xs" placeholder="Description (optional)" value={def.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} />
      </Tooltip>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <Section step="1 · What & where" title="Product and contracts" help={H.editor.product}>
            {products.isLoading ? <Spinner /> : <UniverseEditor value={def.universe} onChange={(universe) => set({ universe })} products={products.data ?? []} />}
            <div className="mt-3">
              <ResolvedInstruments universe={def.universe} />
            </div>
          </Section>

          <Section step="2 · When" title="Evaluation clock" help={H.editor.triggerTf}>
            <div className="flex flex-wrap items-end gap-4">
              <Cell label="Mode" help={H.editor.mode}>
                <Segmented
                  label="Evaluation mode"
                  value={def.evaluation.mode}
                  onChange={(mode) => set({ evaluation: { ...def.evaluation, mode }, alert: mode === 'COMPLETED_CANDLE' ? { ...def.alert, oncePerCandle: true } : def.alert })}
                  options={[
                    { value: 'COMPLETED_CANDLE', label: 'Completed candle', help: { title: 'Completed candle', body: 'Evaluate once when each trigger candle closes, on closed candles only (no repainting).' } },
                    { value: 'LIVE_CANDLE', label: 'Live candle', help: { title: 'Live candle', body: 'Evaluate every minute on forming candles. Faster, but a signal can disappear before the candle closes.' } },
                  ]}
                />
              </Cell>
              <Cell label="Trigger timeframe" help={H.editor.triggerTf}>
                <select
                  aria-label="Trigger timeframe"
                  className="input py-1 text-xs"
                  value={def.evaluation.triggerTimeframe}
                  onChange={(e) => set({ evaluation: { ...def.evaluation, triggerTimeframe: e.target.value as McxStrategyDefinition['evaluation']['triggerTimeframe'] } })}
                >
                  {MCX2_TIMEFRAMES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Cell>
            </div>
          </Section>

          <Section step="3 · Conditions" title="When should it fire?" help={H.editor.group}>
            <ExpressionEditor definition={def} onChange={(expression: ExprNode) => set({ expression })} defaultSeries={defaultSeries} fixedOptions={fixedOptions} />
          </Section>

          <Section step="4 · Alert" title="Alert policy" help={H.editor.channels}>
            <div className="flex flex-wrap items-end gap-5">
              <Cell label="Channels" help={H.editor.channels}>
                <Toggle checked={def.alert.channels.telegram} onChange={(v) => set({ alert: { ...def.alert, channels: { ...def.alert.channels, telegram: v } } })} label="Telegram" help={{ title: 'Telegram', body: 'Send to the Telegram chat set in Settings.' }} />
                <Toggle checked={def.alert.channels.email} onChange={(v) => set({ alert: { ...def.alert, channels: { ...def.alert.channels, email: v } } })} label="Email" help={{ title: 'Email', body: 'Send to the email recipients set in Settings (via Resend).' }} />
              </Cell>
              <Cell label="Alert when" help={H.editor.trigger}>
                <Segmented
                  label="Alert trigger"
                  value={def.alert.trigger}
                  onChange={(trigger) => set({ alert: { ...def.alert, trigger } })}
                  options={[
                    { value: 'ON_TRANSITION', label: 'Becomes true', help: { title: 'Becomes true', body: 'Alert on the first trigger candle the strategy turns true after being false.' } },
                    { value: 'WHILE_TRUE', label: 'While true', help: { title: 'While true', body: 'Alert on every trigger candle the strategy is true (limited by the cooldown).' } },
                  ]}
                />
              </Cell>
              <Cell label="Cooldown (min)" help={H.editor.cooldown}>
                <input
                  type="number"
                  min={0}
                  aria-label="Cooldown minutes"
                  className="input py-1 text-xs w-20"
                  value={def.alert.cooldownMinutes ?? 0}
                  onChange={(e) => {
                    const m = Math.round(Number(e.target.value));
                    set({ alert: { ...def.alert, cooldownMinutes: m > 0 ? m : null } });
                  }}
                />
              </Cell>
              <Cell label="Repeats" help={H.editor.oncePerCandle}>
                <Toggle
                  checked={def.alert.oncePerCandle}
                  disabled={!live}
                  onChange={(v) => set({ alert: { ...def.alert, oncePerCandle: v } })}
                  label="Once per candle"
                  help={H.editor.oncePerCandle}
                />
              </Cell>
            </div>
          </Section>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4">
          <Section title="Preview" help={H.editor.preview}>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300 font-mono">{strategySummary(def)}</pre>
          </Section>
          <Section
            title="Validation"
            help={H.editor.validation}
            actions={validation.isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" /> : undefined}
          >
            {serverIssues && !serverIssues.issues && <p className="text-xs text-bear mb-2">{serverIssues.message}</p>}
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
            title="Test now"
            help={H.editor.testNow}
            actions={
              <Tooltip content={H.editor.testNow}>
                <button type="button" className="btn-ghost py-1 text-xs" disabled={test.isPending} onClick={() => test.mutate()}>
                  {test.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />} Run
                </button>
              </Tooltip>
            }
          >
            {test.error && <p className="text-xs text-bear">{(test.error as Error).message}</p>}
            {explain ? <ExplainView result={explain} /> : <p className="text-xs text-slate-500">Evaluate the current editor contents against live data.</p>}
          </Section>
          <Section
            title="Replay"
            help={H.strategy.replay}
            actions={
              <Tooltip content={H.strategy.replay}>
                <button type="button" className="btn-ghost py-1 text-xs" disabled={runReplay.isPending} onClick={() => runReplay.mutate()}>
                  {runReplay.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />} Replay
                </button>
              </Tooltip>
            }
          >
            <div className="flex items-center gap-2 mb-2">
              <Tooltip content={{ title: 'From', body: 'First trading day to replay (IST).' }}>
                <input type="date" aria-label="Replay from" className="input py-1 text-xs" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              </Tooltip>
              <span className="text-xs text-slate-500">to</span>
              <Tooltip content={{ title: 'To', body: 'Last trading day to replay (IST).' }}>
                <input type="date" aria-label="Replay to" className="input py-1 text-xs" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              </Tooltip>
            </div>
            {runReplay.error && <p className="text-xs text-bear">{(runReplay.error as Error).message}</p>}
            {replay && <ReplayView result={replay} />}
          </Section>
        </aside>
      </div>
    </div>
  );
}
