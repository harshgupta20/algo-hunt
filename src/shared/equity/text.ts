/**
 * Plain-language text for equity strategies — the builder's "Reads as", trade reasons and summaries.
 *   Close · SMA(50) · SMA(20, volume) · SMA(9) of RSI(14) · MACD(12, 26, 9) signal · W · RSI(14) · Close [1 ago]
 */
import { EQ_INDICATOR, EQ_OPERATOR, EQ_TIMEFRAME, PRICE_FIELDS } from './catalog';
import type { EqCondition, EqGroup, EqNode, EqOperand, EqStrategyDefinition, EqTimeframe } from './types';

const fieldLabel = (f: string) => PRICE_FIELDS.find((p) => p.value === f)?.label ?? f;
const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e4) / 1e4));

/** "₹1,234.50" style without the symbol: Indian grouping, 2 decimals (0 for whole thousands). */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** The operand without its timeframe / bars-ago decorations. */
function operandCore(o: EqOperand): string {
  if (o.kind === 'NUMBER') return trim(o.value);
  if (o.kind === 'PRICE') return fieldLabel(o.field);
  const spec = EQ_INDICATOR[o.indicator];
  if (!spec) return o.indicator;
  const params = spec.params.map((p) => trim(o.params[p.name] ?? p.default));
  const source = o.source ?? spec.defaultSource;
  if (spec.sources && source && source !== spec.defaultSource) params.push(source);
  let text = `${spec.short}(${params.join(', ')})`;
  const out = spec.outputs?.find((x) => x.value === (o.output ?? spec.outputs![0]!.value));
  if (spec.outputs && out) {
    const outText = spec.id === 'MACD' ? { line: '', signal: ' signal', hist: ' histogram' }[out.value] ?? ` ${out.label}` : spec.id === 'BB' ? { upper: ' upper', mid: ' middle', lower: ' lower', percentB: ' %B', bandwidth: ' bandwidth' }[out.value] ?? ` ${out.label}` : spec.id === 'SUPERTREND' ? (out.value === 'direction' ? ' direction' : '') : ` ${out.label}`;
    text += outText;
  }
  if (o.ma) text = `${o.ma.type}(${o.ma.period}) of ${text}`;
  if (o.multiplier !== undefined && o.multiplier !== 1) text = `${trim(o.multiplier)} × ${text}`;
  return text;
}

/** Operand as read in a strategy of timeframe `tf` — the timeframe is shown only when it differs. */
export function operandText(o: EqOperand, tf: EqTimeframe): string {
  if (o.kind === 'NUMBER') return operandCore(o);
  const own = o.timeframe ?? tf;
  let text = operandCore(o);
  if (own !== tf) text = `${EQ_TIMEFRAME[own].label} ${text}`;
  if (o.barsAgo) text += ` [${o.barsAgo} ${own === '1w' ? 'week' : 'day'}${o.barsAgo === 1 ? '' : 's'} ago]`;
  return text;
}

export function conditionText(c: EqCondition, tf: EqTimeframe): string {
  return `${operandText(c.left, tf)} ${EQ_OPERATOR[c.op]?.symbol ?? c.op} ${operandText(c.right, tf)}`;
}

export function nodeText(n: EqNode, tf: EqTimeframe, depth = 0): string {
  if (n.type === 'CONDITION') return conditionText(n, tf);
  if (!n.children.length) return '(nothing)';
  const parts = n.children.map((c) => nodeText(c, tf, depth + 1));
  const joined = parts.join(n.type === 'AND' ? ' AND ' : ' OR ');
  const text = depth > 0 && parts.length > 1 ? `(${joined})` : joined;
  return n.label?.trim() && depth > 0 ? `${n.label.trim()}: ${text}` : text;
}

const pct = (n: number) => `${trim(n)}%`;

/** One line per part: when it buys, how it exits, pyramiding, money and fills. */
export function strategySummary(d: EqStrategyDefinition): string[] {
  const tf = d.timeframe;
  const lines = [`${EQ_TIMEFRAME[tf].label}: buy when ${nodeText(d.entry.when, tf)}${d.entry.trigger === 'BECOMES_TRUE' ? ' (only when it turns true)' : ''}`];
  const exits: string[] = [];
  const base = d.exit.priceBase === 'AVERAGE' ? 'average price' : 'first buy';
  if (d.exit.targetPct !== null) exits.push(`target +${pct(d.exit.targetPct)} from the ${base}`);
  if (d.exit.stopLossPct !== null) exits.push(`stop-loss −${pct(d.exit.stopLossPct)} from the ${base}`);
  if (d.exit.trailingStopPct !== null) exits.push(`trailing stop ${pct(d.exit.trailingStopPct)} below the highest high`);
  if (d.exit.when && d.exit.when.children.length) exits.push(`when ${nodeText(d.exit.when, tf)}`);
  if (d.exit.maxBars !== null) exits.push(`after ${d.exit.maxBars} ${tf === '1w' ? 'week' : 'day'}${d.exit.maxBars === 1 ? '' : 's'}`);
  if (d.pyramid.enabled) exits.push(`the pyramiding stop`);
  lines.push(exits.length ? `Sell everything at the first of: ${exits.join('; ')}` : 'No exit set — positions close only at the end of a backtest');
  if (d.pyramid.enabled) {
    const ma = `${d.pyramid.maType}(${d.pyramid.maPeriod})`;
    lines.push(`Pyramiding: when ${ma} rises to the last buy price, buy one more lot; the stop for all lots becomes ${ma}${d.pyramid.maxAdds !== null ? ` (at most ${d.pyramid.maxAdds} add${d.pyramid.maxAdds === 1 ? '' : 's'})` : ''}`);
  }
  const size = d.sizing.mode === 'AMOUNT' ? `₹${fmtNum(d.sizing.value, 0)} per buy` : d.sizing.mode === 'QUANTITY' ? `${trim(d.sizing.value)} share${d.sizing.value === 1 ? '' : 's'} per buy` : `${pct(d.sizing.value)} of the account per buy`;
  lines.push(`${size} · fills at ${d.execution.fill === 'CLOSE' ? 'the signal candle’s close' : 'the next day’s open'} · stops ${d.execution.stopTrigger === 'TOUCH' ? 'on any day’s low' : 'on a closing basis'}${d.costs.charges ? ' · delivery charges' : ''}${d.costs.slippagePct ? ` · ${pct(d.costs.slippagePct)} slippage` : ''}`);
  return lines;
}

/** Every condition in a group, depth first. */
export function leavesOf(n: EqNode | null | undefined, out: EqCondition[] = []): EqCondition[] {
  if (!n) return out;
  if (n.type === 'CONDITION') out.push(n);
  else n.children.forEach((c) => leavesOf(c, out));
  return out;
}

export function groupDepth(g: EqGroup): number {
  return 1 + Math.max(0, ...g.children.map((c) => (c.type === 'CONDITION' ? 0 : groupDepth(c))));
}
