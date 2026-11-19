'use client';

/**
 * The simple conditions view (the trader's ask, 2026-11-19): one line per condition, numbered Leg 1, Leg 2 …
 *
 *   [All legs (AND) | Any leg (OR)]  must be true · 2 legs
 *   Leg 1  [FUT ▾]        [15 min ▾] [RSI ▾] (14)   [Crossed above ▾] [Number ▾]    [60]          ⧉ 🗑
 *   Leg 2  [CE ▾][ATM ▾]  [5 min ▾]  [Close ▾]      [Greater than ▾]  [Indicator ▾] [SMA ▾] (20)  ⧉ 🗑
 *   [+ Add leg]
 *
 * The compared indicator reads the leg's instrument and timeframe. Anything a line can't show is edited in the
 * Advanced view (the full ExpressionEditor) — see simpleRows.ts.
 */
import { Fragment, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Copy, Plus, Trash2 } from 'lucide-react';
import type { ConditionNode, ExprNode, LegDef, LegKind, SeriesSpec } from '@/shared/v2';
import { INDICATOR, LEG_KINDS, OPERATORS, TIMEFRAMES, instrumentOf, isOptionKind, offsetText, operandUnit, type Instrument } from '@/shared/v2';
import { Tooltip, type TooltipContent } from '../../components/Tooltip';
import { IconButton } from '../../components/ui';
import { NumberInput } from '../../components/form';
import { LEG_KIND_TEXT } from '../format';
import { H } from '../help';
import { compareWithClose, isPriceLevel } from './comparison';
import { newCondition } from './defaults';
import { FULL_NOTE, OFFSETS, type PickInstrument } from './InstrumentPicker';
import {
  VALUE_PICKS,
  copyLeg,
  fromLegs,
  legsText,
  operandOf,
  pickOf,
  removeLeg,
  toLegs,
  withLeft,
  withRight,
  withRightKind,
  withSeries,
  type Join,
  type SeriesOperand,
  type SimpleLegs,
  type ValuePick,
} from './simpleRows';

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n${Math.random().toString(36).slice(2)}`);

/** A compact dropdown, as wide as its chosen option where the browser can (Chrome / Edge: field-sizing). */
const sel = 'input py-1 pl-2 pr-7 text-xs [field-sizing:content]';
/** A small number box (no spinner arrows): an indicator's setting, or the number compared with. */
const numberBox = 'input px-1 py-1 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const box = `${numberBox} w-12`;

const UNIT_LABEL: Record<string, string> = {
  price: 'a price',
  oscillator: 'an oscillator (0–100)',
  macd: 'a MACD value',
  direction: 'a direction (+1/−1)',
  volume: 'a volume',
  oi: 'open interest',
  ratio: 'a ratio',
  percent: 'a percentage',
};

// ---- instrument + strike ------------------------------------------------------------------------------

function InstrumentSelect({ leg, n, onPick }: { leg: LegDef | undefined; n: number; onPick: (i: Instrument) => void }) {
  const option = leg && isOptionKind(leg.kind);
  return (
    <>
      <Tooltip content={H.simple.instrument}>
        <select
          aria-label={`Leg ${n} instrument`}
          className={clsx(sel, 'font-semibold', leg ? LEG_KIND_TEXT[leg.kind] : 'text-warn')}
          value={leg?.kind ?? ''}
          onChange={(e) =>
            onPick(
              instrumentOf({
                kind: e.target.value as LegKind,
                strikeOffset: option ? leg!.strikeOffset : 0,
              }),
            )
          }
        >
          {!leg && <option value="">(removed)</option>}
          {LEG_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </Tooltip>
      {option && (
        <Tooltip content={H.simple.strike}>
          <select
            aria-label={`Leg ${n} strike`}
            className={clsx(sel, 'font-semibold', LEG_KIND_TEXT[leg!.kind])}
            value={leg!.strikeOffset ?? 0}
            onChange={(e) => onPick({ kind: leg!.kind, strikeOffset: Number(e.target.value) })}
          >
            {OFFSETS.map((o) => (
              <option key={o} value={o}>
                {offsetText(o)}
              </option>
            ))}
          </select>
        </Tooltip>
      )}
    </>
  );
}

// ---- an indicator / price with its settings ------------------------------------------------------------

/** "(14)", "(RSI 14, MA 9)", "(20, 2) [Upper]": the indicator's settings, each in a small box. */
function Settings({ value, onChange, label }: { value: SeriesOperand; onChange: (o: SeriesOperand) => void; label: string }) {
  const boxes: Array<{
    key: string;
    /** A word before the box where the numbers alone don't say which is which (RSI-based MA: RSI, MA). */
    tag?: string;
    v: number;
    min: number;
    max: number;
    integer: boolean;
    help: TooltipContent;
    set: (x: number) => SeriesOperand;
  }> = [];
  let output: {
    value: string;
    options: Array<{ value: string; label: string }>;
    spec: string;
  } | null = null;
  if (value.kind === 'OI_CHANGE') {
    boxes.push({
      key: 'lookback',
      v: value.lookback,
      min: 1,
      max: 500,
      integer: true,
      help: {
        title: 'OI change · Candles back',
        body: 'OI now minus the OI this many candles ago.',
        note: 'Default 1.',
      },
      set: (x) => ({ ...value, lookback: x }),
    });
  } else if (value.kind === 'INDICATOR') {
    const spec = INDICATOR[value.indicator];
    const ma = value.ma;
    // RSI-based MA / EMA: (RSI 14, MA 9) — the RSI's length, then the average's (TradingView: RSI Length, MA Length).
    const name = ma ? `RSI-based ${ma.type === 'SMA' ? 'MA' : ma.type}` : '';
    for (const p of spec?.params ?? []) {
      boxes.push({
        key: p.name,
        ...(ma ? { tag: 'RSI' } : {}),
        v: value.params[p.name] ?? p.default,
        min: p.min,
        max: p.max,
        integer: p.integer,
        help: ma
          ? { title: `${name} · RSI length`, body: 'The RSI’s own length — TradingView’s “RSI Length”.', example: 'RSI(14) with a 9-period average → (RSI 14, MA 9)', note: 'Default 14.' }
          : { title: `${spec!.label} · ${p.label}`, body: `Allowed ${p.min}–${p.max}${p.integer ? ' (whole number)' : ''}.`, note: `Default ${p.default}.` },
        set: (x) => ({ ...value, params: { ...value.params, [p.name]: x } }),
      });
    }
    if (ma) {
      boxes.push({
        key: 'ma',
        tag: ma.type === 'SMA' ? 'MA' : ma.type,
        v: ma.period,
        min: 1,
        max: 500,
        integer: true,
        help: {
          title: `${name} · ${ma.type === 'SMA' ? 'MA' : ma.type} length`,
          body: `How many RSI values the ${ma.type === 'SMA' ? 'moving average' : ma.type} covers — TradingView’s “MA Length”.`,
          example: 'RSI(14) with a 9-period average → (RSI 14, MA 9)',
          note: 'TradingView’s default: 14.',
        },
        set: (x) => ({ ...value, ma: { ...ma, period: x } }),
      });
    }
    if (spec?.outputs)
      output = {
        value: value.output ?? spec.outputs[0]!.value,
        options: spec.outputs,
        spec: spec.label,
      };
  }
  if (!boxes.length && !output) return null;
  return (
    <>
      {boxes.length > 0 && (
        <span className="inline-flex items-center gap-0.5 text-xs text-slate-500">
          (
          {boxes.map((b, i) => (
            <span key={`${pickOf(value)}-${b.key}`} className="inline-flex items-center gap-0.5">
              {i > 0 && ','}
              {b.tag && <span className="pl-0.5 text-[10px] font-semibold text-slate-400">{b.tag}</span>}
              <Tooltip content={b.help}>
                <NumberInput
                  label={`${label} ${b.help.title}`}
                  className={box}
                  min={b.min}
                  max={b.max}
                  step={b.integer ? 1 : 0.1}
                  value={b.v}
                  onChange={(x) => onChange(b.set(b.integer ? Math.round(x) : x))}
                />
              </Tooltip>
            </span>
          ))}
          )
        </span>
      )}
      {output && (
        <Tooltip content={{ ...H.simple.output, title: `${output.spec} · line` }}>
          <select
            aria-label={`${label} line`}
            className={sel}
            value={output.value}
            onChange={(e) =>
              onChange({
                ...(value as Extract<SeriesOperand, { kind: 'INDICATOR' }>),
                output: e.target.value,
              })
            }
          >
            {output.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Tooltip>
      )}
    </>
  );
}

function ValueSelect({ value, onChange, label }: { value: SeriesOperand; onChange: (o: SeriesOperand) => void; label: string }) {
  const pick = pickOf(value);
  const info = VALUE_PICKS.find((p) => p.value === pick);
  return (
    <>
      <Tooltip content={{ ...H.simple.value, note: info?.body }}>
        <select aria-label={`${label} indicator`} className={clsx(sel, 'font-semibold')} value={pick ?? ''} onChange={(e) => onChange(operandOf(e.target.value as ValuePick, value.series, value))}>
          {(['Price', 'Indicators'] as const).map((g) => (
            <optgroup key={g} label={g}>
              {VALUE_PICKS.filter((p) => p.group === g).map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Tooltip>
      <Settings value={value} onChange={onChange} label={label} />
    </>
  );
}

// ---- one leg ------------------------------------------------------------------------------------------

function LegRow({
  n,
  c,
  legs,
  onPickInstrument,
  fullNote = FULL_NOTE,
  onChange,
  onCopy,
  onRemove,
}: {
  n: number;
  c: ConditionNode;
  legs: LegDef[];
  onPickInstrument: PickInstrument;
  fullNote?: string;
  onChange: (c: ConditionNode) => void;
  onCopy: () => void;
  onRemove: () => void;
}) {
  const [full, setFull] = useState(false);
  const left = c.left as SeriesOperand;
  const series = left.series;
  const leg = legs.find((l) => l.id === series.leg);
  const right = c.right;
  const lu = operandUnit(left);
  const ru = operandUnit(right);
  const levelVsNumber = isPriceLevel(left) && right.kind === 'CONSTANT';
  const pickInstrument = (i: Instrument) => {
    const id = onPickInstrument(i, series.leg);
    setFull(!id);
    if (id && id !== series.leg) onChange(withSeries(c, { ...series, leg: id }));
  };
  const name = `Leg ${n}`;
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-2">
      <div className="flex items-start gap-2">
        {/* The controls wrap on a narrow screen; copy / remove stay on the first line, at the right. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <Tooltip content={H.simple.leg}>
            <span className="mr-1 inline-flex h-6 cursor-help items-center whitespace-nowrap rounded-md bg-accent/15 px-2 text-[11px] font-bold text-accent-soft">{name}</span>
          </Tooltip>
          <InstrumentSelect leg={leg} n={n} onPick={pickInstrument} />
          <Tooltip content={H.simple.timeframe}>
            <select
              aria-label={`${name} timeframe`}
              className={sel}
              value={series.timeframe}
              onChange={(e) =>
                onChange(
                  withSeries(c, {
                    ...series,
                    timeframe: e.target.value as SeriesSpec['timeframe'],
                  }),
                )
              }
            >
              {TIMEFRAMES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </Tooltip>
          <ValueSelect label={name} value={left} onChange={(o) => onChange(withLeft(c, o))} />
          <Tooltip content={H.simple.operator}>
            <select
              aria-label={`${name} comparison`}
              className={clsx(sel, 'border-accent/40 bg-accent/5 font-semibold text-accent-soft')}
              value={c.operator}
              onChange={(e) =>
                onChange({
                  ...c,
                  operator: e.target.value as ConditionNode['operator'],
                })
              }
            >
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Tooltip>
          <Tooltip content={H.simple.rightKind}>
            <select
              aria-label={`${name} compared with`}
              className={sel}
              value={right.kind === 'CONSTANT' ? 'NUMBER' : 'INDICATOR'}
              onChange={(e) => onChange(withRightKind(c, e.target.value as 'NUMBER' | 'INDICATOR'))}
            >
              <option value="NUMBER">Number</option>
              <option value="INDICATOR">Indicator</option>
            </select>
          </Tooltip>
          {right.kind === 'CONSTANT' ? (
            <Tooltip content={H.simple.number}>
              <NumberInput
                label={`${name} number`}
                className={clsx(numberBox, 'w-20 font-semibold')}
                value={right.value}
                onChange={(value) => onChange({ ...c, right: { kind: 'CONSTANT', value } })}
              />
            </Tooltip>
          ) : (
            <ValueSelect label={`${name} compared`} value={right} onChange={(o) => onChange(withRight(c, o))} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 pt-px">
          <IconButton help={H.simple.copy} onClick={onCopy} className="rounded-md p-1.5 text-slate-500 hover:bg-ink-800 hover:text-slate-200">
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton help={H.simple.remove} onClick={onRemove} className="rounded-md p-1.5 text-slate-500 hover:bg-bear/10 hover:text-bear">
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
      {full && <p className="mt-1.5 text-[11px] text-warn">{fullNote}</p>}
      {levelVsNumber && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          This compares a price level with a number — bands and averages are usually compared with the price.
          <Tooltip content={H.editor.compareWithClose}>
            <button type="button" className="btn-ghost py-0.5 text-[11px]" onClick={() => onChange(compareWithClose(c))}>
              Compare Close with it
            </button>
          </Tooltip>
        </p>
      )}
      {lu && ru && lu !== ru && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {UNIT_LABEL[lu] ?? lu} can’t be compared with {UNIT_LABEL[ru] ?? ru} — pick another indicator or a number.
        </p>
      )}
    </div>
  );
}

// ---- the legs -----------------------------------------------------------------------------------------

/** The AND / OR in the gap between two legs — click to switch. OR is drawn across the list: it splits the blocks. */
function JoinButton({ join, gap, onToggle }: { join: Join; gap: number; onToggle: () => void }) {
  const a = gap + 1;
  const b = gap + 2;
  const help: TooltipContent =
    join === 'AND'
      ? { ...H.simple.joinAnd, body: `Leg ${a} and Leg ${b} must both be true. Click to make it OR.` }
      : { ...H.simple.joinOr, body: `Either side of this line is enough: the legs above it, or the legs below it. Click to make it AND.` };
  const pill = (
    <Tooltip content={help}>
      <button
        type="button"
        aria-label={`Between leg ${a} and leg ${b}: ${join}`}
        onClick={onToggle}
        className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-accent-soft hover:bg-accent/20"
      >
        {join}
      </button>
    </Tooltip>
  );
  return join === 'AND' ? (
    <div className="flex items-center gap-2 pl-5">
      <span className="h-3 w-px bg-accent/40" />
      {pill}
    </div>
  ) : (
    <div className="flex items-center gap-2 py-1">
      <span className="h-px flex-1 bg-accent/30" />
      {pill}
      <span className="h-px flex-1 bg-accent/30" />
    </div>
  );
}

/**
 * All legs / any leg (sets every gap), then the legs with the AND / OR in each gap — AND joins first, so the legs
 * between two ORs form a block (marked at its left). Shown only when every condition fits a line (`simpleIssue`).
 */
export function SimpleConditions({
  expression,
  onChange,
  defaultSeries,
  legs,
  onPickInstrument,
  fullNote,
}: {
  expression: ExprNode;
  onChange: (root: ExprNode) => void;
  defaultSeries: SeriesSpec;
  legs: LegDef[];
  onPickInstrument: PickInstrument;
  /** Said when an instrument can't be picked (default: the 4-instrument limit). */
  fullNote?: string;
}) {
  const m = toLegs(expression);
  const set = (next: SimpleLegs) => onChange(fromLegs(next, expression));
  const n = m.legs.length;
  const allAnd = n > 1 ? m.joins.every((j) => j === 'AND') : m.mode === 'AND';
  const allOr = n > 1 ? m.joins.every((j) => j === 'OR') : m.mode === 'OR';
  const setAll = (j: Join) => set({ ...m, joins: m.joins.map(() => j), mode: j });
  const blocks: number[][] = [];
  m.legs.forEach((_, i) => (i === 0 || m.joins[i - 1] === 'OR' ? blocks.push([i]) : blocks[blocks.length - 1]!.push(i)));
  const row = (i: number) => {
    const c = m.legs[i]!;
    return (
      <LegRow
        key={c.id}
        n={i + 1}
        c={c}
        legs={legs}
        onPickInstrument={onPickInstrument}
        fullNote={fullNote}
        onChange={(next) => set({ ...m, legs: m.legs.map((x, j) => (j === i ? next : x)) })}
        onCopy={() => set(copyLeg(m, i, uid()))}
        onRemove={() => set(removeLeg(m, i))}
      />
    );
  };
  const toggle = (gap: number) => set({ ...m, joins: m.joins.map((j, k) => (k === gap ? (j === 'AND' ? 'OR' : 'AND') : j)) });
  return (
    <div className="flex flex-col gap-1.5">
      <div className="mb-0.5 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Legs logic" className="flex overflow-hidden rounded-lg border border-ink-700 text-xs">
          {(['AND', 'OR'] as const).map((l) => {
            const on = l === 'AND' ? allAnd : allOr;
            return (
              <Tooltip key={l} content={l === 'AND' ? H.simple.all : H.simple.any}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setAll(l)}
                  className={clsx('px-3 py-1.5 font-semibold', on ? 'bg-accent text-white' : 'bg-ink-900 text-slate-400 hover:text-slate-200')}
                >
                  {l === 'AND' ? 'All legs' : 'Any leg'} <span className={clsx('font-normal', on ? 'text-white/75' : 'text-slate-500')}>({l})</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
        {allAnd || allOr ? (
          <span className="text-[12px] text-slate-400">{`${allAnd ? 'must be true' : 'is enough'} · ${n} leg${n === 1 ? '' : 's'}`}</span>
        ) : (
          <Tooltip content={H.simple.mixed}>
            <span className="cursor-help text-[12px] text-slate-400">
              Alerts when <span className="font-semibold text-fg">{legsText(m)}</span> · AND joins first
            </span>
          </Tooltip>
        )}
      </div>
      {blocks.map((b, bi) => (
        <Fragment key={m.legs[b[0]!]!.id}>
          {bi > 0 && <JoinButton join="OR" gap={b[0]! - 1} onToggle={() => toggle(b[0]! - 1)} />}
          <div className={clsx('flex flex-col gap-1.5', blocks.length > 1 && b.length > 1 && 'border-l-2 border-accent/40 pl-2')}>
            {b.map((i, k) => (
              <Fragment key={m.legs[i]!.id}>
                {k > 0 && <JoinButton join="AND" gap={i - 1} onToggle={() => toggle(i - 1)} />}
                {row(i)}
              </Fragment>
            ))}
          </div>
        </Fragment>
      ))}
      {n === 0 && <p className="text-xs text-warn">No legs yet — add one.</p>}
      <div className="mt-0.5">
        <Tooltip content={H.simple.add}>
          <button
            type="button"
            className="btn-ghost py-1 text-xs"
            onClick={() => set({ ...m, legs: [...m.legs, newCondition(defaultSeries)], joins: n ? [...m.joins, m.joins[m.joins.length - 1] ?? m.mode] : [] })}
          >
            <Plus className="h-3.5 w-3.5" /> Add leg
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
