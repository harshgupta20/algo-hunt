'use client';

/**
 * Operand + series pickers. Every value in a condition carries its full data
 * context — leg, timeframe, candle type — so a condition reads unambiguously:
 * [B · CE ATM] [15 min] [Normal] RSI(14). Any leg can be compared with any other.
 *
 * Laid out as a panel with a label column, the same for every value:
 *   What       Indicator / Price, volume, OI / OI change / Number
 *   Indicator  SMA, RSI …              (or Field, Lookback, Number)
 *   Settings   Period · Source · Output · × Mult.
 *   ─────────
 *   Leg        A · FUT, B · CE ATM …
 *   Candles    timeframe · candle type
 * Each control explains itself on hover (no ⓘ next to every label).
 */
import clsx from 'clsx';
import type { CandleSpec, LegDef, LegId, LegKind, Operand, SeriesSpec, SourceField } from '@/shared/v2';
import { CANDLE_TYPES, INDICATOR, INDICATORS, MAX_LEGS, TIMEFRAMES, legName } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { Mini, Panel, Row } from '../../components/condition';
import { LEG_KIND_TEXT } from '../format';
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

/** Quick-add choices offered at the bottom of every Leg list. */
const QUICK_LEGS: Array<{ kind: LegKind; label: string }> = [
  { kind: 'FUT', label: '+ Add FUT leg' },
  { kind: 'CE', label: '+ Add CE ATM leg' },
  { kind: 'PE', label: '+ Add PE ATM leg' },
  { kind: 'SPOT', label: '+ Add SPOT leg' },
];

const sel = 'input py-1 text-xs';

/** A control that explains itself on hover. */
const Help = Tooltip;

export function SeriesPicker({
  value,
  onChange,
  legs,
  onAddLeg,
  label = 'Series',
}: {
  value: SeriesSpec;
  onChange: (s: SeriesSpec) => void;
  /** The strategy's legs. */
  legs: LegDef[];
  /** Adds a leg to the strategy and returns its id (quick add from this list). */
  onAddLeg?: (kind: LegKind) => LegId | undefined;
  /** For screen readers: whose series this is ("Left", "Right", "Pattern"). */
  label?: string;
}) {
  const setCandle = (type: CandleSpec['type']) => onChange({ ...value, candle: type === 'VOLUME' ? { type, volumePerCandle: 10_000 } : { type } });
  const current = legs.find((l) => l.id === value.leg);
  return (
    <>
      <Row label="Leg">
        <Help content={H.editor.leg}>
          <select
            aria-label={`${label} leg`}
            className={clsx(sel, 'font-semibold', current ? LEG_KIND_TEXT[current.kind] : 'text-warn')}
            value={value.leg}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('add:')) {
                const id = onAddLeg?.(v.slice(4) as LegKind);
                if (id) onChange({ ...value, leg: id });
                return;
              }
              onChange({ ...value, leg: v as LegId });
            }}
          >
            {!current && <option value={value.leg}>{value.leg} · (removed leg)</option>}
            {legs.map((l) => (
              <option key={l.id} value={l.id}>
                {legName(l)}
              </option>
            ))}
            {onAddLeg && legs.length < MAX_LEGS && (
              <optgroup label={`Add a leg (${legs.length}/${MAX_LEGS})`}>
                {QUICK_LEGS.map((q) => (
                  <option key={q.kind} value={`add:${q.kind}`}>
                    {q.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Help>
      </Row>
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
  onAddLeg,
  allowConstant = true,
}: {
  value: Operand;
  onChange: (o: Operand) => void;
  side: 'Left' | 'Right';
  defaultSeries: SeriesSpec;
  legs: LegDef[];
  onAddLeg?: (kind: LegKind) => LegId | undefined;
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
  const spec = value.kind === 'INDICATOR' ? INDICATOR[value.indicator] : undefined;
  const left = side === 'Left';

  return (
    <Panel
      title={left ? 'Value' : 'Compared with'}
      help={left ? H.editor.valuePanel : H.editor.comparedPanel}
      footer={value.kind !== 'CONSTANT' && <SeriesPicker label={side} value={value.series} onChange={(s) => onChange({ ...value, series: s } as Operand)} legs={legs} onAddLeg={onAddLeg} />}
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
                value={value.indicator}
                onChange={(e) => onChange({ ...indicatorOperand(value.series, e.target.value), multiplier: value.multiplier })}
              >
                {INDICATORS.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
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
        </>
      )}
    </Panel>
  );
}
