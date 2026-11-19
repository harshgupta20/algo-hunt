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
import type { ExitLevel, PaperOverride, PaperOverrideKey, PaperPlan, StopSetting, StopUnit } from '@/shared/v2';
import { PAPER_DEFAULTS, diffOverride, effectivePlan, exitText, planConditions, stopOf, targetOf, trailingIssue, watchWindowIssue } from '@/shared/v2';
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

/** Points a target / stop-loss starts at when switched to points (or ticked on in points). */
const POINTS_FALLBACK = { target: 20, stop: 10 } as const;

/** A target / stop-loss as its plan fields: % or points (the other one null) — or, for a stop-loss, the signal candle. */
type ExitPatch<U extends StopUnit> = { unit: U; pct: number | null; points: number | null };

const UNIT_LABEL: Record<StopUnit, string> = { PCT: '%', POINTS: 'pts', CANDLE: 'prev candle' };
const UNIT_HELP: Record<StopUnit, TooltipContent> = { PCT: H.paper.unitPct, POINTS: H.paper.unitPoints, CANDLE: H.paper.unitCandle };

/**
 * A target / stop-loss: an on/off tick (off = none), its size, and % or points (price points of the traded contract)
 * — a stop-loss also "prev candle": the signal candle's low (buy) / high (sell), no number. `required` = it can't be
 * ticked off. Switching the unit starts the other one at its default; ticking a candle stop off makes it % (off).
 */
