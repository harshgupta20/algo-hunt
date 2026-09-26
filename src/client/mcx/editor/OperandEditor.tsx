'use client';

/**
 * Operand + series pickers. Every value in a condition carries its full data
 * context — leg (FUT / CE / PE), timeframe, candle type — so a condition reads
 * unambiguously: [GOLD CE] [15 min] [Normal] RSI(14).
 */
import clsx from 'clsx';
import type { CandleSpec, Leg, Operand, SeriesSpec, SourceField } from '@/shared/mcx';
import { MCX2_CANDLE_TYPES, MCX2_INDICATOR, MCX2_INDICATORS, MCX2_LEGS, MCX2_TIMEFRAMES } from '@/shared/mcx';
import { Cell, LEG_TEXT } from '../components';
import { H } from '../help';
import { indicatorOperand } from './defaults';

const FIELDS: Array<{ value: SourceField; label: string }> = [
  { value: 'close', label: 'Close' },
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'volume', label: 'Volume' },
  { value: 'oi', label: 'OI' },
];

export function SeriesPicker({
  value,
  onChange,
  legs,
  label = 'Series',
}: {
  value: SeriesSpec;
  onChange: (s: SeriesSpec) => void;
  /** Legs the strategy offers (FUT only for futures strategies). */
  legs: Leg[];
  label?: string;
}) {
  const setCandle = (type: CandleSpec['type']) => onChange({ ...value, candle: type === 'VOLUME' ? { type, volumePerCandle: 10_000 } : { type } });
  return (
    <>
      <Cell label={`${label} · leg`} help={H.editor.leg}>
        <select
          aria-label={`${label} leg`}
          className={clsx('input py-1 text-xs font-semibold', LEG_TEXT[value.leg])}
          value={value.leg}
          onChange={(e) => onChange({ ...value, leg: e.target.value as Leg })}
        >
          {MCX2_LEGS.map((l) => (
            <option key={l.leg} value={l.leg} disabled={!legs.includes(l.leg) && l.leg !== value.leg}>
              {l.label} — {l.name}
              {!legs.includes(l.leg) ? ' (options only)' : ''}
            </option>
          ))}
        </select>
      </Cell>
      <Cell label="Timeframe" help={H.editor.timeframe}>
        <select aria-label={`${label} timeframe`} className="input py-1 text-xs" value={value.timeframe} onChange={(e) => onChange({ ...value, timeframe: e.target.value as SeriesSpec['timeframe'] })}>
          {MCX2_TIMEFRAMES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </Cell>
      <Cell label="Candles" help={H.editor.candle}>
        <select aria-label={`${label} candle type`} className="input py-1 text-xs" value={value.candle.type} onChange={(e) => setCandle(e.target.value as CandleSpec['type'])}>
          {MCX2_CANDLE_TYPES.map((c) => (
            <option key={c.type} value={c.type}>
              {c.label}
            </option>
          ))}
        </select>
        {value.candle.type === 'VOLUME' && (
          <input
            type="number"
            min={1}
            aria-label="Volume per candle"
            className="input py-1 text-xs w-24"
            value={value.candle.volumePerCandle}
            onChange={(e) => onChange({ ...value, candle: { type: 'VOLUME', volumePerCandle: Math.max(1, Number(e.target.value)) } })}
          />
        )}
      </Cell>
    </>
  );
}

type Kind = Operand['kind'];

export function OperandEditor({
  value,
  onChange,
  side,
  defaultSeries,
  legs,
  allowConstant = true,
}: {
  value: Operand;
  onChange: (o: Operand) => void;
  side: 'Left' | 'Right';
  defaultSeries: SeriesSpec;
  legs: Leg[];
  allowConstant?: boolean;
}) {
  const series = value.kind === 'CONSTANT' ? defaultSeries : value.series;
  const setKind = (k: Kind) => {
    if (k === value.kind) return;
    if (k === 'CONSTANT') onChange({ kind: 'CONSTANT', value: 60 });
    else if (k === 'FIELD') onChange({ kind: 'FIELD', series, field: 'close' });
    else if (k === 'OI_CHANGE') onChange({ kind: 'OI_CHANGE', series, lookback: 1 });
    else onChange(indicatorOperand(series, 'SMA'));
  };
  const spec = value.kind === 'INDICATOR' ? MCX2_INDICATOR[value.indicator] : undefined;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Cell label={`${side} value`} help={H.editor.operandKind}>
        <select aria-label={`${side} value kind`} className="input py-1 text-xs" value={value.kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="INDICATOR">Indicator</option>
          <option value="FIELD">Price / volume / OI</option>
          <option value="OI_CHANGE">OI change</option>
          {allowConstant && <option value="CONSTANT">Number</option>}
        </select>
      </Cell>

      {value.kind === 'CONSTANT' && (
        <Cell label="Number" help={H.editor.constant}>
          <input type="number" aria-label={`${side} number`} className="input py-1 text-xs w-24" value={value.value} onChange={(e) => onChange({ kind: 'CONSTANT', value: Number(e.target.value) })} />
        </Cell>
      )}

      {value.kind !== 'CONSTANT' && <SeriesPicker label={side} value={value.series} onChange={(s) => onChange({ ...value, series: s } as Operand)} legs={legs} />}

      {value.kind === 'FIELD' && (
        <Cell label="Field" help={H.editor.field}>
          <select aria-label={`${side} field`} className="input py-1 text-xs" value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value as SourceField })}>
            {FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Cell>
      )}

      {value.kind === 'OI_CHANGE' && (
        <Cell label="Lookback" help={H.editor.lookback}>
          <input
            type="number"
            min={1}
            aria-label={`${side} OI lookback`}
            className="input py-1 text-xs w-16"
            value={value.lookback}
            onChange={(e) => onChange({ ...value, lookback: Math.max(1, Math.round(Number(e.target.value))) })}
          />
        </Cell>
      )}

      {value.kind === 'INDICATOR' && (
        <>
          <Cell label="Indicator" help={{ ...H.editor.indicator, note: spec?.description }}>
            <select
              aria-label={`${side} indicator`}
              className="input py-1 text-xs"
              value={value.indicator}
              onChange={(e) => onChange({ ...indicatorOperand(value.series, e.target.value), multiplier: value.multiplier })}
            >
              {MCX2_INDICATORS.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </Cell>
          {spec?.params.map((p) => (
            <Cell key={p.name} label={p.label} help={{ title: `${spec.label} · ${p.label}`, body: `Allowed ${p.min}–${p.max}${p.integer ? ' (whole number)' : ''}.`, note: `Default ${p.default}.` }}>
              <input
                type="number"
                aria-label={`${side} ${spec.label} ${p.label}`}
                className="input py-1 text-xs w-16"
                min={p.min}
                max={p.max}
                step={p.integer ? 1 : 0.1}
                value={value.params[p.name] ?? p.default}
                onChange={(e) => onChange({ ...value, params: { ...value.params, [p.name]: Number(e.target.value) } })}
              />
            </Cell>
          ))}
          {spec?.sources && (
            <Cell label="Source" help={H.editor.source}>
              <select
                aria-label={`${side} source`}
                className="input py-1 text-xs"
                value={value.source ?? 'close'}
                onChange={(e) => onChange({ ...value, source: e.target.value === 'close' ? undefined : (e.target.value as SourceField) })}
              >
                {FIELDS.filter((f) => spec.sources!.includes(f.value)).map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Cell>
          )}
          {spec?.outputs && (
            <Cell label="Output" help={H.editor.output}>
              <select aria-label={`${side} output`} className="input py-1 text-xs" value={value.output ?? spec.outputs[0]!.value} onChange={(e) => onChange({ ...value, output: e.target.value })}>
                {spec.outputs.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Cell>
          )}
          <Cell label="× Mult." help={H.editor.multiplier}>
            <input
              type="number"
              step={0.1}
              min={0.01}
              aria-label={`${side} multiplier`}
              className="input py-1 text-xs w-16"
              value={value.multiplier ?? 1}
              onChange={(e) => {
                const m = Number(e.target.value);
                onChange({ ...value, multiplier: !m || m === 1 ? undefined : m });
              }}
            />
          </Cell>
        </>
      )}
    </div>
  );
}
