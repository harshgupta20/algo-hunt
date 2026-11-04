'use client';

/**
 * Paper-trading settings shared by the strategy editor (the strategy's defaults), each connection (its own values
 * over the strategy's) and the backtest pages (the same plan, tried out): size, target / stop-loss / trailing stop,
 * watch window, square-off, other group, costs. With `base`, a value that differs from it is marked "own" with a ↺
 * to go back to the strategy's.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Crosshair, Receipt, RotateCcw, Save, X, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import type { PaperOverride, PaperOverrideKey, PaperPlan } from '@/shared/v2';
import { PAPER_DEFAULTS, diffOverride, effectivePlan, planConditions, trailingIssue, watchWindowIssue } from '@/shared/v2';
import { Tooltip, type TooltipContent } from '../../components/Tooltip';
import { InlineSpinner } from '../../components/loaders';
import { v2Api } from '../api';
import { NumberInput, Toggle } from '../components';
import { H } from '../help';
import { inr } from './money';


/**
 * A block of the trade plan: icon + title (explained on hover) + its settings. Shared with "What to trade" and the
 * trailing rules, so the whole plan reads as a few titled blocks.
 */
export function PlanBlock({ icon: Icon, title, help, aside, children, className }: { icon: LucideIcon; title: string; help: TooltipContent; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('flex min-w-0 flex-col rounded-lg border border-ink-700 bg-ink-900', className)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-700/70 px-3 py-2">
        <Icon aria-hidden className="h-4 w-4 shrink-0 text-accent-soft" />
        <Tooltip content={help}>
          <h4 className="cursor-help text-[13px] font-semibold text-fg">{title}</h4>
        </Tooltip>
        {aside && <div className="ml-auto flex flex-wrap items-center gap-2">{aside}</div>}
      </header>
      <div className="flex flex-col gap-2 p-3">{children}</div>
    </section>
  );
}

