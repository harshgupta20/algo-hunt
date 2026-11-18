'use client';

/**
 * A strategy's rules — 1 When · 2 Conditions — and their validation, shared by the strategy editor (Strategies)
 * and the builder on the Backtest page (build or change a strategy, backtest it, save it if it's good).
 *
 * No legs step and no clock to set (2026-11-16): each condition picks its instrument (SPOT / FUT / CE / PE) and
 * its timeframe; the legs and the clock follow from them (tidyLegs, shared/v2/legs.ts).
 */
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import type { ExprNode, LegId, StrategyDefinition, ValidationIssue } from '@/shared/v2';
import { TIMEFRAME, clockLags, clockText, clockTimeframe, tidyLegs, withDerivedClock } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { v2Api } from '../api';
import { Cell, Section, Segmented } from '../components';
import { H } from '../help';
import { dominantSeries, legSeries } from './defaults';
import { ExpressionEditor } from './ExpressionEditor';
import { instrumentPicker } from './InstrumentPicker';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The server's check of a strategy as it is typed (debounced): errors block saving and backtesting. */
export function useStrategyValidation(def: StrategyDefinition | null) {
  const debounced = useDebounced(def, 400);
  const q = useQuery({
    queryKey: ['v2-validate', debounced],
    queryFn: () => v2Api.validateStrategy(debounced!),
    enabled: debounced !== null,
    retry: false,
    placeholderData: keepPreviousData,
  });
  // Until the check of the latest edit is back, the last answer stands.
  const issues = q.data?.issues ?? [];
  return { issues, errors: issues.filter((i) => i.severity === 'error'), checked: !!q.data, fetching: q.isFetching || def !== debounced };
}

/** Errors, then warnings — or "No problems found" once checked. */
export function IssueList({ issues, checked }: { issues: ValidationIssue[]; checked: boolean }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (!errors.length && !warnings.length) {
    return checked ? (
      <p className="flex items-center gap-1.5 text-xs text-bull">
        <CheckCircle2 className="w-3.5 h-3.5" /> No problems found
      </p>
    ) : null;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {[...errors, ...warnings].map((i) => (
        <li key={`${i.path}:${i.message}`} className={clsx('flex items-start gap-1.5 text-xs', i.severity === 'error' ? 'text-bear' : 'text-warn')}>
          {i.severity === 'error' ? <XCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />}
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Steps 1–2 of a strategy. `update` takes a function of the current definition (an instrument picked in a
 * condition and the condition reading it land in the same tick). `keep`: legs the trade plan uses (what it trades,
 * its trailing rules), kept even when no condition reads them. `plain`: light panels, for use inside another panel.
 */
export function RulesEditor({
  def,
  update,
  keep = new Set(),
  plain,
}: {
  def: StrategyDefinition;
  update: (fn: (d: StrategyDefinition) => StrategyDefinition) => void;
  keep?: Set<LegId>;
  plain?: boolean;
}) {
  const set = (patch: Partial<StrategyDefinition>) => update((d) => ({ ...d, ...patch }));
  // Every edit of the conditions brings the legs and the clock along.
  const setExpression = (expression: ExprNode) => update((d) => tidyLegs({ ...d, expression }, keep));
  const pick = instrumentPicker(def, update, keep);
  const defaultSeries = dominantSeries(def.expression, legSeries(def.legs[0]?.id ?? 'A', def.evaluation.triggerTimeframe));
  // A strategy saved when the clock was picked by hand may run on another one than its conditions call for.
  const derived = clockTimeframe(def.expression);
  const staleClock = derived && derived !== def.evaluation.triggerTimeframe ? derived : null;
  const lags = staleClock ? [] : clockLags(def.expression);

  return (
    <>
      <Section plain={plain} step="1 · When" title="When it is checked" help={H.editor.clock}>
        <div className="flex flex-wrap items-end gap-4">
          <Cell label="Mode" help={H.editor.mode}>
            <Segmented
              label="Evaluation mode"
              value={def.evaluation.mode}
              onChange={(mode) => set({ evaluation: { ...def.evaluation, mode } })}
              options={[
                { value: 'COMPLETED_CANDLE', label: 'Completed candle', help: { title: 'Completed candle', body: 'Check as each of the conditions’ candles closes, on closed candles only.' } },
                { value: 'LIVE_CANDLE', label: 'Live candle', help: { title: 'Live candle', body: 'Check every minute on forming candles (faster, but can change before the close).' } },
              ]}
            />
          </Cell>
          <Cell label="Checked" help={H.editor.clock}>
            <Tooltip content={H.editor.clock}>
              <span className="inline-flex h-7 cursor-help items-center text-xs text-slate-300">{clockText(def)}</span>
            </Tooltip>
          </Cell>
        </div>
        {def.evaluation.mode === 'COMPLETED_CANDLE' && lags.length > 0 && (
          <Tooltip content={H.editor.clockLag} className="mt-2 block">
            <p className="w-fit cursor-help text-[11px] text-slate-500">
              {lags.map((l) => `${TIMEFRAME[l.timeframe].label} candles don’t always close on a ${TIMEFRAME[def.evaluation.triggerTimeframe].label} check — such a close is picked up up to ${l.upToMinutes} min later`).join('; ')}.
            </p>
          </Tooltip>
        )}
        {staleClock && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-warn">
            Saved with a {TIMEFRAME[def.evaluation.triggerTimeframe].label} clock, chosen by hand; its conditions call for {TIMEFRAME[staleClock].label}, which the next save of its rules uses.
            <Tooltip content={H.editor.clockFix}>
              <button type="button" className="btn-ghost py-0.5 text-[11px]" onClick={() => update(withDerivedClock)}>
                Use {TIMEFRAME[staleClock].label}
              </button>
            </Tooltip>
          </p>
        )}
      </Section>

      <Section plain={plain} step="2 · Conditions" title="When should it alert?" help={H.editor.conditions}>
        <ExpressionEditor expression={def.expression} onChange={setExpression} defaultSeries={defaultSeries} legs={def.legs} onPickInstrument={pick} />
      </Section>
    </>
  );
}
