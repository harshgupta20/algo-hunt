'use client';

/**
 * Small building blocks shared by the MCX V2 screens: captioned cells, state
 * badges, instrument tags and the condition trace ("why did it (not) fire").
 */
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import type { AlertStateName, ConditionTrace, ExprTrace, McxInstrument, OperandTrace, SignalOutcome, TriState } from '@/shared/mcx';
import { InfoTip, Tooltip, type TooltipContent } from '../components/Tooltip';
import { Badge } from '../components/ui';
import { H } from './help';
import { OUTCOME_LABEL, TRI_CLASS, fmtNum, instrumentLabel, istStamp, legClass, legShort } from './format';

/** Captioned control: small label + ⓘ above the input (same look as the V1 builder). */
export function Cell({ label, help, children, className }: { label: string; help: TooltipContent; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
        <InfoTip content={help} />
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A titled section card inside the editor / dashboard. */
export function Section({ step, title, help, children, actions }: { step?: string; title: string; help: TooltipContent; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        {step && <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-soft">{step}</span>}
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <InfoTip content={help} />
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** "● CE GOLD 26 Oct 75100 CE" — leg color identifies FUT / CE / PE (never green/red). */
export function InstrumentTag({ i, compact }: { i: McxInstrument; compact?: boolean }) {
  return (
    <Tooltip
      content={{
        title: i.symbol,
        body: `${i.instrumentType === 'MCX_FUTURE' ? 'Future' : i.optionType === 'CE' ? 'Call option' : 'Put option'} · ${i.underlying}${i.expiry ? ` · expires ${i.expiry}` : ''}${i.strike ? ` · strike ${i.strike}` : ''}`,
        note: `Lot ${i.lotSize} · tick ${i.tickSize} · id ${i.id}`,
      }}
    >
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
        <span className={clsx('font-semibold', legClass(i))}>● {legShort(i)}</span>
        <span className={clsx('text-slate-200', compact ? 'font-mono' : '')}>{compact ? i.symbol : instrumentLabel(i)}</span>
      </span>
    </Tooltip>
  );
}

const UNIT_TONE: Record<AlertStateName, 'default' | 'bull' | 'warn' | 'accent'> = {
  IDLE: 'default',
  TRIGGERED: 'bull',
  COOLDOWN: 'warn',
  ACKNOWLEDGED: 'accent',
  DISABLED: 'default',
};

export function UnitStateBadge({ state }: { state: AlertStateName }) {
  return (
    <Tooltip content={H.unit[state]}>
      <Badge tone={UNIT_TONE[state]}>{H.unit[state].title}</Badge>
    </Tooltip>
  );
}

export function TriBadge({ value, reason }: { value: TriState | null | undefined; reason?: string }) {
  if (!value) return <span className="text-xs text-slate-500">—</span>;
  const Icon = value === 'TRUE' ? CheckCircle2 : value === 'FALSE' ? XCircle : CircleHelp;
  return (
    <Tooltip content={{ ...H.tri[value], note: reason }}>
      <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', TRI_CLASS[value])}>
        <Icon className="w-3.5 h-3.5" />
        {H.tri[value].title}
      </span>
    </Tooltip>
  );
}

export function OutcomeBadge({ outcome }: { outcome: SignalOutcome }) {
  const tone = outcome === 'ALERTED' ? 'bull' : outcome === 'NO_CHANNEL' ? 'accent' : 'warn';
  return (
    <Tooltip content={{ ...H.alerts.outcome, title: OUTCOME_LABEL[outcome] }}>
      <Badge tone={tone}>{OUTCOME_LABEL[outcome]}</Badge>
    </Tooltip>
  );
}

function OperandValue({ o, cross }: { o?: OperandTrace; cross: boolean }) {
  if (!o) return null;
  const isConst = o.label === String(o.value) && o.candleTime === undefined;
  if (isConst) return <span className="font-mono text-slate-300">{fmtNum(o.value)}</span>;
  return (
    <Tooltip
      content={{
        title: o.label,
        body: o.candleTime ? `Candle ${istStamp(o.candleTime)} IST${o.complete === false ? ' (forming)' : ''}` : 'No candle',
        note: cross && o.prevCandleTime ? `Previous candle ${istStamp(o.prevCandleTime)} IST: ${fmtNum(o.prev)}` : undefined,
      }}
    >
      <span className="font-mono text-slate-300 cursor-help">
        {cross ? `${fmtNum(o.prev)} → ${fmtNum(o.value)}` : fmtNum(o.value)}
      </span>
    </Tooltip>
  );
}

function ConditionLine({ c }: { c: ConditionTrace }) {
  const cross = c.operator === 'CROSSED_ABOVE' || c.operator === 'CROSSED_BELOW';
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1">
      <TriBadge value={c.result} reason={c.reason} />
      <span className="text-xs text-slate-300 flex-1 min-w-[12rem]">{c.text}</span>
      {c.kind === 'CONDITION' && c.result !== 'UNKNOWN' && (
        <span className="text-xs text-slate-500 flex items-center gap-1.5">
          <OperandValue o={c.left} cross={cross} />
          <span>vs</span>
          <OperandValue o={c.right} cross={cross} />
        </span>
      )}
      {c.kind === 'PATTERN' && c.left?.candleTime && <span className="text-xs text-slate-500">candle {istStamp(c.left.candleTime)}</span>}
      {c.reason && <span className="basis-full text-[11px] text-warn pl-5">{c.reason}</span>}
    </div>
  );
}

/** The evaluation tree: groups with their combined result, conditions with values. */
export function TraceView({ trace, depth = 0 }: { trace: ExprTrace; depth?: number }) {
  if (trace.condition) return <ConditionLine c={trace.condition} />;
  return (
    <div className={clsx(depth > 0 && 'ml-3 pl-3 border-l border-ink-700')}>
      <div className="flex items-center gap-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{trace.type}</span>
        {trace.label && <span className="text-xs text-slate-400">{trace.label}</span>}
        <TriBadge value={trace.result} />
      </div>
      {trace.children?.map((c) => <TraceView key={c.id} trace={c} depth={depth + 1} />)}
    </div>
  );
}

/** Segmented control with a tooltip per option. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; help: TooltipContent }>;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg overflow-hidden border border-ink-700 text-xs">
      {options.map((o) => (
        <Tooltip key={o.value} content={o.help} side="bottom">
          <button
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={clsx('inline-flex items-center gap-1 px-2.5 py-1', o.value === value ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400 hover:text-slate-200')}
          >
            {o.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** Checkbox + label with a tooltip. */
export function Toggle({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; help: TooltipContent; disabled?: boolean }) {
  return (
    <Tooltip content={help}>
      <label className={clsx('inline-flex items-center gap-1.5 text-xs cursor-pointer', disabled ? 'text-slate-500' : 'text-slate-300')}>
        <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    </Tooltip>
  );
}
