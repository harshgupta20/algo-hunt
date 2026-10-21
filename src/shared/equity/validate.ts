/**
 * Semantic checks for equity strategies (shape is checked by schema.ts): comparable units, indicator settings
 * within bounds, at least one way out, and how much history each timeframe needs.
 */
import { EQ_INDICATOR, EQ_LIMITS } from './catalog';
import { conditionText, groupDepth, leavesOf } from './text';
import type { EqGroup, EqOperand, EqStrategyDefinition, EqUnit, ValidationIssue } from './types';

/** What an operand measures; null for a plain number (comparable with anything). */
export function operandUnit(o: EqOperand): EqUnit | null {
  if (o.kind === 'NUMBER') return null;
  if (o.kind === 'PRICE') return o.field === 'volume' ? 'volume' : 'price';
  const spec = EQ_INDICATOR[o.indicator];
  if (!spec) return null;
  const out = spec.outputs?.find((x) => x.value === (o.output ?? spec.outputs![0]!.value));
  const unit = out?.unit ?? spec.unit;
  if (unit !== 'source') return unit;
  return (o.source ?? spec.defaultSource) === 'volume' ? 'volume' : 'price';
}

const UNIT_TEXT: Record<EqUnit, string> = {
  price: 'a price',
  oscillator: 'a 0–100 oscillator',
  macd: 'a MACD value',
  volume: 'a volume',
  percent: 'a percentage',
  ratio: 'a ratio',
  direction: 'a direction (+1 / −1)',
  range: 'a price range (₹ per candle)',
};

/** Candles of its own timeframe an operand needs before its value is reliable (recursive averages need
 *  extra history to settle to TradingView's numbers). */
export function operandBars(o: EqOperand): number {
  if (o.kind === 'NUMBER') return 0;
  const back = (o.barsAgo ?? 0) + 1; // +1: crossings read the previous check
  if (o.kind === 'PRICE') return back;
  const p = (name: string, def: number) => o.params[name] ?? EQ_INDICATOR[o.indicator]?.params.find((x) => x.name === name)?.default ?? def;
  const period = p('period', 14);
  let need: number;
  switch (o.indicator) {
    case 'SMA':
    case 'WMA':
    case 'BB':
      need = period;
      break;
    case 'HIGHEST':
    case 'LOWEST':
    case 'ROC':
      need = period + 1;
      break;
    case 'EMA':
      need = period * 3;
      break;
    case 'RSI':
    case 'ATR':
    case 'SUPERTREND':
    case 'DMI':
      need = period * 4 + 1;
      break;
    case 'ADX':
      need = (period + p('smoothing', 14)) * 3;
      break;
    case 'MACD':
      need = p('slow', 26) * 3 + p('signal', 9);
      break;
    default:
      need = period;
  }
  if (o.ma) need += o.ma.type === 'EMA' ? o.ma.period * 3 : o.ma.period;
  return need + back;
}

/** Candles of the strategy's timeframe needed before the first check can be decided (entry, exits and pyramiding MA). */
export function requiredBars(d: EqStrategyDefinition): number {
  let need = 0;
  for (const c of [...leavesOf(d.entry.when), ...leavesOf(d.exit.when)]) for (const o of [c.left, c.right]) need = Math.max(need, operandBars(o));
  if (d.pyramid.enabled) need = Math.max(need, (d.pyramid.maType === 'EMA' ? d.pyramid.maPeriod * 3 : d.pyramid.maPeriod) + 1);
  return need;
}

/** Candles a recursive average (smoothing factor `alpha`) needs to forget where it started, to 1 part in 10⁷. */
const forget = (alpha: number) => Math.ceil(Math.log(1e-7) / Math.log(1 - alpha));
const emaSettle = (n: number) => n + forget(2 / (n + 1));
const rmaSettle = (n: number) => n + forget(1 / n);

/**
 * Candles before an operand's value equals — to 1 part in 10⁷ — the value TradingView computes from the stock's
 * first candle. Plain windows (SMA, WMA, Bollinger, highest / lowest, ROC) are exact after their period; recursive
 * ones (EMA, Wilder's RSI / ATR / DMI / ADX, MACD, Supertrend) carry their start forward and need far more.
 */
export function operandSettleBars(o: EqOperand): number {
  if (o.kind === 'NUMBER') return 0;
  const back = (o.barsAgo ?? 0) + 1;
  if (o.kind === 'PRICE') return back;
  const p = (name: string, def: number) => o.params[name] ?? EQ_INDICATOR[o.indicator]?.params.find((x) => x.name === name)?.default ?? def;
  const period = p('period', 14);
  let need: number;
  switch (o.indicator) {
    case 'EMA':
      need = emaSettle(period);
      break;
    case 'RSI':
    case 'ATR':
    case 'DMI':
      need = rmaSettle(period) + 1;
      break;
    case 'SUPERTREND':
      // ATR settles like any Wilder average; the bands ratchet until the trend flips, so allow a year of flips.
      need = rmaSettle(period) + 250;
      break;
    case 'ADX':
      need = rmaSettle(period) + rmaSettle(p('smoothing', 14)) + 1;
      break;
    case 'MACD':
      need = emaSettle(p('slow', 26)) + emaSettle(p('signal', 9));
      break;
    default:
      need = period + 1;
  }
  if (o.ma) need += o.ma.type === 'EMA' ? emaSettle(o.ma.period) : o.ma.period;
  return need + back;
}

