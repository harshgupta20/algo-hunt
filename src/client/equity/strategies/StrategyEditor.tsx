'use client';

/**
 * The equity strategy builder: basics (one timeframe for everything), buy conditions, every way out (target,
 * stop-loss, trailing stop, exit conditions, time), pyramiding and money per buy — with the strategy read back in
 * plain words and checked as you type. How orders fill is the same for every strategy (shown, not chosen).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Play, Save, Sparkles, X } from 'lucide-react';
import type { EqStrategy, EqStrategyDefinition } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { InlineSpinner } from '../../components/loaders';
import { eqApi } from '../api';
import { E } from '../help';
import { ReadsAs, StrategyForm, useEqIssues } from './StrategyForm';
import { ai } from '../../ai/store';
import { AI } from '../../ai/help';

export function StrategyEditor({
  strategy,
  initial,
  onClose,
  onSaved,
  onTestDraft,
}: {
  strategy?: EqStrategy;
  initial: EqStrategyDefinition;
  onClose: () => void;
  onSaved: (s: EqStrategy, then: 'close' | 'backtest') => void;
  onTestDraft: (d: EqStrategyDefinition) => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<EqStrategyDefinition>(initial);
  const { blocked } = useEqIssues(d);

  const save = useMutation({
    mutationFn: (then: 'close' | 'backtest') => (strategy ? eqApi.updateStrategy(strategy.id, d) : eqApi.createStrategy(d)).then((s) => ({ s, then })),
    onSuccess: ({ s, then }) => {
      qc.invalidateQueries({ queryKey: ['eq-strategies'] });
      onSaved(s, then);
    },
  });

  // The AI sees the strategy as it is on screen (saved or not).
  useEffect(() => {
    ai.setPage({ page: 'equity-builder', label: `Builder: ${d.name.trim() || 'new strategy'}${strategy ? ` (saved v${strategy.version}${JSON.stringify(d) === JSON.stringify(strategy.definition) ? '' : ', changed'})` : ' (unsaved)'}`, draft: d, ...(strategy ? { strategyId: strategy.id } : {}) });
  }, [d, strategy]);
  useEffect(() => () => ai.setPage(null), []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-fg">{strategy ? `Edit · ${strategy.name}` : 'New equity strategy'}</h2>
        {strategy && (
          <Tooltip content={E.list.version}>
            <span className="text-xs text-slate-500">v{strategy.version}</span>
          </Tooltip>
        )}
        <Tooltip content={AI.describe} className="ml-auto">
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => ai.open()}>
            <Sparkles className="w-3.5 h-3.5" /> Describe it to AI
          </button>
        </Tooltip>
        <Tooltip content={E.editor.close}>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={onClose}>
            <X className="w-3.5 h-3.5" /> Close
          </button>
        </Tooltip>
      </div>

      <StrategyForm d={d} setD={setD} />

      <ReadsAs d={d}>
        <div className="mt-4 flex flex-wrap gap-2">
          <Tooltip content={E.editor.save}>
            <button type="button" className="btn-primary" disabled={blocked || save.isPending} onClick={() => save.mutate('close')}>
              {save.isPending ? <InlineSpinner /> : <Save className="w-4 h-4" />} Save
            </button>
          </Tooltip>
          <Tooltip content={E.editor.saveAndTest}>
            <button type="button" className="btn-ghost" disabled={blocked || save.isPending} onClick={() => save.mutate('backtest')}>
              <FlaskConical className="w-4 h-4" /> Save &amp; backtest
            </button>
          </Tooltip>
          <Tooltip content={E.editor.testDraft}>
            <button type="button" className="btn-ghost" disabled={blocked} onClick={() => onTestDraft(d)}>
              <Play className="w-4 h-4" /> Backtest without saving
            </button>
          </Tooltip>
        </div>
        {save.error && <p className="mt-2 text-xs text-bear">{(save.error as Error).message}</p>}
      </ReadsAs>
    </div>
  );
}
