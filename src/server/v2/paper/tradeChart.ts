/**
 * A backtest trade's conditions charts (the trader's ask, 2026-11-19: "show the candles with RSI + MA, when the
 * condition was met and when it exited"): for each instrument / timeframe the conditions that fired the trade read —
 * the fired group's, or the whole strategy's — the candles around the trade, the values those conditions compare
 * (computed exactly as the engine computed them: same candles, same indicator code), the numbers they compare with,
 * the signal candle (conditions met; the trade entered at its close) and the candle it exited in.
 *
 * Price values (averages, bands, Supertrend line, N-candle low / high) are drawn on the candles; everything else
 * (RSI and its MA, ADX, DMI, MACD, volume, OI …) in a pane per kind of value under them.
 */
import type { ChartLine, ExprNode, Operand, PaperTrade, SeriesSpec, StrategyDefinition, TradeChart, V2Unit } from '@/shared/v2';
import { TIMEFRAME, candleText, legNameById, operandCore, operandUnit, paperGroups } from '@/shared/v2';
import type { Candle } from '../engine/candles';
import type { SeriesLookup } from '../engine/evaluator';
import { fieldValue, indicatorValues } from '../engine/indicators';
import { forEachLeaf, seriesShapeKey } from '../engine/series';

/** Candles shown before the signal candle, after the exit, and at most in all. */
const BEFORE = 40;
const AFTER = 8;
const MAX_CANDLES = 150;
/** Charts per trade (the instruments / timeframes its conditions read most). */
const MAX_CHARTS = 3;

const PRICE_FIELDS = new Set(['open', 'high', 'low', 'close']);

type SeriesOperand = Exclude<Operand, { kind: 'CONSTANT' }>;

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const keyOf = (s: SeriesSpec) => `${s.leg}|${seriesShapeKey(s)}`;

/** One value per candle, as the engine computes it (multiplier applied). */
function valuesOf(o: SeriesOperand, candles: Candle[]): Array<number | undefined> {
  switch (o.kind) {
    case 'FIELD':
      return candles.map((c) => fieldValue(c, o.field));
    case 'OI_CHANGE':
      return candles.map((c, i) => {
        const past = candles[i - o.lookback];
        return c.oi !== undefined && past?.oi !== undefined ? c.oi - past.oi : undefined;
      });
    case 'INDICATOR': {
      const m = o.multiplier ?? 1;
      return indicatorValues(candles, o).map((v) => (v === undefined ? undefined : v * m));
    }
  }
}

/** The conditions that fired the trade: its group's (a strategy whose top level is OR), else the whole strategy's. */
function firedNode(d: StrategyDefinition, group: string | null): ExprNode {
  return (group && paperGroups(d).find((g) => g.id === group)?.node) || d.expression;
}

export function tradeCharts(x: { definition: StrategyDefinition; unit: V2Unit; lookup: SeriesLookup; trade: Pick<PaperTrade, 'group' | 'entryAt' | 'exitAt'> }): TradeChart[] | undefined {
  const d = x.definition;
  const node = firedNode(d, x.trade.group);

  // Each series the conditions read: the values read from it (with the number each is compared with, if any).
  const bySeries = new Map<string, { spec: SeriesSpec; uses: number; operands: Map<string, { o: SeriesOperand; levels: Set<number> }> }>();
  const use = (spec: SeriesSpec) => {
    const k = keyOf(spec);
    const hit = bySeries.get(k) ?? { spec, uses: 0, operands: new Map() };
    hit.uses++;
    bySeries.set(k, hit);
    return hit;
  };
  forEachLeaf(node, (leaf) => {
    if (leaf.type === 'PATTERN') return void use(leaf.series);
    for (const [o, other] of [
      [leaf.left, leaf.right],
      [leaf.right, leaf.left],
    ] as const) {
      if (o.kind === 'CONSTANT') continue;
      const entry = use(o.series);
      const k = JSON.stringify({ ...o, series: undefined });
      const op = entry.operands.get(k) ?? { o, levels: new Set<number>() };
      if (other.kind === 'CONSTANT') op.levels.add(other.value);
      entry.operands.set(k, op);
    }
  });

  const entryMs = Date.parse(x.trade.entryAt);
  const exitMs = x.trade.exitAt ? Date.parse(x.trade.exitAt) : null;
  const charts: TradeChart[] = [];
  for (const { spec, operands } of [...bySeries.values()].sort((a, b) => b.uses - a.uses).slice(0, MAX_CHARTS)) {
    const inst = x.unit.legs[spec.leg];
    if (!inst) continue;
    const res = x.lookup(inst, spec);
    if ('error' in res || !res.candles.length) continue;
    const candles = res.candles;
    // The signal candle: the last one closed by the entry (the trigger candle itself on the strategy's own timeframe).
    let entry = -1;
    for (let i = 0; i < candles.length && candles[i]!.closeMs <= entryMs; i++) entry = i;
    if (entry < 0) continue;
    let exit: number | null = null;
    if (exitMs !== null) {
      const i = candles.findIndex((c, j) => j > entry && c.closeMs >= exitMs);
      exit = i >= 0 ? i : null;
    }
    const from = Math.max(0, entry - BEFORE);
    const to = Math.min(candles.length, from + MAX_CANDLES, (exit ?? entry) + AFTER + 1);
    const win = candles.slice(from, to);

    const overlays: ChartLine[] = [];
    const levels = new Set<number>();
    const panes = new Map<string, { lines: ChartLine[]; levels: Set<number> }>();
    for (const { o, levels: lv } of operands.values()) {
      const unit = operandUnit(o) ?? 'price';
      const fine = unit === 'ratio' ? r4 : r2;
      const line: ChartLine = { label: operandCore(o), values: valuesOf(o, candles).slice(from, to).map((v) => (v === undefined || !Number.isFinite(v) ? null : fine(v))) };
      if (unit === 'price') {
        // Open / high / low / close are the candles themselves.
        if (!(o.kind === 'FIELD' && PRICE_FIELDS.has(o.field))) overlays.push(line);
        lv.forEach((v) => levels.add(v));
        continue;
      }
      const pane = panes.get(unit) ?? { lines: [], levels: new Set<number>() };
      pane.lines.push(line);
      lv.forEach((v) => pane.levels.add(v));
      panes.set(unit, pane);
    }

    const name = legNameById(spec.leg, d.legs);
    const candle = spec.candle.type === 'NORMAL' ? '' : ` · ${candleText(spec.candle)}`;
    charts.push({
      title: `${name} · ${inst.symbol} · ${TIMEFRAME[spec.timeframe].label}${candle}`,
      candles: win.map((c) => [c.time, r2(c.open), r2(c.high), r2(c.low), r2(c.close)]),
      entry: entry - from,
      exit: exit !== null && exit < to ? exit - from : null,
      overlays,
      levels: [...levels],
      panes: [...panes.values()].map((p) => ({ title: p.lines.map((l) => l.label).join(' · '), lines: p.lines, levels: [...p.levels] })),
    });
  }
  return charts.length ? charts : undefined;
}
