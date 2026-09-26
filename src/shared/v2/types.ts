/**
 * V2 domain model — product-agnostic strategies.
 *
 *   Strategy   (logic only: 1–4 legs + conditions + evaluation clock — no product)
 * + Connection (strategy → product, with expiry, strikes to scan and alert settings)
 * = Alert
 *
 * Products (NSE indices, NSE stocks, MCX commodities) are an independent catalogue.
 * A leg is a placeholder — SPOT, FUT, CE or PE (options relative to ATM) — that a
 * connection turns into a real contract of the chosen product. Conditions compare
 * any leg with any other leg, each on its own timeframe and candle type.
 */

// ---- Markets, products, instruments -------------------------------------------------------

/** Session calendar a product trades in (BSE follows NSE hours). */
export type Market = 'NSE' | 'MCX';
export type Exchange = 'NSE' | 'BSE' | 'NFO' | 'BFO' | 'MCX';
export type ProductKind = 'INDEX' | 'STOCK' | 'COMMODITY';
/** SPOT = the index value or the stock's cash price. */
export type LegKind = 'SPOT' | 'FUT' | 'CE' | 'PE';

export interface V2Instrument {
  /** `K:<token>` (Kite instrument tokens are unique across exchanges). */
  id: string;
  token: number;
  exchange: Exchange;
  /** e.g. `NSE:NIFTY`, `NSE:RELIANCE`, `MCX:GOLD`. */
  productId: string;
  kind: LegKind;
  /** Kite tradingsymbol, e.g. NIFTY25OCT25000CE, "NIFTY 50", GOLD26DECFUT. */
  symbol: string;
  expiry: string | null;
  strike: number | null;
  lotSize: number;
  tickSize: number;
}

export interface V2Product {
  /** `NSE:NIFTY`, `BSE:SENSEX`, `NSE:RELIANCE`, `MCX:GOLD`. */
  id: string;
  market: Market;
  kind: ProductKind;
  symbol: string;
  name: string;
  hasSpot: boolean;
  hasFutures: boolean;
  hasOptions: boolean;
  futureExpiries: string[];
  optionExpiries: string[];
  /** Typical gap between listed strikes (nearest option expiry). */
  strikeStep: number | null;
  lotSize: number | null;
}

// ---- Series, operands, expression -------------------------------------------------------------

export type Timeframe = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d' | '1w';

export type CandleSpec =
  | { type: 'NORMAL' }
  | { type: 'HEIKIN_ASHI' }
  /** Consecutive candles of the series timeframe merged until volume ≥ volumePerCandle (restarts daily). */
  | { type: 'VOLUME'; volumePerCandle: number };
export type CandleType = CandleSpec['type'];

export type LegId = 'A' | 'B' | 'C' | 'D';

export interface LegDef {
  id: LegId;
  kind: LegKind;
  /** CE / PE: listed strikes away from ATM (0 = ATM, +1 = one strike above, −2 = two below). */
  strikeOffset?: number;
  /** Optional name shown instead of the default ("B · CE ATM+1"). */
  label?: string;
}

export interface SeriesSpec {
  leg: LegId;
  timeframe: Timeframe;
  candle: CandleSpec;
}

export type PriceField = 'open' | 'high' | 'low' | 'close';
export type SourceField = PriceField | 'volume' | 'oi';

/**
 * A value in a condition. Comparing legs = an operand on one leg vs an operand on another.
 * (Room for later: arithmetic operands such as differences, % gaps and strike levels.)
 */
export type Operand =
  | { kind: 'CONSTANT'; value: number }
  | { kind: 'FIELD'; series: SeriesSpec; field: SourceField }
  | { kind: 'OI_CHANGE'; series: SeriesSpec; lookback: number }
  | {
      kind: 'INDICATOR';
      series: SeriesSpec;
      indicator: string;
      params: Record<string, number>;
      source?: SourceField;
      output?: string;
      multiplier?: number;
    };

export type Operator = 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ' | 'CROSSED_ABOVE' | 'CROSSED_BELOW';

