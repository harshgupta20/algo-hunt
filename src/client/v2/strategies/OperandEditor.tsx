'use client';

/**
 * Operand + series pickers. Every value in a condition carries its full data
 * context — instrument, timeframe, candle type — so a condition reads unambiguously:
 * [CE ATM] [15 min] [Normal] RSI(14). Any instrument can be compared with any other.
 *
 * Laid out as a panel with a label column, the same for every value:
 *   What        Indicator / Price, volume, OI / OI change / Number
 *   Indicator   SMA, RSI, RSI-based MA …   (or Field, Lookback, Number)
 *   Settings    Period · Source · Output · × Mult.
 *   MA of it    None / SMA / EMA / WMA · length   (RSI, ADX)
 *   ─────────
 *   Instrument  SPOT · FUT · CE · PE (+ strike from ATM)
 *   Candles     timeframe · candle type
 * Each control explains itself on hover (no ⓘ next to every label).
 */
import { useState } from 'react';
import clsx from 'clsx';
import type { CandleSpec, LegDef, MaType, Operand, SeriesSpec, SourceField } from '@/shared/v2';
import { CANDLE_TYPES, INDICATOR, INDICATORS, MA_PERIOD, MA_TYPES, RSI_MA_DEFAULT, TIMEFRAMES, legName } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { Mini, Panel, Row } from '../../components/condition';
import { NumberInput } from '../../components/form';
import { LEG_KIND_TEXT } from '../format';
import { H } from '../help';
import { indicatorOperand } from './defaults';
import { FULL_NOTE, InstrumentPicker, type PickInstrument } from './InstrumentPicker';

type IndicatorOperand = Extract<Operand, { kind: 'INDICATOR' }>;

/** The indicator list's entry for TradingView's RSI-based MA (RSI with a moving average of itself). */
const RSI_MA = 'RSI_MA';

/** RSI-based MA on a series, keeping an RSI's own settings when it already is one. */
export function rsiMaOperand(series: SeriesSpec, from?: Operand): IndicatorOperand {
  const rsi = from?.kind === 'INDICATOR' && from.indicator === 'RSI' ? from : indicatorOperand(series, 'RSI');
  return { ...rsi, series, ma: rsi.ma ?? RSI_MA_DEFAULT };
}

const FIELDS: Array<{ value: SourceField; label: string }> = [
  { value: 'close', label: 'Close' },
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'volume', label: 'Volume' },
  { value: 'oi', label: 'OI' },
];

const sel = 'input py-1 text-xs';

/** A control that explains itself on hover. */
const Help = Tooltip;