/** One setting: a label column (explained on hover; "own ↺" when it differs from the strategy's) and its controls. */
function Field({ label, help, own, onReset, children }: { label: string; help: TooltipContent; own?: boolean; onReset?: () => void; children: ReactNode }) {
  return (
    <div className={clsx('-mx-1.5 grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-x-2 rounded-md px-1.5 py-0.5', own && 'bg-accent/5 ring-1 ring-accent/30')}>
      <span className="flex flex-col items-start leading-tight">
        <Tooltip content={help}>
          <span className="cursor-help text-[12px] font-medium text-slate-400 underline decoration-slate-600 decoration-dotted underline-offset-2">{label}</span>
        </Tooltip>
        {own && onReset && (
          <Tooltip content={H.paper.own}>
            <button type="button" aria-label={`${label}: use the strategy's value`} onClick={onReset} className="inline-flex items-center gap-0.5 text-[11px] text-accent-soft hover:underline">
              own <RotateCcw className="w-3 h-3" />
            </button>
          </Tooltip>
        )}
      </span>
      <div className="flex min-h-[30px] min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A % with an on/off tick (off = none); `required` = it can't be ticked off. */
function PctField({ label, value, fallback, max, required, onChange }: { label: string; value: number | null; fallback: number; max: number; required?: boolean; onChange: (v: number | null) => void }) {
  return (
    <>
      <Tooltip content={{ ...H.paper.pctOn, title: `${label.replace(' %', '')}: ${value === null ? 'off' : 'on'}`, note: required && value !== null ? 'Needed while Trailing SL is on — trailing starts there.' : undefined }}>
        <input type="checkbox" aria-label={`${label} on`} className="accent-[rgb(var(--accent))] disabled:opacity-40" checked={value !== null} disabled={required && value !== null} onChange={(e) => onChange(e.target.checked ? fallback : null)} />
      </Tooltip>
      <NumberInput label={label} min={0.1} max={max} step={1} disabled={value === null} className="input py-1 text-xs w-20 tabular-nums disabled:opacity-40" value={value} placeholder="none" onChange={onChange} />
      <span className="text-xs text-slate-400">%</span>
    </>
  );
}

/** A from–until pair of times. */
function TimeRange({ label, from, to, onFrom, onTo }: { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <>
      <input aria-label={`${label} from`} type="time" className="input py-1 text-xs" value={from} onChange={(e) => e.target.value && onFrom(e.target.value)} />
      <span className="text-xs text-slate-500">–</span>
      <input aria-label={`${label} until`} type="time" className="input py-1 text-xs" value={to} onChange={(e) => e.target.value && onTo(e.target.value)} />
    </>
  );
}

/**
 * Where a trade closes, drawn: stop-loss (loss side) ◄ entry ► target (profit side) → trailing rules. The two sides
 * are sized by their %, so a −15 % stop with a +40 % target looks like one.
 */
function TradePath({ stopPct, targetPct, trailing }: { stopPct: number | null; targetPct: number | null; trailing: boolean }) {
  const w = (pct: number | null) => Math.max(pct ?? 10, 6);
  const trail = trailing && targetPct !== null;
  return (
    <Tooltip content={H.paper.tradePath} className="block">
      <div className="cursor-help rounded-md border border-ink-700/70 bg-ink-850 px-3 pb-2 pt-2.5">
        <div className="flex h-2 items-stretch overflow-hidden rounded-full">
          <div style={{ flexGrow: w(stopPct) }} className={stopPct === null ? 'bg-ink-700' : 'bg-bear/70'} />
          <div className="w-1 bg-fg" />
          <div style={{ flexGrow: w(targetPct) }} className={targetPct === null ? 'bg-ink-700' : trail ? 'bg-bull/50' : 'bg-bull/70'} />
          {trail && <div style={{ flexGrow: w(targetPct) * 0.7 }} className="bg-gradient-to-r from-accent/70 to-accent/5" />}
        </div>
        <div className="mt-1.5 flex text-[11px] leading-tight">
          <div style={{ flexGrow: w(stopPct) }} className="flex justify-between gap-2 pr-1">
            <span className={stopPct === null ? 'text-slate-500' : 'font-semibold text-bear'}>{stopPct === null ? 'No stop-loss' : `−${stopPct}% stop-loss`}</span>
            <span className="font-semibold text-fg">Entry</span>
          </div>
          <div style={{ flexGrow: w(targetPct) }} className="flex justify-end pl-1">
            <span className={targetPct === null ? 'text-slate-500' : 'font-semibold text-bull'}>{targetPct === null ? 'No target' : trail ? `+${targetPct}% trailing starts` : `+${targetPct}% target`}</span>
          </div>
          {trail && (
            <div style={{ flexGrow: w(targetPct) * 0.7 }} className="flex justify-end pl-1">
              <span className="font-semibold text-accent-soft">trailing rules →</span>
            </div>
          )}
        </div>
      </div>
    </Tooltip>
  );
}

/**
 * Money, exits, watch window and costs, as three blocks (side by side when there is room). `base` = the strategy's
 * plan when editing a connection's own values (or the saved plan on a backtest page). `sizing` = which size fields
 * the traded legs need (lots for futures / options, ₹ for stocks); `nseOnly` = no MCX times (NSE / BSE products only).
 */
export function PaperTermsFields({
  value,
  onChange,
  base,
  hasGroups,
  sizing = { lots: true, cash: true },
  nseOnly = false,
  rulesInStrategy = false,
}: {
  value: PaperPlan;
  onChange: (p: PaperPlan) => void;
  base?: PaperPlan;
  hasGroups: boolean;
  sizing?: { lots: boolean; cash: boolean };
  nseOnly?: boolean;
  /** A connection's values: its trailing rules come from the strategy's trade plan (not editable here). */
  rulesInStrategy?: boolean;
}) {
  const set = (patch: Partial<PaperPlan>) => onChange({ ...value, ...patch });
  const own = (...keys: PaperOverrideKey[]) => !!base && keys.some((k) => value[k] !== base[k]);
  const reset = (...keys: PaperOverrideKey[]) => base && set(Object.fromEntries(keys.map((k) => [k, base[k]])) as Partial<PaperPlan>);
  const windowIssue = watchWindowIssue(nseOnly ? { ...value, watchMcxFrom: '00:00', watchMcxTo: '23:59' } : value);
  // A connection can switch Trailing SL on only when its strategy has trailing rules to trail by.
  const noRules = rulesInStrategy && !planConditions(value.rules).length;
  const trailIssue = noRules && value.trailing ? null : trailingIssue(value);
  // Switching Trailing SL on fills in a target to start at.
  const setTrailing = (trailing: boolean) => set({ trailing, ...(trailing && value.targetPct === null ? { targetPct: PAPER_DEFAULTS.targetPct } : {}) });
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(19rem,1fr))] items-start gap-3">
      <PlanBlock icon={Crosshair} title="Size & exits" help={H.paper.blockSize}>
        {sizing.lots && (
          <Field label="Lots per trade" help={H.paper.lots} own={own('lotsPerTrade')} onReset={() => reset('lotsPerTrade')}>
            <NumberInput label="Lots per trade" min={1} max={1000} step={1} className="input py-1 text-xs w-20 tabular-nums" value={value.lotsPerTrade} onChange={(n) => set({ lotsPerTrade: Math.max(1, Math.round(n)) })} />
            <span className="text-xs text-slate-400">lot{value.lotsPerTrade === 1 ? '' : 's'}</span>
          </Field>
        )}
        {sizing.cash && (
          <Field label={sizing.lots ? 'Stocks: ₹ / trade' : '₹ per trade'} help={H.paper.cash} own={own('cashPerTrade')} onReset={() => reset('cashPerTrade')}>
            <span className="text-xs text-slate-400">₹</span>
            <NumberInput label="₹ per trade" min={100} max={1e9} step={1000} className="input py-1 text-xs w-28 tabular-nums" value={value.cashPerTrade} onChange={(cashPerTrade) => set({ cashPerTrade })} />
          </Field>
        )}
        <Field label="Target" help={H.paper.target} own={own('targetPct')} onReset={() => reset('targetPct')}>
          <PctField label="Target %" value={value.targetPct} fallback={PAPER_DEFAULTS.targetPct} max={1000} required={value.trailing} onChange={(targetPct) => set({ targetPct })} />
        </Field>
        <Field label="Stop-loss" help={H.paper.stop} own={own('stopPct')} onReset={() => reset('stopPct')}>
          <PctField label="Stop-loss %" value={value.stopPct} fallback={PAPER_DEFAULTS.stopPct} max={100} onChange={(stopPct) => set({ stopPct })} />
        </Field>
        <Field label="Trailing SL" help={H.paper.trailing} own={own('trailing')} onReset={() => reset('trailing')}>
          <Toggle checked={value.trailing} onChange={setTrailing} label="Trail from the target" help={noRules ? H.paper.trailingNoRules : H.paper.trailing} disabled={noRules && !value.trailing} />
        </Field>
        <TradePath stopPct={value.stopPct} targetPct={value.targetPct} trailing={value.trailing} />
        {value.trailing && value.targetPct !== null && (
          <Tooltip content={H.paper.trailsAtTarget}>
            <p tabIndex={0} className="w-fit text-[11px] leading-relaxed text-slate-500 outline-none">
              {value.stopPct !== null ? `The −${value.stopPct}% stop-loss guards the trade until +${value.targetPct}%. ` : `Until +${value.targetPct}% nothing but the other exits guards the trade. `}
              From there your trailing rules take over; the stop-loss and target no longer apply.
            </p>
          </Tooltip>
        )}
        {trailIssue && <p className="text-[11px] text-warn">{trailIssue}</p>}
        {noRules && <p className="text-[11px] text-slate-500">{value.trailing ? 'Trailing SL needs trailing rules — this strategy has none: add them in its trade plan (Strategies → ✎ → 4 · Paper trading), or switch Trailing SL off here.' : 'Trailing SL: add trailing rules in the strategy’s trade plan first (Strategies → ✎ → 4 · Paper trading).'}</p>}
      </PlanBlock>

      <PlanBlock icon={Clock} title="When it trades" help={H.paper.blockWhen}>
        <Field label="Watch" help={H.paper.watch} own={own('watch')} onReset={() => reset('watch')}>
          <Toggle checked={value.watch} onChange={(watch) => set({ watch })} label="Only between set times" help={H.paper.watch} />
        </Field>
        {value.watch && (
          <>
            <Field label={nseOnly ? 'From – until' : 'NSE / BSE'} help={H.paper.watchNse} own={own('watchNseFrom', 'watchNseTo')} onReset={() => reset('watchNseFrom', 'watchNseTo')}>
              <TimeRange label="Watch NSE / BSE" from={value.watchNseFrom} to={value.watchNseTo} onFrom={(watchNseFrom) => set({ watchNseFrom })} onTo={(watchNseTo) => set({ watchNseTo })} />
            </Field>
            {!nseOnly && (
              <Field label="MCX" help={H.paper.watchMcx} own={own('watchMcxFrom', 'watchMcxTo')} onReset={() => reset('watchMcxFrom', 'watchMcxTo')}>
                <TimeRange label="Watch MCX" from={value.watchMcxFrom} to={value.watchMcxTo} onFrom={(watchMcxFrom) => set({ watchMcxFrom })} onTo={(watchMcxTo) => set({ watchMcxTo })} />
              </Field>
            )}
            {windowIssue && <p className="text-[11px] text-warn">{windowIssue}</p>}
          </>
        )}
        <div className="border-t border-dashed border-ink-700" />
        <Field label="Intraday" help={H.paper.squareOff} own={own('squareOff')} onReset={() => reset('squareOff')}>
          <Toggle checked={value.squareOff} onChange={(squareOff) => set({ squareOff })} label="Square off daily" help={H.paper.squareOff} />
        </Field>
        {value.squareOff && (
          <>
            <Field label={nseOnly ? 'Square off at' : 'NSE / BSE at'} help={H.paper.squareOffNse} own={own('squareOffNse')} onReset={() => reset('squareOffNse')}>
              <input aria-label="NSE / BSE square-off time" type="time" className="input py-1 text-xs" value={value.squareOffNse} onChange={(e) => e.target.value && set({ squareOffNse: e.target.value })} />
            </Field>
            {!nseOnly && (
              <Field label="MCX at" help={H.paper.squareOffMcx} own={own('squareOffMcx')} onReset={() => reset('squareOffMcx')}>
                <input aria-label="MCX square-off time" type="time" className="input py-1 text-xs" value={value.squareOffMcx} onChange={(e) => e.target.value && set({ squareOffMcx: e.target.value })} />
              </Field>
            )}
          </>
        )}
        {hasGroups && (
          <>
            <div className="border-t border-dashed border-ink-700" />
            <Field label="Other group" help={H.paper.opposite} own={own('exitOnOpposite')} onReset={() => reset('exitOnOpposite')}>
              <Toggle checked={value.exitOnOpposite} onChange={(exitOnOpposite) => set({ exitOnOpposite })} label="Exit when another group fires" help={H.paper.opposite} />
            </Field>
          </>
        )}
      </PlanBlock>

      <PlanBlock icon={Receipt} title="Costs" help={H.paper.blockCosts}>
        <Field label="Charges" help={H.paper.charges} own={own('charges')} onReset={() => reset('charges')}>
          <Toggle checked={value.charges} onChange={(charges) => set({ charges })} label="Deduct brokerage & taxes" help={H.paper.charges} />
        </Field>
        <Field label="Slippage" help={H.paper.slippage} own={own('slippagePct')} onReset={() => reset('slippagePct')}>
          <NumberInput label="Slippage %" min={0} max={10} step={0.1} className="input py-1 text-xs w-20 tabular-nums" value={value.slippagePct} onChange={(slippagePct) => set({ slippagePct })} />
          <span className="text-xs text-slate-400">% per fill</span>
        </Field>
      </PlanBlock>
    </div>
  );
}

