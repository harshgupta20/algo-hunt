/**
 * Assembles the builder catalog (indicators + operators + instruments +
 * timeframes) that drives the data-driven Strategy Builder UI.
 */
import type { BuilderCatalog, CandleTypeSpec, InstrumentSpec, OperatorSpec } from '@ash/shared';
import { TIMEFRAMES } from '@ash/shared';
import { INDICATOR_SPECS } from '../indicator/registry';

const OPERATORS: OperatorSpec[] = [
  {
    value: 'gt', label: 'Greater Than ( > )', arity: 'value', group: 'Numeric',
    description: 'True on every closed candle where the value is strictly greater than the number (or indicator) on the right.',
    example: 'Future Close > 25000',
  },
  {
    value: 'lt', label: 'Less Than ( < )', arity: 'value', group: 'Numeric',
    description: 'True on every closed candle where the value is strictly less than the right-hand side.',
    example: 'Put RSI(14) < 40',
  },
  {
    value: 'gte', label: 'Greater or Equal ( ≥ )', arity: 'value', group: 'Numeric',
    description: 'True while the value is at or above the right-hand side.',
    example: 'Call RSI(14) ≥ 60',
  },
  {
    value: 'lte', label: 'Less or Equal ( ≤ )', arity: 'value', group: 'Numeric',
    description: 'True while the value is at or below the right-hand side.',
    example: 'Put RSI(14) ≤ 40',
  },
  {
    value: 'eq', label: 'Equals ( = )', arity: 'value', group: 'Numeric',
    description: 'True only when the value is exactly equal. Best for whole-number outputs such as Supertrend direction (+1 / −1).',
    example: 'Future Supertrend Direction = 1',
  },
  {
    value: 'neq', label: 'Not Equal ( ≠ )', arity: 'value', group: 'Numeric',
    description: 'True whenever the value is anything other than the right-hand side.',
  },
  {
    value: 'crossAbove', label: 'Cross Above', arity: 'value', group: 'Cross',
    description: 'True only on the candle where the value moves from below the right-hand side to at-or-above it (previous candle below, this candle at or above). One event per crossing — not every candle it stays above.',
    example: 'RSI 59.98 → 60.02 · cross above 60 ✓',
  },
  {
    value: 'crossBelow', label: 'Cross Below', arity: 'value', group: 'Cross',
    description: 'True only on the candle where the value moves from above the right-hand side to at-or-below it. One event per crossing.',
    example: 'Put RSI 40.10 → 39.80 · cross below 40 ✓',
  },
  {
    value: 'rising', label: 'Rising', arity: 'unary', group: 'Trend',
    description: 'True when the value now is higher than it was “Lookback” candles ago.',
    example: 'Future EMA(20) rising over 3 bars',
  },
  {
    value: 'falling', label: 'Falling', arity: 'unary', group: 'Trend',
    description: 'True when the value now is lower than it was “Lookback” candles ago.',
    example: 'Put Close falling over 2 bars',
  },
  {
    value: 'above', label: 'Above', arity: 'value', group: 'State',
    description: 'A state, not an event: true on every candle while the value is at or above the right-hand side. Use Cross Above to catch only the moment it gets there.',
    example: 'Future RSI(14) above 60',
  },
  {
    value: 'below', label: 'Below', arity: 'value', group: 'State',
    description: 'A state: true on every candle while the value is at or below the right-hand side.',
    example: 'Put RSI(14) below 40',
  },
  {
    value: 'between', label: 'Between', arity: 'value2', group: 'Range',
    description: 'True while the value is inside the range, both ends included.',
    example: 'RSI(14) between 40 and 60',
  },
  {
    value: 'outside', label: 'Outside', arity: 'value2', group: 'Range',
    description: 'True while the value is below the low end or above the high end of the range.',
    example: 'RSI(14) outside 30 and 70',
  },
  {
    value: 'increasedByPct', label: 'Increased By %', arity: 'percent', group: 'Percent',
    description: 'True when the value is up by at least this percentage versus “Lookback” candles ago.',
    example: 'Call Volume increased by 50% over 1 bar',
  },
  {
    value: 'decreasedByPct', label: 'Decreased By %', arity: 'percent', group: 'Percent',
    description: 'True when the value is down by at least this percentage versus “Lookback” candles ago.',
    example: 'Future OI decreased by 5% over 3 bars',
  },
  {
    value: 'detected', label: 'Is Detected', arity: 'flag', group: 'Pattern',
    description: 'For candle patterns: true on the closed candle that completes the pattern.',
    example: 'Future Hammer is detected',
  },
];

const CANDLES: CandleTypeSpec[] = [
  {
    value: 'normal',
    label: 'Normal',
    description: 'Standard OHLC candles exactly as Kite reports them.',
  },
  {
    value: 'heikinAshi',
    label: 'Heikin Ashi',
    description:
      'Smoothed candles: close = average of O/H/L/C, open = midpoint of the previous Heikin Ashi candle. Trends show as runs of one color with fewer whipsaws. Indicators and patterns then read these candles.',
  },
];

const INSTRUMENTS: InstrumentSpec[] = [
  {
    value: 'future', label: 'Future', enabled: true,
    description: 'The underlying’s front-month future (the one still trading at the option expiry). Its price also sets the ATM strike.',
  },
  {
    value: 'call', label: 'Call Option (ATM)', enabled: true,
    description: 'The call (CE) at the strategy’s strike — ATM by default, i.e. the strike nearest the future price. A live monitor locks the strike when it starts.',
  },
  {
    value: 'put', label: 'Put Option (ATM)', enabled: true,
    description: 'The put (PE) at the same strike as the call.',
  },
  { value: 'spot', label: 'Spot', enabled: false, description: 'Cash-market index price. Coming soon.' },
  { value: 'index', label: 'Index', enabled: false, description: 'Index level. Coming soon.' },
  { value: 'vix', label: 'VIX', enabled: false, description: 'India VIX volatility index. Coming soon.' },
];

export function builderCatalog(): BuilderCatalog {
  return {
    indicators: INDICATOR_SPECS,
    operators: OPERATORS,
    instruments: INSTRUMENTS,
    timeframes: TIMEFRAMES.map((t) => ({ key: t.key, label: t.label })),
    candles: CANDLES,
  };
}