/** Candles of the strategy's timeframe to fetch before the period so every value matches TradingView's. */
export function settleBars(d: EqStrategyDefinition): number {
  let need = 0;
  for (const c of [...leavesOf(d.entry.when), ...leavesOf(d.exit.when)]) for (const o of [c.left, c.right]) need = Math.max(need, operandSettleBars(o));
  if (d.pyramid.enabled) need = Math.max(need, operandSettleBars({ kind: 'INDICATOR', indicator: d.pyramid.maType, params: { period: d.pyramid.maPeriod } }));
  return need;
}

function checkOperand(o: EqOperand, path: string, issues: ValidationIssue[]) {
  if (o.kind === 'NUMBER') {
    if (!Number.isFinite(o.value)) issues.push({ path, message: 'Enter a number', severity: 'error' });
    return;
  }
  if (o.barsAgo !== undefined && (o.barsAgo < 0 || o.barsAgo > EQ_LIMITS.maxBarsAgo || !Number.isInteger(o.barsAgo))) issues.push({ path, message: `“Candles ago” must be a whole number from 0 to ${EQ_LIMITS.maxBarsAgo}`, severity: 'error' });
  if (o.kind === 'PRICE') return;
  const spec = EQ_INDICATOR[o.indicator];
  if (!spec) {
    issues.push({ path, message: `Unknown indicator ${o.indicator}`, severity: 'error' });
    return;
  }
  for (const p of spec.params) {
    const v = o.params[p.name] ?? p.default;
    if (!Number.isFinite(v) || v < p.min || v > p.max || (p.integer && !Number.isInteger(v))) issues.push({ path, message: `${spec.short} ${p.label.toLowerCase()} must be ${p.integer ? 'a whole number ' : ''}from ${p.min} to ${p.max}`, severity: 'error' });
  }
  if (o.indicator === 'MACD' && (o.params.fast ?? 12) >= (o.params.slow ?? 26)) issues.push({ path, message: 'MACD fast must be shorter than slow', severity: 'error' });
  if (o.source && !spec.sources?.includes(o.source)) issues.push({ path, message: `${spec.short} can’t be computed on ${o.source}`, severity: 'error' });
  if (o.output && !spec.outputs?.some((x) => x.value === o.output)) issues.push({ path, message: `${spec.short} has no “${o.output}” line`, severity: 'error' });
  if (o.ma) {
    if (!spec.smoothable) issues.push({ path, message: `${spec.short} can’t take a moving average of itself`, severity: 'error' });
    if (!Number.isInteger(o.ma.period) || o.ma.period < 1 || o.ma.period > 500) issues.push({ path, message: 'The moving average period must be a whole number from 1 to 500', severity: 'error' });
  }
  if (o.multiplier !== undefined && !(o.multiplier > 0)) issues.push({ path, message: 'The multiplier must be above 0', severity: 'error' });
}

function checkGroup(g: EqGroup, path: string, d: EqStrategyDefinition, issues: ValidationIssue[]) {
  if (groupDepth(g) > EQ_LIMITS.maxDepth) issues.push({ path, message: `At most ${EQ_LIMITS.maxDepth} levels of groups`, severity: 'error' });
  const leaves = leavesOf(g);
  if (leaves.length > EQ_LIMITS.maxConditions) issues.push({ path, message: `At most ${EQ_LIMITS.maxConditions} conditions`, severity: 'error' });
  const walk = (n: EqGroup, p: string) => {
    if (!n.children.length) issues.push({ path: p, message: 'Empty group — add a condition or remove it', severity: 'error' });
    n.children.forEach((c, i) => {
      const cp = `${p}.${i}`;
      if (c.type !== 'CONDITION') return walk(c, cp);
      checkOperand(c.left, `${cp}.left`, issues);
      checkOperand(c.right, `${cp}.right`, issues);
      if (c.left.kind === 'NUMBER' && c.right.kind === 'NUMBER') issues.push({ path: cp, message: `${conditionText(c, d.timeframe)}: compare a price or indicator, not two numbers`, severity: 'error' });
      const [lu, ru] = [operandUnit(c.left), operandUnit(c.right)];
      if (lu && ru && lu !== ru) issues.push({ path: cp, message: `${conditionText(c, d.timeframe)}: compares ${UNIT_TEXT[lu]} with ${UNIT_TEXT[ru]}`, severity: 'error' });
      if (c.left.kind === 'NUMBER' && (c.op === 'CROSSES_ABOVE' || c.op === 'CROSSES_BELOW')) issues.push({ path: cp, message: `${conditionText(c, d.timeframe)}: put the number on the right of a crossing`, severity: 'error' });
    });
  };
  walk(g, path);
}

