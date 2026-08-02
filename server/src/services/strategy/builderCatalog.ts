/**
 * Assembles the builder catalog (indicators + operators + instruments +
 * timeframes) that drives the data-driven Strategy Builder UI.
 */
import type { BuilderCatalog, InstrumentSpec, OperatorSpec } from '@ash/shared';
import { TIMEFRAMES } from '@ash/shared';
import { INDICATOR_SPECS } from '../indicator/registry.js';

const OPERATORS: OperatorSpec[] = [
  { value: 'gt', label: 'Greater Than ( > )', arity: 'value', group: 'Numeric' },
  { value: 'lt', label: 'Less Than ( < )', arity: 'value', group: 'Numeric' },
  { value: 'gte', label: 'Greater or Equal ( ≥ )', arity: 'value', group: 'Numeric' },
  { value: 'lte', label: 'Less or Equal ( ≤ )', arity: 'value', group: 'Numeric' },
  { value: 'eq', label: 'Equals ( = )', arity: 'value', group: 'Numeric' },
  { value: 'neq', label: 'Not Equal ( ≠ )', arity: 'value', group: 'Numeric' },
  { value: 'crossAbove', label: 'Cross Above', arity: 'value', group: 'Cross' },
  { value: 'crossBelow', label: 'Cross Below', arity: 'value', group: 'Cross' },
  { value: 'rising', label: 'Rising', arity: 'unary', group: 'Trend' },
  { value: 'falling', label: 'Falling', arity: 'unary', group: 'Trend' },
  { value: 'above', label: 'Above', arity: 'value', group: 'State' },
  { value: 'below', label: 'Below', arity: 'value', group: 'State' },
  { value: 'between', label: 'Between', arity: 'value2', group: 'Range' },
  { value: 'outside', label: 'Outside', arity: 'value2', group: 'Range' },
  { value: 'increasedByPct', label: 'Increased By %', arity: 'percent', group: 'Percent' },
  { value: 'decreasedByPct', label: 'Decreased By %', arity: 'percent', group: 'Percent' },
];

const INSTRUMENTS: InstrumentSpec[] = [
  { value: 'future', label: 'Future', enabled: true },
  { value: 'call', label: 'Call Option (ATM)', enabled: true },
  { value: 'put', label: 'Put Option (ATM)', enabled: true },
  { value: 'spot', label: 'Spot', enabled: false },
  { value: 'index', label: 'Index', enabled: false },
  { value: 'vix', label: 'VIX', enabled: false },
];

export function builderCatalog(): BuilderCatalog {
  return {
    indicators: INDICATOR_SPECS,
    operators: OPERATORS,
    instruments: INSTRUMENTS,
    timeframes: TIMEFRAMES.map((t) => ({ key: t.key, label: t.label })),
  };
}
