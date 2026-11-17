'use client';

/**
 * The equity strategy's form — 1 Basics · 2 Buy when · 3 Sell when · 4 Pyramiding · 5 Money & orders — and the
 * strategy read back in plain words with its problems. Shared by the builder (Strategies) and the builder on the
 * Backtest page (build or change a strategy, backtest it unsaved, save it if it's good).
 */
import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import clsx from 'clsx';
import { LogOut, Sparkles, X } from 'lucide-react';
import type { EqStrategyDefinition } from '@/shared/equity';
import { EQ_MA_TYPES, hasErrors, orderRulesText, strategySummary, validateDefinition } from '@/shared/equity';
import { Tooltip, type TooltipContent } from '../../components/Tooltip';
import { Section, Segmented, Toggle } from '../../components/ui';
import { Cell, NumberInput } from '../../components/form';
import { E } from '../help';
import { GroupEditor, newGroup } from './ConditionEditor';
import { AI } from '../../ai/help';
import { AiFill } from '../../ai/AiFill';

const numBox = 'input py-1 text-xs w-20 tabular-nums disabled:opacity-40';
const rules = orderRulesText();
const ordersLine = rules.charAt(0).toUpperCase() + rules.slice(1);

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

/** The strategy's problems (errors block saving and backtesting). */
export function useEqIssues(d: EqStrategyDefinition) {
  const issues = useMemo(() => validateDefinition(d), [d]);
  return { issues, blocked: hasErrors(issues) };
}

/** Steps 1–5 of an equity strategy. `plain`: light panels, for use inside another panel. */
export function StrategyForm({ d, setD, plain }: { d: EqStrategyDefinition; setD: Dispatch<SetStateAction<EqStrategyDefinition>>; plain?: boolean }) {
  const set = (patch: Partial<EqStrategyDefinition>) => setD((cur) => ({ ...cur, ...patch }));
  const { issues } = useEqIssues(d);
  const tfWord = d.timeframe === '1w' ? 'weeks' : 'days';
  const exit = d.exit;
  const setExit = (patch: Partial<EqStrategyDefinition['exit']>) => set({ exit: { ...exit, ...patch } });
  // "Describe in words" open in Buy when or Sell when.
  const [aiPart, setAiPart] = useState<'entry' | 'exit' | null>(null);
  const aiButton = (part: 'entry' | 'exit') => (
    <Tooltip content={AI.fillButton}>
      <button type="button" className="btn-ghost py-0.5 text-xs" aria-pressed={aiPart === part} onClick={() => setAiPart(aiPart === part ? null : part)}>
        <Sparkles className="w-3.5 h-3.5 text-accent-soft" /> Describe in words
      </button>
    </Tooltip>
  );

  return (
    <>
      <Section plain={plain} step="1" title="Basics" help={E.editor.timeframe}>
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
                { value: '1d', label: 'Daily close', help: { title: 'Daily', body: 'Every condition, exit and the pyramiding MA use daily candles, checked at every daily close.' } },
                { value: '1w', label: 'Weekly close', help: { title: 'Weekly', body: 'Every condition, exit and the pyramiding MA use weekly candles, checked once a week when the week’s candle completes (its last trading day).' } },
              ]}
            />
          </Cell>
        </div>
        <Cell label="Notes" help={E.editor.description} className="mt-3">
          <textarea aria-label="Notes" rows={2} className="input w-full py-1.5 text-xs" value={d.description ?? ''} placeholder="Optional — the idea behind it" onChange={(e) => set({ description: e.target.value || undefined })} />
        </Cell>
      </Section>

      <Section plain={plain} step="2" title="Buy when" help={E.editor.entry} actions={aiButton('entry')}>
        <div className="flex flex-col gap-3">
          {aiPart === 'entry' && <AiFill part="entry" strategy={d} onApply={setD} onClose={() => setAiPart(null)} />}
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

      <Section plain={plain} step="3" title="Sell when (first of)" help={E.editor.exits} actions={aiButton('exit')}>
        <div className="flex flex-col gap-4">
          {aiPart === 'exit' && <AiFill part="exit" strategy={d} onApply={setD} onClose={() => setAiPart(null)} />}
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

      <Section plain={plain} step="4" title="Pyramiding" help={E.editor.pyramid}>
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

      <Section plain={plain} step="5" title="Money & orders" help={E.editor.sizing}>
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
          <Cell label="Orders" help={E.editor.orders}>
            <span className="py-1 text-xs text-slate-400">{ordersLine}</span>
          </Cell>
        </div>
      </Section>
    </>
  );
}

/** The whole strategy in plain words, with its general problems — and the caller's buttons below. */
export function ReadsAs({ d, plain, children }: { d: EqStrategyDefinition; plain?: boolean; children?: ReactNode }) {
  const { issues, blocked } = useEqIssues(d);
  const summary = useMemo(() => strategySummary(d), [d]);
  const general = issues.filter((i) => !/^entry\.|^exit\.when\./.test(i.path));
  return (
    <section className={plain ? 'rounded-lg border border-ink-700/60 bg-ink-950/30 p-3' : 'card p-4'}>
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
      {children}
    </section>
  );
}