/** "1 lot · +20/−10% · trailing from target" — a connection's paper settings in one line (size as its legs trade: lots and / or ₹). */
export function paperBrief(p: Pick<PaperPlan, 'lotsPerTrade' | 'cashPerTrade' | 'targetPct' | 'stopPct' | 'trailing'>, sizing = { lots: true, cash: false }): string {
  const size = [sizing.lots ? `${p.lotsPerTrade} lot${p.lotsPerTrade === 1 ? '' : 's'}` : null, sizing.cash ? inr(p.cashPerTrade, 0) : null].filter(Boolean).join(' / ');
  const exits = p.targetPct === null && p.stopPct === null ? '' : `${p.targetPct === null ? '—' : `+${p.targetPct}`}/${p.stopPct === null ? '—' : `−${p.stopPct}`}%`;
  return [size, exits, p.trailing ? 'trailing from target' : ''].filter(Boolean).join(' · ');
}

/** A connection's paper settings chip: click to edit. */
export function PaperChip({ enabled, brief, custom, onClick, active }: { enabled: boolean; brief: string; custom: boolean; onClick: () => void; active?: boolean }) {
  return (
    <Tooltip content={{ ...H.paper.chip, note: custom ? 'This connection has its own values (highlighted when you open it).' : 'Uses its strategy’s paper settings.' }}>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={active}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums whitespace-nowrap',
          !enabled ? 'border-ink-700 text-slate-500 line-through decoration-slate-500/60' : custom ? 'border-accent/40 bg-accent/10 text-accent-soft' : 'border-ink-700 bg-ink-850 text-slate-300 hover:text-slate-100',
          active && 'ring-2 ring-accent/40',
        )}
      >
        <span aria-hidden>📄</span>
        {enabled ? brief : 'paper off'}
        {custom && enabled && <span className="rounded bg-accent/15 px-1 text-[9px] uppercase tracking-wide">own</span>}
      </button>
    </Tooltip>
  );
}