export function SeriesPicker({
  value,
  onChange,
  legs,
  onPickInstrument,
  label = 'Series',
}: {
  value: SeriesSpec;
  onChange: (s: SeriesSpec) => void;
  /** The strategy's legs (the instruments it reads). */
  legs: LegDef[];
  /** Picks any instrument (adding it to the strategy). Without it, only the strategy's instruments are offered (trailing rules). */
  onPickInstrument?: PickInstrument;
  /** For screen readers: whose series this is ("Left", "Right", "Pattern"). */
  label?: string;
}) {
  const [full, setFull] = useState(false);
  const setCandle = (type: CandleSpec['type']) => onChange({ ...value, candle: type === 'VOLUME' ? { type, volumePerCandle: 10_000 } : { type } });
  const current = legs.find((l) => l.id === value.leg);
  return (
    <>
      <Row label="Instrument">
        {onPickInstrument ? (
          <InstrumentPicker
            label={`${label} instrument`}
            value={current ?? null}
            onChange={(i) => {
              if (!i) return;
              const id = onPickInstrument(i, value.leg);
              setFull(!id);
              if (id && id !== value.leg) onChange({ ...value, leg: id });
            }}
          />
        ) : (
          <Help content={H.editor.instrumentOfStrategy}>
            <select
              aria-label={`${label} instrument`}
              className={clsx(sel, 'font-semibold', current ? LEG_KIND_TEXT[current.kind] : 'text-warn')}
              value={value.leg}
              onChange={(e) => onChange({ ...value, leg: e.target.value as SeriesSpec['leg'] })}
            >
              {!current && <option value={value.leg}>(removed instrument)</option>}
              {legs.map((l) => (
                <option key={l.id} value={l.id}>
                  {legName(l)}
                </option>
              ))}
            </select>
          </Help>
        )}
      </Row>
      {full && <p className="text-[11px] text-warn">{FULL_NOTE}</p>}
      <Row label="Candles">
        <Help content={H.editor.timeframe}>
          <select aria-label={`${label} timeframe`} className={sel} value={value.timeframe} onChange={(e) => onChange({ ...value, timeframe: e.target.value as SeriesSpec['timeframe'] })}>
            {TIMEFRAMES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </Help>
        <Help content={H.editor.candle}>
          <select aria-label={`${label} candle type`} className={sel} value={value.candle.type} onChange={(e) => setCandle(e.target.value as CandleSpec['type'])}>
            {CANDLE_TYPES.map((c) => (
              <option key={c.type} value={c.type}>
                {c.label}
              </option>
            ))}
          </select>
        </Help>
        {value.candle.type === 'VOLUME' && (
          <Mini label="every" help={H.editor.volumePerCandle}>
            <input
              type="number"
              min={1}
              aria-label="Volume per candle"
              className={clsx(sel, 'w-24')}
              value={value.candle.volumePerCandle}
              onChange={(e) => onChange({ ...value, candle: { type: 'VOLUME', volumePerCandle: Math.max(1, Number(e.target.value)) } })}
            />
          </Mini>
        )}
      </Row>
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
  onPickInstrument,
  allowConstant = true,
  defaultIndicator,
}: {
  value: Operand;
  onChange: (o: Operand) => void;
  side: 'Left' | 'Right';
  defaultSeries: SeriesSpec;
  legs: LegDef[];
  onPickInstrument?: PickInstrument;
  allowConstant?: boolean;
  /** The indicator "What → Indicator" starts with (default SMA) — e.g. the RSI-based MA against an RSI. */
  defaultIndicator?: (series: SeriesSpec) => IndicatorOperand;
}) {
  const series = value.kind === 'CONSTANT' ? defaultSeries : value.series;
  const setKind = (k: Kind) => {
    if (k === value.kind) return;
    if (k === 'CONSTANT') onChange({ kind: 'CONSTANT', value: 60 });
    else if (k === 'FIELD') onChange({ kind: 'FIELD', series, field: 'close' });
    else if (k === 'OI_CHANGE') onChange({ kind: 'OI_CHANGE', series, lookback: 1 });
    else onChange(defaultIndicator ? defaultIndicator(series) : indicatorOperand(series, 'SMA'));
  };
  const pickIndicator = (id: string) => {
    if (value.kind !== 'INDICATOR') return;
    if (id === RSI_MA) return onChange({ ...rsiMaOperand(value.series, value), multiplier: value.multiplier });
    // Plain RSI from the RSI-based MA keeps its settings; any other indicator starts from its defaults.
    if (id === 'RSI' && value.indicator === 'RSI') return onChange({ ...value, ma: undefined });
    onChange({ ...indicatorOperand(value.series, id), multiplier: value.multiplier });
  };
  const setMa = (ma: IndicatorOperand['ma']) => value.kind === 'INDICATOR' && onChange({ ...value, ma });
  const spec = value.kind === 'INDICATOR' ? INDICATOR[value.indicator] : undefined;
  const left = side === 'Left';

  return (
    <Panel
      title={left ? 'Value' : 'Compared with'}
      help={left ? H.editor.valuePanel : H.editor.comparedPanel}
      footer={value.kind !== 'CONSTANT' && <SeriesPicker label={side} value={value.series} onChange={(s) => onChange({ ...value, series: s } as Operand)} legs={legs} onPickInstrument={onPickInstrument} />}
    >
      <Row label="What">
        <Help content={H.editor.operandKind}>
          <select aria-label={`${side} value kind`} className={sel} value={value.kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="INDICATOR">Indicator</option>
            <option value="FIELD">Price / volume / OI</option>
            <option value="OI_CHANGE">OI change</option>
            {allowConstant && <option value="CONSTANT">Number</option>}
          </select>
        </Help>
      </Row>

      {value.kind === 'CONSTANT' && (
        <Row label="Number">
          <Help content={H.editor.constant}>
            <input type="number" aria-label={`${side} number`} className={clsx(sel, 'w-28 font-semibold')} value={value.value} onChange={(e) => onChange({ kind: 'CONSTANT', value: Number(e.target.value) })} />
          </Help>
        </Row>
      )}

      {value.kind === 'FIELD' && (
        <Row label="Field">
          <Help content={H.editor.field}>
            <select aria-label={`${side} field`} className={clsx(sel, 'font-semibold')} value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value as SourceField })}>
              {FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Help>
        </Row>
      )}

      {value.kind === 'OI_CHANGE' && (
        <Row label="Lookback">
          <Help content={H.editor.lookback}>
            <input
              type="number"
              min={1}
              aria-label={`${side} OI lookback`}
              className={clsx(sel, 'w-16')}
              value={value.lookback}
              onChange={(e) => onChange({ ...value, lookback: Math.max(1, Math.round(Number(e.target.value))) })}
            />
          </Help>
          <span className="text-[11px] text-slate-500">candle{value.lookback === 1 ? '' : 's'} back</span>
        </Row>
      )}

      {value.kind === 'INDICATOR' && (
        <>
          <Row label="Indicator">
            <Help content={{ ...H.editor.indicator, note: spec?.description }}>
              <select
                aria-label={`${side} indicator`}
                className={clsx(sel, 'font-semibold')}
                value={value.indicator === 'RSI' && value.ma ? RSI_MA : value.indicator}
                onChange={(e) => pickIndicator(e.target.value)}
              >
                {INDICATORS.flatMap((i) => [
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>,
                  ...(i.id === 'RSI'
                    ? [
                        <option key={RSI_MA} value={RSI_MA}>
                          RSI-based MA
                        </option>,
                      ]
                    : []),
                ])}
              </select>
            </Help>
          </Row>
          <Row label="Settings">
            {spec?.params.map((p) => (
              <Mini key={p.name} label={p.label} help={{ title: `${spec.label} · ${p.label}`, body: `Allowed ${p.min}–${p.max}${p.integer ? ' (whole number)' : ''}.`, note: `Default ${p.default}.` }}>
                <input
                  type="number"
                  aria-label={`${side} ${spec.label} ${p.label}`}
                  className={clsx(sel, 'w-14')}
                  min={p.min}
                  max={p.max}
                  step={p.integer ? 1 : 0.1}
                  value={value.params[p.name] ?? p.default}
                  onChange={(e) => onChange({ ...value, params: { ...value.params, [p.name]: Number(e.target.value) } })}
                />
              </Mini>
            ))}
            {spec?.sources && (
              <Mini label="of" help={H.editor.source}>
                <select
                  aria-label={`${side} source`}
                  className={sel}
                  value={value.source ?? 'close'}
                  onChange={(e) => onChange({ ...value, source: e.target.value === 'close' ? undefined : (e.target.value as SourceField) })}
                >
                  {FIELDS.filter((f) => spec.sources!.includes(f.value)).map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Mini>
            )}
            {spec?.outputs && (
              <Mini label="Line" help={H.editor.output}>
                <select aria-label={`${side} output`} className={sel} value={value.output ?? spec.outputs[0]!.value} onChange={(e) => onChange({ ...value, output: e.target.value })}>
                  {spec.outputs.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Mini>
            )}
            <Mini label="×" help={H.editor.multiplier}>
              <input
                type="number"
                step={0.1}
                min={0.01}
                aria-label={`${side} multiplier`}
                className={clsx(sel, 'w-12')}
                value={value.multiplier ?? 1}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  onChange({ ...value, multiplier: !m || m === 1 ? undefined : m });
                }}
              />
            </Mini>
          </Row>
          {spec?.smoothable && (
            <Row label="MA of it">
              <Help content={H.editor.ma}>
                <select
                  aria-label={`${side} moving average of the indicator`}
                  className={clsx(sel, value.ma && 'font-semibold')}
                  value={value.ma?.type ?? ''}
                  onChange={(e) => setMa(e.target.value ? { type: e.target.value as MaType, period: value.ma?.period ?? RSI_MA_DEFAULT.period } : undefined)}
                >
                  <option value="">None</option>
                  {MA_TYPES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Help>
              {value.ma && (
                <Mini label="Length" help={{ ...H.editor.maLength, note: MA_TYPES.find((m) => m.value === value.ma!.type)?.description }}>
                  <NumberInput
                    label={`${side} moving average length`}
                    className={clsx(sel, 'w-14')}
                    min={MA_PERIOD.min}
                    max={MA_PERIOD.max}
                    step={1}
                    value={value.ma.period}
                    onChange={(n) => setMa({ ...value.ma!, period: Math.round(n) })}
                  />
                </Mini>
              )}
            </Row>
          )}
        </>
      )}
    </Panel>
  );
}
