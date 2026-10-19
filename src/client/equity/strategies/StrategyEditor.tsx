'use client';

/**
 * The equity strategy builder: basics, buy conditions, every way out (target, stop-loss, trailing stop, exit
 * conditions, time), pyramiding, money per buy and how orders fill — with the strategy read back in plain words
 * and checked as you type.
 */
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, LogOut, Play, Save, X } from 'lucide-react';
import type { EqStrategy, EqStrategyDefinition } from '@/shared/equity';
import { EQ_MA_TYPES, hasErrors, strategySummary, validateDefinition } from '@/shared/equity';
import { Tooltip, type TooltipContent } from '../../components/Tooltip';
import { Section, Segmented, Toggle } from '../../components/ui';
import { Cell, NumberInput } from '../../components/form';
import { InlineSpinner } from '../../components/loaders';
import { eqApi } from '../api';
import { E } from '../help';
import { GroupEditor, newGroup } from './ConditionEditor';

const numBox = 'input py-1 text-xs w-20 tabular-nums disabled:opacity-40';

/** An optional number: a checkbox switches it on (at its last / default value) or off (null). */
function Optional({ label, help, value, fallback, min, max, step, suffix, onChange }: { label: string; help: TooltipContent; value: number | null; fallback: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number | null) => void }) {
  const [last, setLast] = useState(value ?? fallback);
  return (
    <Cell label={label} help={help}>
      <Tooltip content={{ ...help, note: value === null ? 'Off — tick to switch it on.' : 'On — untick to switch it off.' }}>
        <input type="checkbox" aria-label={`${label} on`} className="accent-[rgb(var(--accent))]" checked={value !== null} onChange={(e) => onChange(e.target.checked ? last : null)} />
      </Tooltip>
      <NumberInput
        label={label}
        min={min}
        max={max}
        step={step}
        disabled={value === null}
        className={numBox}
        value={value ?? last}
        placeholder="off"
        onChange={(n) => {
          setLast(n);
          onChange(n);
        }}
      />
      {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
    </Cell>
  );
}

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
  const set = (patch: Partial<EqStrategyDefinition>) => setD((cur) => ({ ...cur, ...patch }));
  const issues = useMemo(() => validateDefinition(d), [d]);
  const blocked = hasErrors(issues);
  const summary = useMemo(() => strategySummary(d), [d]);
  const tfWord = d.timeframe === '1w' ? 'weeks' : 'days';

  const save = useMutation({
    mutationFn: (then: 'close' | 'backtest') => (strategy ? eqApi.updateStrategy(strategy.id, d) : eqApi.createStrategy(d)).then((s) => ({ s, then })),
    onSuccess: ({ s, then }) => {
      qc.invalidateQueries({ queryKey: ['eq-strategies'] });
      onSaved(s, then);
    },
  });

  const exit = d.exit;
  const setExit = (patch: Partial<EqStrategyDefinition['exit']>) => set({ exit: { ...exit, ...patch } });
  const general = issues.filter((i) => !/^entry\.|^exit\.when\./.test(i.path));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-fg">{strategy ? `Edit · ${strategy.name}` : 'New equity strategy'}</h2>
        {strategy && (
          <Tooltip content={E.list.version}>
            <span className="text-xs text-slate-500">v{strategy.version}</span>
          </Tooltip>
        )}
        <Tooltip content={E.editor.close} className="ml-auto">
          <button type="button" className="btn-ghost py-1 text-xs" onClick={onClose}>
            <X className="w-3.5 h-3.5" /> Close
          </button>
        </Tooltip>
      </div>

      <Section step="1" title="Basics" help={E.editor.timeframe}>
        <div className="flex flex-wrap items-end gap-4">
          <Cell label="Name" help={E.editor.name} className="min-w-[16rem] flex-1">
            <input aria-label="Strategy name" className="input w-full py-1.5 text-sm" value={d.name} placeholder="e.g. SMA 50 / 100 crossover" onChange={(e) => set({ name: e.target.value })} />
          </Cell>
          <Cell label="Checked on" help={E.editor.timeframe}>
            <Segmented
              label="Timeframe"
              value={d.timeframe}
              onChange={(timeframe) => set({ timeframe })}
              options={[
                { value: '1d', label: 'Daily close', help: { title: 'Daily', body: 'Check the strategy at every daily close.' } },
                { value: '1w', label: 'Weekly close', help: { title: 'Weekly', body: 'Check the strategy once a week, when the week’s candle completes (its last trading day).' } },
              ]}
            />
          </Cell>
        </div>
        <Cell label="Notes" help={E.editor.description} className="mt-3">
          <textarea aria-label="Notes" rows={2} className="input w-full py-1.5 text-xs" value={d.description ?? ''} placeholder="Optional — the idea behind it" onChange={(e) => set({ description: e.target.value || undefined })} />
        </Cell>
      </Section>

      <Section step="2" title="Buy when" help={E.editor.entry}>
        <div className="flex flex-col gap-3">
          <GroupEditor group={d.entry.when} onChange={(when) => set({ entry: { ...d.entry, when } })} tf={d.timeframe} issues={issues} path="entry" />
          <Cell label="Buy on" help={E.editor.trigger}>
            <Segmented
              label="Entry trigger"
              value={d.entry.trigger}
              onChange={(trigger) => set({ entry: { ...d.entry, trigger } })}
              options={[
                { value: 'WHEN_TRUE', label: 'Conditions true', help: { title: 'Conditions true', body: 'Buy at any check where the conditions are true and the stock isn’t held (crossings are true only at the crossing).' } },
                { value: 'BECOMES_TRUE', label: 'Turns true', help: { title: 'Turns true', body: 'Buy only at the check where the conditions become true — no re-buy while they stay true after a sale.' } },
              ]}
            />
          </Cell>
        </div>
      </Section>

      <Section step="3" title="Sell when (first of)" help={E.editor.exits}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-5">
            <Optional label="Target" help={E.editor.target} value={exit.targetPct} fallback={20} min={0.1} max={1000} step={1} suffix="%" onChange={(targetPct) => setExit({ targetPct })} />
            <Optional label="Stop-loss" help={E.editor.stopLoss} value={exit.stopLossPct} fallback={8} min={0.1} max={99} step={0.5} suffix="%" onChange={(stopLossPct) => setExit({ stopLossPct })} />
            <Optional label="Trailing stop" help={E.editor.trailing} value={exit.trailingStopPct} fallback={15} min={0.1} max={99} step={0.5} suffix="%" onChange={(trailingStopPct) => setExit({ trailingStopPct })} />
            <Cell label="Measured from" help={E.editor.priceBase}>
              <Segmented
                label="Target and stop measured from"
                value={exit.priceBase}
                onChange={(priceBase) => setExit({ priceBase })}
                options={[
                  { value: 'AVERAGE', label: 'Average price', help: { title: 'Average price', body: 'Target and stop-loss % from the average buy price (moves with each add).' } },
                  { value: 'FIRST_BUY', label: 'First buy', help: { title: 'First buy', body: 'Target and stop-loss % from the first buy’s price.' } },
                ]}
              />
            </Cell>
            <Optional label="Time exit" help={E.editor.maxBars} value={exit.maxBars} fallback={20} min={1} max={5000} step={1} suffix={tfWord} onChange={(maxBars) => setExit({ maxBars: maxBars === null ? null : Math.round(maxBars) })} />
          </div>
          {exit.when ? (
            <div className="rounded-lg border border-ink-700/60 bg-ink-950/30 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Exit conditions</span>
                <Tooltip content={E.editor.removeExit} className="ml-auto">
                  <button type="button" className="btn-ghost py-0.5 text-xs" onClick={() => setExit({ when: null })}>
                    <X className="w-3.5 h-3.5" /> Remove
                  </button>
                </Tooltip>
              </div>
              <GroupEditor group={exit.when} onChange={(when) => setExit({ when })} tf={d.timeframe} issues={issues} path="exit.when" />
            </div>
          ) : (
            <Tooltip content={E.editor.addExit}>
              <button type="button" className="btn-ghost self-start py-1 text-xs" onClick={() => setExit({ when: newGroup('OR') })}>
                <LogOut className="w-3.5 h-3.5" /> Add exit conditions
              </button>
            </Tooltip>
          )}
        </div>
      </Section>

      <Section step="4" title="Pyramiding" help={E.editor.pyramid}>
        <div className="flex flex-col gap-3">
          <Toggle checked={d.pyramid.enabled} onChange={(enabled) => set({ pyramid: { ...d.pyramid, enabled } })} label="Add a lot each time the MA reaches the last buy price (the MA becomes the stop for all lots)" help={E.editor.pyramid} />
          {d.pyramid.enabled && (
            <div className="flex flex-wrap items-end gap-5">
              <Cell label="MA" help={E.editor.pyramidMa}>
                <select aria-label="Pyramiding MA type" className="input py-1 text-xs" value={d.pyramid.maType} onChange={(e) => set({ pyramid: { ...d.pyramid, maType: e.target.value as 'SMA' } })}>
                  {EQ_MA_TYPES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <NumberInput label="Pyramiding MA period" min={2} max={500} step={1} className={numBox} value={d.pyramid.maPeriod} onChange={(n) => set({ pyramid: { ...d.pyramid, maPeriod: Math.round(n) } })} />
              </Cell>
              <Optional label="Max adds" help={E.editor.maxAdds} value={d.pyramid.maxAdds} fallback={3} min={1} max={100} step={1} onChange={(maxAdds) => set({ pyramid: { ...d.pyramid, maxAdds: maxAdds === null ? null : Math.round(maxAdds) } })} />
              <p className="max-w-xl text-[11px] leading-relaxed text-slate-500">
                Each add buys the same money per buy as the first. The stop for every lot moves to the {d.pyramid.maType}({d.pyramid.maPeriod}) value at the add, so earlier lots sit at about break-even. Checked at each {d.timeframe === '1w' ? 'weekly' : 'daily'} close, and only while the close is at or above the MA.
              </p>
            </div>
          )}
        </div>
      </Section>

      <Section step="5" title="Money & orders" help={E.editor.sizing}>
        <div className="flex flex-wrap items-end gap-5">
          <Cell label="Money per buy" help={E.editor.sizing}>
            <Segmented
              label="Sizing"
              value={d.sizing.mode}
              onChange={(mode) => set({ sizing: { mode, value: mode === 'AMOUNT' ? 50_000 : mode === 'QUANTITY' ? 10 : 10 } })}
              options={[
                { value: 'AMOUNT', label: '₹ per buy', help: { title: '₹ per buy', body: 'A fixed amount per buy, in whole shares (e.g. ₹50,000 at ₹1,234 = 40 shares).' } },
                { value: 'QUANTITY', label: 'Shares', help: { title: 'Shares per buy', body: 'A fixed number of shares per buy — the “1 lot” of a pyramid.' } },
                { value: 'PERCENT', label: '% of account', help: { title: '% of the account', body: 'This % of the account’s value (cash + holdings) at the time of each buy. Needs a starting capital.' } },
              ]}
            />
            <NumberInput
              label="Money per buy value"
              min={d.sizing.mode === 'QUANTITY' ? 1 : d.sizing.mode === 'PERCENT' ? 0.1 : 100}
              max={d.sizing.mode === 'PERCENT' ? 100 : 1e10}
              step={d.sizing.mode === 'AMOUNT' ? 1000 : 1}
              className="input py-1 text-xs w-28 tabular-nums"
              value={d.sizing.value}
              onChange={(value) => set({ sizing: { ...d.sizing, value: d.sizing.mode === 'QUANTITY' ? Math.round(value) : value } })}
            />
            <span className="text-xs text-slate-500">{d.sizing.mode === 'AMOUNT' ? '₹' : d.sizing.mode === 'QUANTITY' ? 'shares' : '%'}</span>
          </Cell>
          <Cell label="Orders fill at" help={E.editor.fill}>
            <Segmented
              label="Fill"
              value={d.execution.fill}
              onChange={(fill) => set({ execution: { ...d.execution, fill } })}
              options={[
                { value: 'NEXT_OPEN', label: 'Next open', help: { title: 'Next open', body: 'Signals at a close are filled at the next trading day’s open (what an end-of-day alert allows).' } },
                { value: 'CLOSE', label: 'Signal close', help: { title: 'Signal close', body: 'Filled at the close that signalled.' } },
              ]}
            />
          </Cell>
          <Cell label="Stops trigger on" help={E.editor.stopTrigger}>
            <Segmented
              label="Stop trigger"
              value={d.execution.stopTrigger}
              onChange={(stopTrigger) => set({ execution: { ...d.execution, stopTrigger } })}
              options={[
                { value: 'TOUCH', label: 'Any day’s low', help: { title: 'Any day’s low', body: 'Like a stop-loss order: sells when a day’s low reaches the stop (at the open on a gap).' } },
                { value: 'CLOSE', label: 'Closing basis', help: { title: 'Closing basis', body: 'Sells only when a check’s close is below the stop.' } },
              ]}
            />
          </Cell>
          <Cell label="Costs" help={E.editor.charges}>
            <Toggle checked={d.costs.charges} onChange={(charges) => set({ costs: { ...d.costs, charges } })} label="Delivery charges" help={E.editor.charges} />
            <NumberInput label="Slippage %" min={0} max={5} step={0.05} className={numBox} value={d.costs.slippagePct} onChange={(slippagePct) => set({ costs: { ...d.costs, slippagePct } })} />
            <Tooltip content={E.editor.slippage}>
              <span className="text-xs text-slate-500">% slippage</span>
            </Tooltip>
          </Cell>
        </div>
      </Section>

      <section className="card p-4">
        <Tooltip content={E.editor.readsAs}>
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Reads as</h3>
        </Tooltip>
        <ul className="flex flex-col gap-1 text-xs text-slate-300">
          {summary.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {general.length > 0 && (
          <Tooltip content={E.editor.issues} className="mt-3 block">
            <ul className="flex flex-col gap-1">
              {general.map((i) => (
                <li key={i.path + i.message} className={clsx('text-xs', i.severity === 'error' ? 'text-bear' : 'text-warn')}>
                  {i.severity === 'error' ? '✗' : '!'} {i.message}
                </li>
              ))}
            </ul>
          </Tooltip>
        )}
        {blocked && !general.some((i) => i.severity === 'error') && <p className="mt-3 text-xs text-bear">✗ Fix the conditions marked in red above.</p>}
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
      </section>
    </div>
  );
}
