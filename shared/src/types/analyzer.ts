/**
 * Historical Strategy Analyzer (backtesting) domain types. Shared by the
 * backtest runner (server) and the analyzer UI (client). No strategy logic
 * lives here — the runner reuses the live RSI + strategy engine.
 */
import type { CountBucket } from './analytics.js';
import type { ConditionTrace } from './builder.js';
import type { ExpiryType, StrikeSelection } from './config.js';
import type { Leg, Timeframe } from './market.js';
import type { LegReadings, RsiSyncParams, ScenarioId, StrategyKey } from './strategy.js';

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last-week'
  | 'last-month'
  | 'last-3-months'
  | 'last-6-months'
  | 'last-year'
  | 'custom';

/** Filters chosen before running an analysis. */
export interface AnalyzerParams {
  underlying: string;
  /** Group mode: run the strategy across these members and merge results. */
  underlyings?: string[];
  groupName?: string;
  expiryType: ExpiryType;
  strikeSelection: StrikeSelection;
  customStrike?: number;
  timeframe: Timeframe;
  strategy: StrategyKey | string;
  preset: DateRangePreset;
  /** yyyy-mm-dd — required when preset === 'custom'. */
  from?: string;
  to?: string;
  params?: Partial<RsiSyncParams>;
}

/** A historical OHLC candle with volume. `time` is epoch SECONDS (chart-native). */
export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CrossCondition = 'crossed-above' | 'crossed-below' | 'already-above' | 'none';

/** Per-leg reason a match fired — the "why it triggered" explanation. */
export interface LegExplanation {
  leg: Leg;
  label: string;
  prev?: number;
  curr: number;
  level: number;
  condition: CrossCondition;
  /** Rendered summary e.g. "59.98 → 60.02 · crossed above 60". */
  text: string;
}

export interface BacktestAlert {
  id: string;
  /** Candle bucket, epoch ms. */
  bucket: number;
  timestamp: string;
  underlying: string;
  expiry: string;
  strike: number;
  timeframe: Timeframe;
  strategy: StrategyKey | string;
  // Built-in rsi-sync fields:
  scenario?: ScenarioId;
  readings?: LegReadings;
  explanation?: LegExplanation[];
  // Custom-strategy fields:
  variant?: string;
  conditions?: ConditionTrace[];
}

export interface BacktestStats {
  totalAlerts: number;
  scenario1: number;
  scenario2: number;
  avgPerDay: number;
  maxPerDay: number;
  minPerDay: number;
  avgPerWeek: number;
  tradingDays: number;
  byDay: CountBucket[];
  byWeek: CountBucket[];
  byMonth: CountBucket[];
  byUnderlying: CountBucket[];
  byExpiry: CountBucket[];
  byTimeframe: CountBucket[];
  byScenario: CountBucket[];
  /** 7 entries, Mon → Sun. */
  byWeekday: CountBucket[];
  /** One entry per trading hour. */
  byHour: CountBucket[];
}

export interface BacktestMeta {
  underlying: string;
  expiry: string;
  strike: number;
  timeframe: Timeframe;
  from: string;
  to: string;
  candlesAnalyzed: number;
  provider: string;
  tokens: { future: number; call: number; put: number };
}

export interface BacktestResult {
  meta: BacktestMeta;
  alerts: BacktestAlert[];
  stats: BacktestStats;
}

export interface RsiPoint {
  time: number;
  value: number;
}

export interface ChartMarker {
  time: number;
  scenario: ScenarioId;
}

/** A windowed slice of chart data around a selected alert (lazy-loaded). */
export interface ChartWindow {
  candles: OHLCV[];
  futureRsi: RsiPoint[];
  callRsi: RsiPoint[];
  putRsi: RsiPoint[];
  markers: ChartMarker[];
  levels: { future: number; call: number; put: number };
}

export interface ChartWindowRequest {
  params: AnalyzerParams;
  /** Candle bucket (epoch ms) to center the window on. */
  center: number;
  /** Candles to include on each side of center (default server-decided). */
  span?: number;
}