export function validateDefinition(d: EqStrategyDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!d.name.trim()) issues.push({ path: 'name', message: 'Give the strategy a name', severity: 'error' });
  if (!leavesOf(d.entry.when).length) issues.push({ path: 'entry', message: 'Add at least one entry condition', severity: 'error' });
  checkGroup(d.entry.when, 'entry', d, issues);
  if (d.exit.when) {
    if (leavesOf(d.exit.when).length) checkGroup(d.exit.when, 'exit.when', d, issues);
    else if (d.exit.when.children.length) issues.push({ path: 'exit.when', message: 'Empty exit group — add a condition or remove it', severity: 'error' });
  }
  const pctOk = (v: number | null, max: number) => v === null || (v > 0 && v <= max);
  if (!pctOk(d.exit.targetPct, EQ_LIMITS.maxPct)) issues.push({ path: 'exit.targetPct', message: `Target must be above 0 and at most ${EQ_LIMITS.maxPct}%`, severity: 'error' });
  if (!pctOk(d.exit.stopLossPct, 99)) issues.push({ path: 'exit.stopLossPct', message: 'Stop-loss must be above 0 and below 100%', severity: 'error' });
  if (!pctOk(d.exit.trailingStopPct, 99)) issues.push({ path: 'exit.trailingStopPct', message: 'Trailing stop must be above 0 and below 100%', severity: 'error' });
  if (d.exit.maxBars !== null && (!Number.isInteger(d.exit.maxBars) || d.exit.maxBars < 1 || d.exit.maxBars > EQ_LIMITS.maxHoldingBars)) issues.push({ path: 'exit.maxBars', message: `Time exit must be a whole number of candles from 1 to ${EQ_LIMITS.maxHoldingBars}`, severity: 'error' });
  const hasExit = d.exit.targetPct !== null || d.exit.stopLossPct !== null || d.exit.trailingStopPct !== null || leavesOf(d.exit.when).length > 0 || d.exit.maxBars !== null || d.pyramid.enabled;
  if (!hasExit) issues.push({ path: 'exit', message: 'No exit: positions only close at the end of a backtest — add a target, a stop or an exit condition', severity: 'warning' });
  else if (d.pyramid.enabled && d.exit.targetPct === null && d.exit.stopLossPct === null && d.exit.trailingStopPct === null && !leavesOf(d.exit.when).length && d.exit.maxBars === null)
    issues.push({ path: 'exit', message: 'Pyramiding is the only exit: the first lot has no stop until the first add, so a stock whose MA never reaches the buy price is held to the end — add a stop-loss or an exit condition', severity: 'warning' });
  if (d.pyramid.enabled) {
    if (!Number.isInteger(d.pyramid.maPeriod) || d.pyramid.maPeriod < 2 || d.pyramid.maPeriod > 500) issues.push({ path: 'pyramid.maPeriod', message: 'Pyramiding MA period must be a whole number from 2 to 500', severity: 'error' });
    if (d.pyramid.maxAdds !== null && (!Number.isInteger(d.pyramid.maxAdds) || d.pyramid.maxAdds < 1 || d.pyramid.maxAdds > EQ_LIMITS.maxAdds)) issues.push({ path: 'pyramid.maxAdds', message: `Max adds must be a whole number from 1 to ${EQ_LIMITS.maxAdds}`, severity: 'error' });
  }
  if (!(d.sizing.value > 0)) issues.push({ path: 'sizing', message: 'Money per buy must be above 0', severity: 'error' });
  if (d.sizing.mode === 'QUANTITY' && !Number.isInteger(d.sizing.value)) issues.push({ path: 'sizing', message: 'Shares per buy must be a whole number', severity: 'error' });
  if (d.sizing.mode === 'PERCENT' && d.sizing.value > 100) issues.push({ path: 'sizing', message: 'At most 100% of the account per buy', severity: 'error' });
  const need = requiredBars(d);
  if (d.timeframe === '1w' && need > 260) issues.push({ path: 'entry', message: `Needs ${need} weekly candles (~${Math.round(need / 52)} years) of history before it can decide — newer stocks will be skipped until then`, severity: 'warning' });
  if (d.timeframe === '1d' && need > 750) issues.push({ path: 'entry', message: `Needs ${need} daily candles (~${Math.round(need / 250)} years) of history before it can decide`, severity: 'warning' });
  return issues;
}

export const hasErrors = (issues: ValidationIssue[]) => issues.some((i) => i.severity === 'error');
