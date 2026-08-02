/**
 * No-code Strategy Builder domain model. Strategies are stored as structured
 * JSON (never code) and interpreted by the generic strategy engine, so the same
 * definition drives live alerts and historical analysis.
 */
import type { ExpiryType, StrikeSelection } from './config.js';
import type { Timeframe } from './market.js';

export type IndicatorKind =
  | 'RSI'
  | 'EMA'
  | 'SMA'
  | 'VWAP'
  | 'MACD'
  | 'BBANDS'
  | 'SUPERTREND'
  | 'VOLUME'
  | 'PRICE'
  | 'OI';

/** A reference to an indicator with its parameters and (for multi-output) field. */
export interface IndicatorRef {
  kind: IndicatorKind;
  params?: Record<string, number>;
  /** MACD: line|signal|hist · BBANDS: upper|mid|lower · PRICE: open|high|low|close · SUPERTREND: value|direction */
  field?: string;
}

/** Instruments a condition can reference. spot/index/vix are reserved for later. */
export type BuilderInstrument = 'future' | 'call' | 'put' | 'spot' | 'index' | 'vix';

export type Operator =
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'eq'
  | 'neq'
  | 'crossAbove'
  | 'crossBelow'
  | 'rising'
  | 'falling'
  | 'above'
  | 'below'
  | 'between'
  | 'outside'
  | 'increasedByPct'
  | 'decreasedByPct';

export interface Condition {
  type: 'condition';
  id: string;
  instrument: BuilderInstrument;
  indicator: IndicatorRef;
  operator: Operator;
  /** Constant right-hand side (numeric / cross / state / range lower bound / percent). */
  value?: number;
  /** Upper bound for between/outside. */
  value2?: number;
  /** Compare against another indicator instead of a constant. */
  compareTo?: IndicatorRef;
  compareInstrument?: BuilderInstrument;
  /** Bars back for rising/falling/percent operators (default 1). */
  lookback?: number;
  /** Reserved for multi-timeframe; v1 uses the strategy timeframe. */
  timeframe?: Timeframe;
}

export interface Group {
  type: 'group';
  id: string;
  logic: 'AND' | 'OR';
  /** Optional branch name; a matched top-level branch becomes the alert 'variant'. */
  label?: string;
  /** Reserved (NOT support later). */
  not?: boolean;
  children: StrategyNode[];
}

export type StrategyNode = Group | Condition;

export type StrategyStatus = 'draft' | 'active' | 'disabled';
export type StrategyScope = 'index-futures' | 'stock-futures' | 'options' | 'spot';

export interface StrategyDef {
  id: string;
  name: string;
  description?: string;
  category?: string;
  notes?: string;
  status: StrategyStatus;
  version: number;
  /** True for the seeded read-only reference strategy. */
  builtin?: boolean;
  scope: StrategyScope;
  underlying: string;
  expiryType: ExpiryType;
  strikeSelection: StrikeSelection;
  timeframe: Timeframe;
  root: Group;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyDefInput {
  name: string;
  description?: string;
  category?: string;
  notes?: string;
  scope: StrategyScope;
  underlying: string;
  expiryType: ExpiryType;
  strikeSelection: StrikeSelection;
  timeframe: Timeframe;
  root: Group;
  status?: StrategyStatus;
}

export interface StrategyVersion {
  version: number;
  createdAt: string;
  def: StrategyDef;
}

/** One condition's evaluation record, used to explain WHY a strategy fired. */
export interface ConditionTrace {
  label: string;
  instrument: BuilderInstrument;
  operator: Operator;
  prev?: number;
  curr: number;
  rhs?: number;
  passed: boolean;
  text: string;
}

export interface StrategyStats {
  strategyId: string;
  totalAlerts: number;
  alertsToday: number;
  alertsThisWeek: number;
  alertsThisMonth: number;
  avgPerDay: number;
  avgPerWeek: number;
  lastTriggered?: string;
  mostActiveSymbol?: string;
}

// ---- Catalog: drives the data-driven builder UI ----

export interface IndicatorParamSpec {
  name: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
}

export interface IndicatorSpec {
  kind: IndicatorKind;
  label: string;
  params: IndicatorParamSpec[];
  fields?: Array<{ value: string; label: string }>;
  /** Whether the indicator returns a value comparable to a numeric level. */
  numeric: boolean;
}

export type OperatorArity = 'unary' | 'value' | 'value2' | 'percent';

export interface OperatorSpec {
  value: Operator;
  label: string;
  arity: OperatorArity;
  group: string;
}

export interface InstrumentSpec {
  value: BuilderInstrument;
  label: string;
  enabled: boolean;
}

export interface BuilderCatalog {
  indicators: IndicatorSpec[];
  operators: OperatorSpec[];
  instruments: InstrumentSpec[];
  timeframes: Array<{ key: Timeframe; label: string }>;
}