/** Edit one connection's paper values over its strategy's (only the differences are saved). */
export function PaperConnectionEditor({
  connectionId,
  label,
  strategyPlan,
  override,
  hasGroups,
  sizing,
  onClose,
}: {
  connectionId: string;
  label: string;
  strategyPlan: PaperPlan;
  override: PaperOverride | undefined;
  hasGroups: boolean;
  sizing: { lots: boolean; cash: boolean };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const initial = effectivePlan(strategyPlan, override);
  const [value, setValue] = useState<PaperPlan>(initial);
  const changes = diffOverride(strategyPlan, value);
  const refresh = () => {
    for (const k of ['v2-paper-settings', 'v2-paper']) qc.invalidateQueries({ queryKey: [k] });
  };
  const save = useMutation({ mutationFn: () => v2Api.saveConnectionPaper(connectionId, changes), onSuccess: () => (refresh(), onClose()) });
  const reset = useMutation({ mutationFn: () => v2Api.resetConnectionPaper(connectionId), onSuccess: () => (refresh(), onClose()) });
  const count = Object.keys(changes).length;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink-700/60 bg-ink-850 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-slate-200">Paper trading · {label}</span>
        <Toggle checked={value.enabled} onChange={(enabled) => setValue({ ...value, enabled })} label="Paper trade this connection" help={H.paper.connectionOn} />
        <span className="text-[11px] text-slate-500">{count ? `${count} own value${count === 1 ? '' : 's'} — the rest follow the strategy` : 'Follows the strategy’s paper settings'}</span>
      </div>
      {value.enabled && <PaperTermsFields value={value} onChange={setValue} base={strategyPlan} hasGroups={hasGroups} sizing={sizing} rulesInStrategy />}
      <p className="text-[11px] text-slate-500">
        Which leg each group trades (Buy / Sell) and its trailing rules are set per strategy (strategy editor, step 4). Changes apply to new trades; the watch window applies to this connection’s alerts too.
      </p>
      {(save.error || reset.error) && <p className="text-xs text-bear">{((save.error ?? reset.error) as Error).message}</p>}
      <div className="flex flex-wrap gap-2">
        <Tooltip content={H.paper.saveOwn}>
          <button type="button" className="btn-primary py-1 text-xs" disabled={save.isPending || !!watchWindowIssue(value)} onClick={() => save.mutate()}>
            {save.isPending ? <InlineSpinner className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />} Save
          </button>
        </Tooltip>
        <Tooltip content={H.paper.useStrategy}>
          <button type="button" className="btn-ghost py-1 text-xs" disabled={reset.isPending || (!override && !count)} onClick={() => reset.mutate()}>
            <RotateCcw className="w-3.5 h-3.5" /> Use strategy’s settings
          </button>
        </Tooltip>
        <Tooltip content={H.paper.cancel}>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={onClose}>
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