function ExitField<U extends StopUnit>({
  label,
  units,
  unit,
  pct,
  points,
  fallback,
  maxPct,
  required,
  onChange,
}: {
  label: string;
  units: readonly U[];
  unit: U;
  pct: number | null;
  points: number | null;
  fallback: { pct: number; points: number };
  maxPct: number;
  required?: boolean;
  onChange: (e: ExitPatch<U | 'PCT'>) => void;
}) {
  const inPoints = unit === 'POINTS';
  const byCandle = unit === 'CANDLE';
  const on = byCandle || (inPoints ? points : pct) !== null;
  const value = inPoints ? points : pct;
  const set = (v: number | null) => onChange(inPoints ? { unit, pct: null, points: v } : { unit, pct: v, points: null });
  const setUnit = (u: U) => {
    if (u === unit) return;
    onChange(u === 'POINTS' ? { unit: u, pct: null, points: on ? fallback.points : null } : u === 'CANDLE' ? { unit: u, pct: null, points: null } : { unit: u, pct: on ? fallback.pct : null, points: null });
  };
  const tick = (checked: boolean) => {
    if (byCandle) return checked ? undefined : onChange({ unit: 'PCT', pct: null, points: null });
    set(checked ? (inPoints ? fallback.points : fallback.pct) : null);
  };
  return (
    <>
      <Tooltip content={{ ...H.paper.pctOn, title: `${label}: ${on ? 'on' : 'off'}`, note: required && on ? 'Needed while Trailing SL is on — trailing starts there.' : undefined }}>
        <input type="checkbox" aria-label={`${label} on`} className="accent-[rgb(var(--accent))] disabled:opacity-40" checked={on} disabled={required && on} onChange={(e) => tick(e.target.checked)} />
      </Tooltip>
      {byCandle ? (
        <Tooltip content={H.paper.unitCandle}>
          <span className="cursor-help text-xs text-slate-300">signal candle low / high</span>
        </Tooltip>
      ) : (
        <NumberInput
          key={unit}
          label={`${label} ${inPoints ? 'points' : '%'}`}
          min={inPoints ? 0.05 : 0.1}
          max={inPoints ? 1_000_000 : maxPct}
          step={1}
          disabled={value === null}
          className="input py-1 text-xs w-20 tabular-nums disabled:opacity-40"
          value={value}
          placeholder="none"
          onChange={set}
        />
      )}
      <div role="radiogroup" aria-label={`${label} in`} className="flex overflow-hidden rounded-md border border-ink-700 text-[11px]">
        {units.map((u) => (
          <Tooltip key={u} content={UNIT_HELP[u]}>
            <button
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => setUnit(u)}
              className={clsx('whitespace-nowrap px-2 py-1 font-semibold', unit === u ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400 hover:text-slate-200')}
            >
              {UNIT_LABEL[u]}
            </button>
          </Tooltip>
        ))}
      </div>
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
 * are sized by their size when both are in the same unit, so a −15 % stop with a +40 % target looks like one.
 */
function TradePath({ stop, target, trailing }: { stop: StopSetting | null; target: ExitLevel | null; trailing: boolean }) {
  const same = !stop || !target || stop.unit === target.unit;
  const w = (e: StopSetting | null) => (same && e?.unit !== 'CANDLE' ? Math.max(e?.value ?? 10, 6) : 10);
  const trail = trailing && target !== null;
  return (
    <Tooltip content={H.paper.tradePath} className="block">
      <div className="cursor-help rounded-md border border-ink-700/70 bg-ink-850 px-3 pb-2 pt-2.5">
        <div className="flex h-2 items-stretch overflow-hidden rounded-full">
          <div style={{ flexGrow: w(stop) }} className={stop === null ? 'bg-ink-700' : 'bg-bear/70'} />
          <div className="w-1 bg-fg" />
          <div style={{ flexGrow: w(target) }} className={target === null ? 'bg-ink-700' : trail ? 'bg-bull/50' : 'bg-bull/70'} />
          {trail && <div style={{ flexGrow: w(target) * 0.7 }} className="bg-gradient-to-r from-accent/70 to-accent/5" />}
        </div>
        <div className="mt-1.5 flex text-[11px] leading-tight">
          <div style={{ flexGrow: w(stop) }} className="flex justify-between gap-2 pr-1">
            <span className={stop === null ? 'text-slate-500' : 'font-semibold text-bear'}>{stop === null ? 'No stop-loss' : stop.unit === 'CANDLE' ? 'Stop-loss at the signal candle' : `−${exitText(stop)} stop-loss`}</span>
            <span className="font-semibold text-fg">Entry</span>
          </div>
          <div style={{ flexGrow: w(target) }} className="flex justify-end pl-1">
            <span className={target === null ? 'text-slate-500' : 'font-semibold text-bull'}>{target === null ? 'No target' : trail ? `+${exitText(target)} trailing starts` : `+${exitText(target)} target`}</span>
          </div>
          {trail && (
            <div style={{ flexGrow: w(target) * 0.7 }} className="flex justify-end pl-1">
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
  groupWord = 'group',
  sizing = { lots: true, cash: true },
  nseOnly = false,
  rulesInStrategy = false,
}: {
  value: PaperPlan;
  onChange: (p: PaperPlan) => void;
  base?: PaperPlan;
  hasGroups: boolean;
  /** What the strategy's parts that fire on their own are called: legs (the simple view) or groups. */
  groupWord?: 'leg' | 'group';
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
  const target = targetOf(value);
  const stop = stopOf(value);
  // Switching Trailing SL on fills in a target to start at (in the target's unit).
  const setTrailing = (trailing: boolean) =>
    set({ trailing, ...(trailing && !target ? (value.targetUnit === 'POINTS' ? { targetPoints: POINTS_FALLBACK.target } : { targetPct: PAPER_DEFAULTS.targetPct }) : {}) });
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
        <Field label="Target" help={H.paper.target} own={own('targetPct', 'targetUnit', 'targetPoints')} onReset={() => reset('targetPct', 'targetUnit', 'targetPoints')}>
          <ExitField
            label="Target"
            units={['PCT', 'POINTS'] as const}
            unit={value.targetUnit}
            pct={value.targetPct}
            points={value.targetPoints}
            fallback={{ pct: PAPER_DEFAULTS.targetPct, points: POINTS_FALLBACK.target }}
            maxPct={1000}
            required={value.trailing}
            onChange={(e) => set({ targetUnit: e.unit, targetPct: e.pct, targetPoints: e.points })}
          />
        </Field>
        <Field label="Stop-loss" help={H.paper.stop} own={own('stopPct', 'stopUnit', 'stopPoints')} onReset={() => reset('stopPct', 'stopUnit', 'stopPoints')}>
          <ExitField
            label="Stop-loss"
            units={['PCT', 'POINTS', 'CANDLE'] as const}
            unit={value.stopUnit}
            pct={value.stopPct}
            points={value.stopPoints}
            fallback={{ pct: PAPER_DEFAULTS.stopPct, points: POINTS_FALLBACK.stop }}
            maxPct={100}
            onChange={(e) => set({ stopUnit: e.unit, stopPct: e.pct, stopPoints: e.points })}
          />
        </Field>
        <Field label="Trailing SL" help={H.paper.trailing} own={own('trailing')} onReset={() => reset('trailing')}>
          <Toggle checked={value.trailing} onChange={setTrailing} label="Trail from the target" help={noRules ? H.paper.trailingNoRules : H.paper.trailing} disabled={noRules && !value.trailing} />
        </Field>
        <TradePath stop={stop} target={target} trailing={value.trailing} />
        {value.trailing && target !== null && (
          <Tooltip content={H.paper.trailsAtTarget}>
            <p tabIndex={0} className="w-fit text-[11px] leading-relaxed text-slate-500 outline-none">
              {stop !== null ? `The ${stop.unit === 'CANDLE' ? 'signal candle' : `−${exitText(stop)}`} stop-loss guards the trade until +${exitText(target)}. ` : `Until +${exitText(target)} nothing but the other exits guards the trade. `}
              From there your trailing rules take over; the stop-loss and target no longer apply.
            </p>
          </Tooltip>
        )}
        {trailIssue && <p className="text-[11px] text-warn">{trailIssue}</p>}
        {noRules && <p className="text-[11px] text-slate-500">{value.trailing ? 'Trailing SL needs trailing rules — this strategy has none: add them in its trade plan (Strategies → ✎ → 3 · Paper trading), or switch Trailing SL off here.' : 'Trailing SL: add trailing rules in the strategy’s trade plan first (Strategies → ✎ → 3 · Paper trading).'}</p>}
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
            <Field label={`Other ${groupWord}`} help={H.paper.opposite} own={own('exitOnOpposite')} onReset={() => reset('exitOnOpposite')}>
              <Toggle checked={value.exitOnOpposite} onChange={(exitOnOpposite) => set({ exitOnOpposite })} label={`Exit when another ${groupWord} fires`} help={H.paper.opposite} />
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

/** "1 lot · +20/−10% · trailing from target" (points: "+40 pts/−10%") — a connection's paper settings in one line (size as its legs trade: lots and / or ₹). */
export function paperBrief(p: Pick<PaperPlan, 'lotsPerTrade' | 'cashPerTrade' | 'targetPct' | 'stopPct' | 'trailing'> & Partial<Pick<PaperPlan, 'targetUnit' | 'targetPoints' | 'stopUnit' | 'stopPoints'>>, sizing = { lots: true, cash: false }): string {
  const size = [sizing.lots ? `${p.lotsPerTrade} lot${p.lotsPerTrade === 1 ? '' : 's'}` : null, sizing.cash ? inr(p.cashPerTrade, 0) : null].filter(Boolean).join(' / ');
  const t = targetOf(p);
  const s = stopOf(p);
  const allPct = t?.unit !== 'POINTS' && (!s || s.unit === 'PCT');
  const stopBrief = !s ? '—' : s.unit === 'CANDLE' ? 'prev candle' : `−${exitText(s)}`;
  const exits = !t && !s ? '' : allPct ? `${t ? `+${t.value}` : '—'}/${s && s.unit === 'PCT' ? `−${s.value}` : '—'}%` : `${t ? `+${exitText(t)}` : '—'}/${stopBrief}`;
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
  groupWord,
  sizing,
  onClose,
}: {
  connectionId: string;
  label: string;
  strategyPlan: PaperPlan;
  override: PaperOverride | undefined;
  hasGroups: boolean;
  groupWord?: 'leg' | 'group';
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
      {value.enabled && <PaperTermsFields value={value} onChange={setValue} base={strategyPlan} hasGroups={hasGroups} groupWord={groupWord} sizing={sizing} rulesInStrategy />}
      <p className="text-[11px] text-slate-500">
        Which instrument each group trades (Buy / Sell) and its trailing rules are set per strategy (strategy editor, step 3). Changes apply to new trades; the watch window applies to this connection’s alerts too.
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