export type PatternId =
  | 'DOJI'
  | 'HAMMER'
  | 'INVERTED_HAMMER'
  | 'SHOOTING_STAR'
  | 'HANGING_MAN'
  | 'BULLISH_ENGULFING'
  | 'BEARISH_ENGULFING'
  | 'MORNING_STAR'
  | 'EVENING_STAR'
  | 'BULLISH_HARAMI'
  | 'BEARISH_HARAMI'
  | 'PIERCING'
  | 'DARK_CLOUD_COVER'
  | 'THREE_WHITE_SOLDIERS'
  | 'THREE_BLACK_CROWS'
  | 'BULLISH_MARUBOZU'
  | 'BEARISH_MARUBOZU'
  | 'ANY_BULLISH'
  | 'ANY_BEARISH';

export interface ConditionNode {
  type: 'CONDITION';
  id: string;
  left: Operand;
  operator: Operator;
  right: Operand;
}
export interface PatternNode {
  type: 'PATTERN';
  id: string;
  series: SeriesSpec;
  pattern: PatternId;
}
export interface GroupNode {
  type: 'AND' | 'OR';
  id: string;
  label?: string;
  children: ExprNode[];
}
export interface NotNode {
  type: 'NOT';
  id: string;
  child: ExprNode;
}
export type ExprNode = GroupNode | NotNode | ConditionNode | PatternNode;

// ---- Strategy (product-agnostic) ----------------------------------------------------------------

export type EvaluationMode = 'COMPLETED_CANDLE' | 'LIVE_CANDLE';
export interface Evaluation {
  mode: EvaluationMode;
  /** The clock: evaluated when this timeframe's candle closes (or every minute in live mode). */
  triggerTimeframe: Timeframe;
}

export interface StrategyDefinition {
  schemaVersion: 1;
  name: string;
  description?: string;
  /** 1–4 legs. */
  legs: LegDef[];
  evaluation: Evaluation;
  expression: ExprNode;
}

