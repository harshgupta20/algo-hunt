/**
 * No-code Strategy Builder domain model. Strategies are stored as structured
 * JSON (never code) and interpreted by the generic strategy engine, so the same
 * definition drives live alerts and historical analysis.
 */
import type { ExpiryType, StrikeSelection } from './config';
import type { Timeframe } from './market';

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

/**
 * Where a strategy runs — its market profile. Each field is either FIXED by the
 * strategy (a value) or OPEN (omitted: chosen per backtest / per monitor).
 *  - All fixed → a "specific" strategy: runs exactly as defined; a backtest only
 *    asks for the date range.
 *  - Anything open → a "universal" strategy: run forms ask only for open fields.
 */
export interface StrategyMarket {
  /** Fixed underlyings: one (single-instrument) or several (a basket). Omitted/empty = any underlying. */
  underlyings?: string[];
  expiryType?: ExpiryType;
  /** Relative to ATM. CUSTOM (a fixed strike price) is a per-run choice, never fixed here. */
  strikeSelection?: Exclude<StrikeSelection, 'CUSTOM'>;
  timeframe?: Timeframe;
}

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
  market: StrategyMarket;
  root: Group;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyDefInput {
  name: string;
  description?: string;
  category?: string;
  notes?: string;
  market: StrategyMarket;
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
  /** Tooltip: what the parameter controls. */
  help?: string;
}

export interface IndicatorSpec {
  kind: IndicatorKind;
  label: string;
  /** Tooltip: what the indicator measures and how traders read it. */
  description?: string;
  example?: string;
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
  /** Tooltip: exactly when the condition is true. */
  description?: string;
  example?: string;
}

export interface InstrumentSpec {
  value: BuilderInstrument;
  label: string;
  enabled: boolean;
  /** Tooltip: which contract this leg resolves to. */
  description?: string;
}

export interface BuilderCatalog {
  indicators: IndicatorSpec[];
  operators: OperatorSpec[];
  instruments: InstrumentSpec[];
  timeframes: Array<{ key: Timeframe; label: string }>;
}
