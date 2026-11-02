'use client';

/**
 * Paper-trading settings shared by the strategy editor (the strategy's defaults), each connection (its own values
 * over the strategy's) and the backtest pages (the same plan, tried out): size, target / stop-loss / trailing stop,
 * watch window, square-off, other group, costs. With `base`, a value that differs from it is marked "own" with a ↺
 * to go back to the strategy's.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, X } from 'lucide-react';
import clsx from 'clsx';
import type { PaperOverride, PaperOverrideKey, PaperPlan } from '@/shared/v2';
import { PAPER_DEFAULTS, diffOverride, effectivePlan, watchWindowIssue } from '@/shared/v2';
import { InfoTip, Tooltip, type TooltipContent } from '../../components/Tooltip';
import { InlineSpinner } from '../../components/loaders';
import { v2Api } from '../api';
import { NumberInput, Toggle } from '../components';
import { H } from '../help';
import { inr } from './money';


function Field({ label, help, own, onReset, children }: { label: string; help: TooltipContent; own?: boolean; onReset?: () => void; children: ReactNode }) {
  return (
    <div className={clsx('flex flex-col gap-1 rounded-lg px-2 py-1.5', own && 'bg-accent/5 ring-1 ring-accent/30')}>
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
        <InfoTip content={help} />
        {own && onReset && (
          <Tooltip content={H.paper.own}>
            <button type="button" aria-label={`${label}: use the strategy's value`} onClick={onReset} className="ml-1 inline-flex items-center gap-0.5 normal-case tracking-normal text-accent-soft hover:underline">
              own <RotateCcw className="w-3 h-3" />
            </button>
          </Tooltip>
        )}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** The trailing stop's % when it's ticked on. */
const TRAIL_DEFAULT = 10;

/** A % with an on/off tick (off = none). */
function PctField({ label, value, fallback, max, onChange }: { label: string; value: number | null; fallback: number; max: number; onChange: (v: number | null) => void }) {
  return (
    <>
      <input type="checkbox" aria-label={`${label} on`} className="accent-[rgb(var(--accent))]" checked={value !== null} onChange={(e) => onChange(e.target.checked ? fallback : null)} />
      <NumberInput label={label} min={0.1} max={max} step={1} disabled={value === null} className="input py-1 text-xs w-20 tabular-nums disabled:opacity-40" value={value} placeholder="none" onChange={onChange} />
      <span className="text-xs text-slate-400">%</span>
    </>
  );
}

/**
 * Money, exits, watch window and costs. `base` = the strategy's plan when editing a connection's own values (or the
 * saved plan on a backtest page). `sizing` = which size fields the traded legs need (lots for futures / options, ₹
 * for stocks); `nseOnly` = no MCX times (NSE / BSE products only).
 */