export interface V2Strategy {
  id: string;
  name: string;
  version: number;
  definition: StrategyDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface V2StrategyVersion {
  version: number;
  definition: StrategyDefinition;
  createdAt: string;
}

// ---- Connection (strategy → product) --------------------------------------------------------------

export type ExpirySelector = { mode: 'CURRENT' | 'NEXT' | 'FAR' } | { mode: 'SPECIFIC'; date: string };

export interface AlertPolicy {
  channels: { telegram: boolean; email: boolean };
  /** ON_TRANSITION = first false → true; WHILE_TRUE = every trigger candle it stays true. */
  trigger: 'ON_TRANSITION' | 'WHILE_TRUE';
  cooldownMinutes: number | null;
  oncePerCandle: boolean;
}

export interface ConnectionConfig {
  /** Option expiry when the strategy has CE/PE legs, otherwise the futures expiry. */
  expiry: ExpirySelector;
  /** Where the option legs sit: [0] = around ATM; [-1, 0, 1] = also one strike lower and higher (each is its own unit). */
  strikeShifts: number[];
  alert: AlertPolicy;
}

export interface V2Connection {
  id: string;
  strategyId: string;
  productId: string;
  config: ConnectionConfig;
  enabled: boolean;
  /** Candles closing before this never alert. */
  enabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- Units, evaluation, explain --------------------------------------------------------------------

/** One evaluation unit: a connection's legs resolved to real contracts (for one strike shift). */
export interface V2Unit {
  /** Stable within the connection: `<expiry>|<base strike>`, `FUT|<expiry>` or `SPOT`. */
  key: string;
  productId: string;
  /** Option expiry (option strategies) or futures expiry. */
  expiry: string | null;
  /** Strike the option legs are measured from (ATM + shift). */
  baseStrike: number | null;
  atmStrike?: number;
  shift: number;
  /** Contract per leg (null = not listed for this product / strike). */
  legs: Partial<Record<LegId, V2Instrument | null>>;
}

export type TriState = 'TRUE' | 'FALSE' | 'UNKNOWN';

export interface OperandTrace {
  label: string;
  leg?: LegId;
  value?: number;
  prev?: number;
  candleTime?: number;
  prevCandleTime?: number;
  complete?: boolean;
}

export interface ConditionTrace {
  id: string;
  kind: 'CONDITION' | 'PATTERN';
  text: string;
  result: TriState;
  left?: OperandTrace;
  right?: OperandTrace;
  operator?: Operator;
  pattern?: PatternId;
  reason?: string;
}

export interface ExprTrace {
  id: string;
  type: ExprNode['type'];
  label?: string;
  result: TriState;
  condition?: ConditionTrace;
  children?: ExprTrace[];
}

export interface UnitEvaluation {
  strategyId: string;
  version: number;
  productId: string;
  unit: V2Unit;
  mode: EvaluationMode;
  triggerTimeframe: Timeframe;
  /** Open time (epoch s) of the trigger candle. */
  triggerCandle: number;
  /** Evaluation time T (epoch ms). */
  evaluatedAt: number;
  result: TriState;
  trace: ExprTrace;
  /** Each leg's close on the trigger candle (legs whose data was fetched). */
  prices: Partial<Record<LegId, number>>;
}

// ---- State, signals, alerts ---------------------------------------------------------------------------

export type AlertStateName = 'IDLE' | 'TRIGGERED' | 'COOLDOWN' | 'ACKNOWLEDGED' | 'DISABLED';

export interface UnitState {
  connectionId: string;
  unitKey: string;
  state: AlertStateName;
  lastEvaluatedCandle: number | null;
  lastResult: TriState | null;
  lastSignalCandle: number | null;
  lastAlertAt: string | null;
  cooldownUntil: string | null;
  lastEvaluation: UnitEvaluation | null;
  updatedAt?: string;
}

export type SignalOutcome = 'ALERTED' | 'NO_CHANNEL' | 'SUPPRESSED_COOLDOWN' | 'SUPPRESSED_ACKNOWLEDGED' | 'SUPPRESSED_STALE' | 'SUPPRESSED_BEFORE_ENABLE';

export interface V2Signal {
  id: string;
  identity: string;
  connectionId: string;
  strategyId: string;
  version: number;
  unitKey: string;
  triggerTimeframe: Timeframe;
  candleTime: number;
  outcome: SignalOutcome;
  evaluation: UnitEvaluation;
  createdAt: string;
}

export type AlertStatus = 'SENT' | 'PARTIAL' | 'FAILED' | 'ACKNOWLEDGED';

export interface Delivery {
  channel: 'telegram' | 'email';
  status: 'sent' | 'failed';
  error?: string;
  sentAt: string;
}

export interface V2Alert {
  id: string;
  signalId: string;
  connectionId: string;
  strategyId: string;
  strategyName: string;
  version: number;
  productId: string;
  status: AlertStatus;
  unit: V2Unit;
  triggerTimeframe: Timeframe;
  candleTime: number;
  evaluation: UnitEvaluation;
  deliveries: Delivery[];
  acknowledgedAt: string | null;
  createdAt: string;
}

// ---- Scanner, settings, calendar -----------------------------------------------------------------------

export interface ScanError {
  connectionId?: string;
  productId?: string;
  unitKey?: string;
  timeframe?: string;
  source: string;
  message: string;
}

export interface ScanRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: 'OK' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  connections: number;
  units: number;
  unitsEvaluated: number;
  instruments: number;
  requests: number;
  budget: number;
  conditions: number;
  signals: number;
  alerts: number;
  errors: ScanError[];
  notes: string[];
}

export interface V2Settings {
  /** Overrides TELEGRAM_CHAT_ID for V2 alerts. */
  telegramChatId?: string;
  emailRecipients: string[];
  emailFrom: string;
  /** Max candle requests per scanner cycle. */
  requestBudget: number;
}

export const DEFAULT_V2_SETTINGS: V2Settings = {
  emailRecipients: [],
  emailFrom: 'Algo Hunt <onboarding@resend.dev>',
  requestBudget: 150,
};

export type CalendarEntry =
  | { market: Market; date: string; kind: 'HOLIDAY'; note?: string }
  | { market: Market; date: string; kind: 'SPECIAL_SESSION'; openMin: number; closeMin: number; note?: string };

export interface UnitResolution {
  units: V2Unit[];
  /** Instruments whose live price set ATM. */
  references: Array<{ instrument: V2Instrument; ltp?: number }>;
  errors: string[];
  notes: string[];
}

// ---- Compare (one strategy across many products) ---------------------------------------------------

export interface CompareAlert {
  candleTime: number;
  prices: Partial<Record<LegId, number>>;
  trace: ExprTrace;
}

export interface CompareProductResult {
  productId: string;
  productName: string;
  unit: V2Unit | null;
  /** Trigger candles evaluated / with enough data. */
  candles: number;
  decided: number;
  alerts: CompareAlert[];
  errors: string[];
  notes: string[];
}

export interface CompareResult {
  from: string;
  to: string;
  triggerTimeframe: Timeframe;
  products: CompareProductResult[];
  requests: number;
  notes: string[];
}
