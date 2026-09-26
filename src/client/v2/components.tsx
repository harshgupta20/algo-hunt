'use client';

/**
 * Building blocks shared by the V2 screens: captioned cells, legs, units,
 * state badges and the condition trace ("why did it (not) fire").
 */
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import type { AlertStateName, ConditionTrace, ExprTrace, LegDef, LegKind, OperandTrace, SignalOutcome, TriState, UnitEvaluation, V2Instrument, V2Product, V2Unit } from '@/shared/v2';
import { legKindText, legName } from '@/shared/v2';
import { InfoTip, Tooltip, type TooltipContent } from '../components/Tooltip';
import { Badge } from '../components/ui';
import { H } from './help';
import { LEG_KIND_TEXT, OUTCOME_LABEL, TRI_CLASS, fmtNum, istStamp, shortDate } from './format';

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

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; help: TooltipContent }>; label: string }) {
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

/** "B · CE ATM+1" in the leg's colour. */
export function LegBadge({ leg, className }: { leg: LegDef; className?: string }) {
  return (
    <Tooltip content={{ title: legName(leg), body: `Leg ${leg.id}: ${legKindText(leg)}${leg.label ? ` (named “${leg.label}”)` : ''}.` }}>
      <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap', LEG_KIND_TEXT[leg.kind], className)}>
        <span className="rounded bg-ink-800 px-1 text-[10px] text-slate-300">{leg.id}</span>
        {leg.label?.trim() || legKindText(leg)}
      </span>
    </Tooltip>
  );
}

export function InstrumentChip({ i }: { i: V2Instrument }) {
  return (
    <Tooltip content={{ title: i.symbol, body: `${i.kind}${i.expiry ? ` · expires ${i.expiry}` : ''}${i.strike ? ` · strike ${i.strike}` : ''} · ${i.exchange}`, note: `Lot ${i.lotSize} · tick ${i.tickSize}` }}>
      <span className={clsx('text-xs font-mono whitespace-nowrap', LEG_KIND_TEXT[i.kind])}>{i.symbol}</span>
    </Tooltip>
  );
}

/** A unit in one line: "NIFTY 25000 · 13 Oct" (strike units) or the future / spot symbol. */
export function UnitTag({ unit, symbol }: { unit: V2Unit; symbol: string }) {
  const legs = Object.entries(unit.legs) as Array<[string, V2Instrument | null]>;
  return (
    <Tooltip content={{ title: unit.baseStrike !== null ? `${symbol} ${unit.baseStrike} · options expiring ${unit.expiry}` : symbol, body: legs.map(([id, i]) => `${id}: ${i ? i.symbol : 'not listed'}`).join(' · '), note: unit.atmStrike !== undefined ? `ATM was ${unit.atmStrike}.` : undefined }}>
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
        <span className="font-medium text-slate-200">{symbol}</span>
        {unit.baseStrike !== null ? (
          <>
            <span className="text-slate-300">{unit.baseStrike}</span>
            <span className="text-slate-500">{shortDate(unit.expiry)}</span>
            {unit.shift !== 0 && <span className="text-[10px] text-slate-500">({unit.shift > 0 ? '+' : ''}{unit.shift})</span>}
          </>
        ) : (
          unit.expiry && <span className="text-slate-500">{shortDate(unit.expiry)}</span>
        )}
      </span>
    </Tooltip>
  );
}

/** Each leg's close on the trigger candle. */
export function LegPrices({ prices, legs }: { prices: UnitEvaluation['prices'] | undefined; legs: LegDef[] }) {
  const shown = legs.filter((l) => prices?.[l.id] !== undefined);
  if (!shown.length) return null;
  return (
    <Tooltip content={{ title: 'Closing prices', body: 'Each leg’s close on the evaluated trigger candle.' }}>
      <span className="inline-flex flex-wrap gap-2 text-xs tabular-nums">
        {shown.map((l) => (
          <span key={l.id}>
            <span className={clsx('font-semibold', LEG_KIND_TEXT[l.kind])}>{l.id}</span> <span className="text-slate-300">{fmtNum(prices![l.id])}</span>
          </span>
        ))}
      </span>
    </Tooltip>
  );
}

const KIND_LABEL: Record<LegKind, string> = { SPOT: 'Spot', FUT: 'Futures', CE: 'Calls', PE: 'Puts' };

/** Which legs a product offers: SPOT FUT CE PE (dim = not available). */
export function ProductLegs({ product }: { product: Pick<V2Product, 'hasSpot' | 'hasFutures' | 'hasOptions'> }) {
  const has: Record<LegKind, boolean> = { SPOT: product.hasSpot, FUT: product.hasFutures, CE: product.hasOptions, PE: product.hasOptions };
  return (
    <Tooltip content={{ ...H.products.legs, note: (Object.keys(has) as LegKind[]).map((k) => `${KIND_LABEL[k]}: ${has[k] ? 'yes' : 'no'}`).join(' · ') }}>
      <span className="inline-flex gap-1 text-[10px] font-semibold">
        {(['SPOT', 'FUT', 'CE', 'PE'] as const).map((k) => (
          <span key={k} className={has[k] ? LEG_KIND_TEXT[k] : 'text-slate-600 line-through'}>
            {k}
          </span>
        ))}
      </span>
    </Tooltip>
  );
}

const UNIT_TONE: Record<AlertStateName, 'default' | 'bull' | 'warn' | 'accent'> = { IDLE: 'default', TRIGGERED: 'bull', COOLDOWN: 'warn', ACKNOWLEDGED: 'accent', DISABLED: 'default' };

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
  if (o.label === String(o.value) && o.candleTime === undefined) return <span className="font-mono text-slate-300">{fmtNum(o.value)}</span>;
  return (
    <Tooltip
      content={{
        title: o.label,
        body: o.candleTime ? `Candle ${istStamp(o.candleTime)} IST${o.complete === false ? ' (forming)' : ''}` : 'No candle',
        note: cross && o.prevCandleTime ? `Previous candle ${istStamp(o.prevCandleTime)} IST: ${fmtNum(o.prev)}` : undefined,
      }}
    >
      <span className="font-mono text-slate-300 cursor-help">{cross ? `${fmtNum(o.prev)} → ${fmtNum(o.value)}` : fmtNum(o.value)}</span>
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

export function TraceView({ trace, depth = 0 }: { trace: ExprTrace; depth?: number }) {
  if (trace.condition) return <ConditionLine c={trace.condition} />;
  return (
    <div className={clsx(depth > 0 && 'ml-3 pl-3 border-l border-ink-700')}>
      <div className="flex items-center gap-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{trace.type}</span>
        {trace.label && <span className="text-xs font-medium text-slate-300">{trace.label}</span>}
        <TriBadge value={trace.result} />
      </div>
      {trace.children?.map((c) => <TraceView key={c.id} trace={c} depth={depth + 1} />)}
    </div>
  );
}