export function PaperTermsFields({
  value,
  onChange,
  base,
  hasGroups,
  sizing = { lots: true, cash: true },
  nseOnly = false,
}: {
  value: PaperPlan;
  onChange: (p: PaperPlan) => void;
  base?: PaperPlan;
  hasGroups: boolean;
  sizing?: { lots: boolean; cash: boolean };
  nseOnly?: boolean;
}) {
  const set = (patch: Partial<PaperPlan>) => onChange({ ...value, ...patch });
  const own = (...keys: PaperOverrideKey[]) => !!base && keys.some((k) => value[k] !== base[k]);
  const reset = (...keys: PaperOverrideKey[]) => base && set(Object.fromEntries(keys.map((k) => [k, base[k]])) as Partial<PaperPlan>);
  const windowIssue = watchWindowIssue(nseOnly ? { ...value, watchMcxFrom: '00:00', watchMcxTo: '23:59' } : value);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {sizing.lots && (
          <Field label="Lots per trade" help={H.paper.lots} own={own('lotsPerTrade')} onReset={() => reset('lotsPerTrade')}>
            <NumberInput label="Lots per trade" min={1} max={1000} step={1} className="input py-1 text-xs w-20 tabular-nums" value={value.lotsPerTrade} onChange={(n) => set({ lotsPerTrade: Math.max(1, Math.round(n)) })} />
            <span className="text-xs text-slate-400">lot{value.lotsPerTrade === 1 ? '' : 's'}</span>
          </Field>
        )}
        {sizing.cash && (
          <Field label={sizing.lots ? 'Stocks: ₹ per trade' : '₹ per trade'} help={H.paper.cash} own={own('cashPerTrade')} onReset={() => reset('cashPerTrade')}>
            <span className="text-xs text-slate-400">₹</span>
            <NumberInput label="₹ per trade" min={100} max={1e9} step={1000} className="input py-1 text-xs w-28 tabular-nums" value={value.cashPerTrade} onChange={(cashPerTrade) => set({ cashPerTrade })} />
          </Field>
        )}
        <Field label="Target" help={H.paper.target} own={own('targetPct')} onReset={() => reset('targetPct')}>
          <PctField label="Target %" value={value.targetPct} fallback={PAPER_DEFAULTS.targetPct} max={1000} onChange={(targetPct) => set({ targetPct })} />
        </Field>
        <Field label="Stop-loss" help={H.paper.stop} own={own('stopPct')} onReset={() => reset('stopPct')}>
          <PctField label="Stop-loss %" value={value.stopPct} fallback={PAPER_DEFAULTS.stopPct} max={100} onChange={(stopPct) => set({ stopPct })} />
        </Field>
        <Field label="Trailing stop" help={H.paper.trail} own={own('trailPct')} onReset={() => reset('trailPct')}>
          <PctField label="Trailing stop %" value={value.trailPct} fallback={TRAIL_DEFAULT} max={100} onChange={(trailPct) => set({ trailPct })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Watch" help={H.paper.watch} own={own('watch')} onReset={() => reset('watch')}>
          <Toggle checked={value.watch} onChange={(watch) => set({ watch })} label="Only between set times" help={H.paper.watch} />
        </Field>
        {value.watch && (
          <>
            <Field label={nseOnly ? 'Watch from – until' : 'NSE / BSE from – until'} help={H.paper.watchNse} own={own('watchNseFrom', 'watchNseTo')} onReset={() => reset('watchNseFrom', 'watchNseTo')}>
              <input aria-label="Watch NSE / BSE from" type="time" className="input py-1 text-xs" value={value.watchNseFrom} onChange={(e) => e.target.value && set({ watchNseFrom: e.target.value })} />
              <span className="text-xs text-slate-500">–</span>
              <input aria-label="Watch NSE / BSE until" type="time" className="input py-1 text-xs" value={value.watchNseTo} onChange={(e) => e.target.value && set({ watchNseTo: e.target.value })} />
            </Field>
            {!nseOnly && (
              <Field label="MCX from – until" help={H.paper.watchMcx} own={own('watchMcxFrom', 'watchMcxTo')} onReset={() => reset('watchMcxFrom', 'watchMcxTo')}>
                <input aria-label="Watch MCX from" type="time" className="input py-1 text-xs" value={value.watchMcxFrom} onChange={(e) => e.target.value && set({ watchMcxFrom: e.target.value })} />
                <span className="text-xs text-slate-500">–</span>
                <input aria-label="Watch MCX until" type="time" className="input py-1 text-xs" value={value.watchMcxTo} onChange={(e) => e.target.value && set({ watchMcxTo: e.target.value })} />
              </Field>
            )}
            {windowIssue && <p className="self-center text-[11px] text-warn">{windowIssue}</p>}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Intraday" help={H.paper.squareOff} own={own('squareOff')} onReset={() => reset('squareOff')}>
          <Toggle checked={value.squareOff} onChange={(squareOff) => set({ squareOff })} label="Square off daily" help={H.paper.squareOff} />
        </Field>
        {value.squareOff && (
          <>
            <Field label="NSE / BSE at" help={H.paper.squareOffNse} own={own('squareOffNse')} onReset={() => reset('squareOffNse')}>
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
          <Field label="Other group" help={H.paper.opposite} own={own('exitOnOpposite')} onReset={() => reset('exitOnOpposite')}>
            <Toggle checked={value.exitOnOpposite} onChange={(exitOnOpposite) => set({ exitOnOpposite })} label="Exit when another group fires" help={H.paper.opposite} />
          </Field>
        )}
        <Field label="Costs" help={H.paper.charges} own={own('charges')} onReset={() => reset('charges')}>
          <Toggle checked={value.charges} onChange={(charges) => set({ charges })} label="Deduct charges" help={H.paper.charges} />
        </Field>
        <Field label="Slippage" help={H.paper.slippage} own={own('slippagePct')} onReset={() => reset('slippagePct')}>
          <NumberInput label="Slippage %" min={0} max={10} step={0.1} className="input py-1 text-xs w-20 tabular-nums" value={value.slippagePct} onChange={(slippagePct) => set({ slippagePct })} />
          <span className="text-xs text-slate-400">%</span>
        </Field>
      </div>
    </div>
  );
}

/** "1 lot · +20/−10% · trail 10%" — a connection's paper settings in one line (size as its legs trade: lots and / or ₹). */
export function paperBrief(p: Pick<PaperPlan, 'lotsPerTrade' | 'cashPerTrade' | 'targetPct' | 'stopPct' | 'trailPct'>, sizing = { lots: true, cash: false }): string {
  const size = [sizing.lots ? `${p.lotsPerTrade} lot${p.lotsPerTrade === 1 ? '' : 's'}` : null, sizing.cash ? inr(p.cashPerTrade, 0) : null].filter(Boolean).join(' / ');
  const exits = p.targetPct === null && p.stopPct === null ? '' : `${p.targetPct === null ? '—' : `+${p.targetPct}`}/${p.stopPct === null ? '—' : `−${p.stopPct}`}%`;
  return [size, exits, p.trailPct !== null ? `trail ${p.trailPct}%` : ''].filter(Boolean).join(' · ');
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
      {value.enabled && <PaperTermsFields value={value} onChange={setValue} base={strategyPlan} hasGroups={hasGroups} sizing={sizing} />}
      <p className="text-[11px] text-slate-500">
        Which leg each group trades (Buy / Sell) and its stop / target conditions are set per strategy (strategy editor, step 4). Changes apply to new trades; the watch window applies to this connection’s alerts too.
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
