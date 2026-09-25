/**
 * MCX V2 domain model — shared by the MCX V2 server module (src/server/mcx) and
 * UI (src/client/mcx). Independent from the V1 / NSE types in @ash/shared.
 *
 * Layers (never mixed): MARKET → UNIVERSE → SELECTION → DATA SERIES → CANDLES →
 * INDICATORS → CONDITION → EXPRESSION → STRATEGY → SIGNAL → ALERT POLICY → DELIVERY.
 * Every operand carries its full data context (instrument role, timeframe,
 * candle type) in the stored JSON — there are no hidden defaults.
 */

// ---- Instruments -------------------------------------------------------------

export type McxInstrumentType = 'MCX_FUTURE' | 'MCX_OPTION' | 'MCX_INDEX';
export type OptionType = 'CE' | 'PE';

export interface McxInstrument {
  /** Stable id: `MCX:<token>`. */
  id: string;
  token: number;
  exchange: 'MCX';
  instrumentType: McxInstrumentType;
  /** Product symbol (Kite `name`), e.g. GOLD. */
  underlying: string;
  /** Kite tradingsymbol, e.g. GOLD26OCT75000CE. */
  symbol: string;
  /** yyyy-mm-dd; null for instruments without expiry. */
  expiry: string | null;
  strike: number | null;
  optionType: OptionType | null;
  lotSize: number;
  tickSize: number;
  active: boolean;
}

// ---- Universe (what a strategy scans) -----------------------------------------

export type ExpiryMode = 'CURRENT' | 'NEXT' | 'FAR' | 'ALL' | 'SPECIFIC';
export type ExpirySelector = { mode: 'CURRENT' | 'NEXT' | 'FAR' | 'ALL' } | { mode: 'SPECIFIC'; date: string };
/** Reference-future selector: an expiry selector or MATCH_TARGET (the future the target devolves into). */
export type ReferenceSelector = ExpirySelector | { mode: 'MATCH_TARGET' };

export type StrikeSelector =
  /** Offsets from ATM along the listed strikes: [0] = ATM, [-2,-1,0,1,2] = ATM ± 2. */
  | { mode: 'ATM_OFFSETS'; offsets: number[] }
  /** N strikes in the money (CE: below ATM, PE: above ATM), ATM excluded. */
  | { mode: 'ITM'; count: number }
  /** N strikes out of the money (CE: above ATM, PE: below ATM), ATM excluded. */
  | { mode: 'OTM'; count: number }
  | { mode: 'SPECIFIC'; strikes: number[] }
  | { mode: 'RANGE'; from: number; to: number }
  | { mode: 'ALL' };
export type StrikeMode = StrikeSelector['mode'];

export type TargetSpec =
  | { kind: 'FUTURE'; expiry: ExpirySelector }
  | { kind: 'OPTION'; expiry: ExpirySelector; optionTypes: OptionType[]; strikes: StrikeSelector };

export interface Universe {
  /** Product symbol, e.g. GOLD. */
  underlying: string;
  /** Which future is the UNDERLYING role (ATM is derived from its LTP). Default MATCH_TARGET. */
  reference: { expiry: ReferenceSelector };
  /** The instruments the strategy produces signals for (one evaluation unit each). */
  target: TargetSpec;
}

/** How an operand addresses an instrument — by role, never by a stored dynamic strike. */
export type InstrumentRef =
  | { role: 'UNDERLYING' }
  | { role: 'TARGET' }
  | { role: 'FIXED'; instrumentId: string };

// ---- Data series ------------------------------------------------------------------

export type McxTimeframe = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d' | '1w';

export type CandleSpec =
  | { type: 'NORMAL' }
  | { type: 'HEIKIN_ASHI' }
  /** Volume candles: consecutive candles of the series timeframe merged until volume ≥ volumePerCandle. */
  | { type: 'VOLUME'; volumePerCandle: number };
export type CandleType = CandleSpec['type'];

export interface SeriesSpec {
  instrument: InstrumentRef;
  timeframe: McxTimeframe;
  candle: CandleSpec;
}

// ---- Operands, conditions, expression ----------------------------------------------

export type PriceField = 'open' | 'high' | 'low' | 'close';
export type SourceField = PriceField | 'volume' | 'oi';

export type Operand =
  | { kind: 'CONSTANT'; value: number }
  | { kind: 'FIELD'; series: SeriesSpec; field: SourceField }
  | { kind: 'OI_CHANGE'; series: SeriesSpec; lookback: number }
  | {
      kind: 'INDICATOR';
      series: SeriesSpec;
      /** Catalog id, e.g. RSI, SMA, BB, ADX, DMI. */
      indicator: string;
      params: Record<string, number>;
      /** Input field for single-source indicators (RSI/SMA/EMA/BB). Default close. */
      source?: SourceField;
      /** Output of multi-line indicators (BB upper, DMI plus…). */
      output?: string;
      /** Scale factor, e.g. 2 × SMA(volume, 20). Default 1. */
      multiplier?: number;
    };
export type OperandKind = Operand['kind'];

export type McxOperator = 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ' | 'CROSSED_ABOVE' | 'CROSSED_BELOW';

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
  operator: McxOperator;
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

// ---- Strategy, evaluation, alert policy ----------------------------------------------

export type EvaluationMode = 'COMPLETED_CANDLE' | 'LIVE_CANDLE';

export interface Evaluation {
  /** COMPLETED_CANDLE (default): every series reads its last completed candle. LIVE_CANDLE: forming candles. */
  mode: EvaluationMode;
  /** The clock: units are evaluated when the target's candle of this timeframe completes (or every cycle in live mode). */
  triggerTimeframe: McxTimeframe;
}

export type AlertTrigger = 'ON_TRANSITION' | 'WHILE_TRUE';

export interface AlertPolicy {
  channels: { telegram: boolean; email: boolean };
  /** ON_TRANSITION = first false → true; WHILE_TRUE = repeat while the strategy stays true. */
  trigger: AlertTrigger;
  /** Minutes after an alert during which further alerts for the same unit are suppressed. null = none. */
  cooldownMinutes: number | null;
  /** At most one signal per trigger candle (always true in completed-candle mode). */
  oncePerCandle: boolean;
}

export interface McxStrategyDefinition {
  schemaVersion: 1;
  market: 'MCX';
  name: string;
  description?: string;
  universe: Universe;
  evaluation: Evaluation;
  expression: ExprNode;
  alert: AlertPolicy;
}

export interface McxStrategy {
  id: string;
  name: string;
  enabled: boolean;
  /** When the strategy was last enabled — candles closing before this never alert. */
  enabledAt: string | null;
  version: number;
  definition: McxStrategyDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface McxStrategyVersion {
  version: number;
  definition: McxStrategyDefinition;
  createdAt: string;
}

// ---- Evaluation results / explain ------------------------------------------------------

export type TriState = 'TRUE' | 'FALSE' | 'UNKNOWN';

export interface OperandTrace {
  /** e.g. "GOLD 75000 CE · 15m · Normal · RSI(14)". */
  label: string;
  /** Value on the current candle of the operand's series (undefined = unavailable). */
  value?: number;
  /** Value on the previous candle (used by crosses). */
  prev?: number;
  /** Open time (epoch s) of the candle the value comes from. */
  candleTime?: number;
  prevCandleTime?: number;
  /** Whether that candle was complete when evaluated. */
  complete?: boolean;
}

export interface ConditionTrace {
  id: string;
  kind: 'CONDITION' | 'PATTERN';
  text: string;
  result: TriState;
  left?: OperandTrace;
  right?: OperandTrace;
  operator?: McxOperator;
  pattern?: PatternId;
  /** Why the result is UNKNOWN (insufficient data, missing series…). */
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
  target: McxInstrument;
  reference?: McxInstrument;
  mode: EvaluationMode;
  triggerTimeframe: McxTimeframe;
  /** Open time (epoch s) of the trigger candle evaluated. */
  triggerCandle: number;
  /** Evaluation time T (epoch ms): trigger candle close (completed) or now (live). */
  evaluatedAt: number;
  result: TriState;
  trace: ExprTrace;
  /** Close price of the target's trigger series at T (for alert records). */
  price?: number;
}

// ---- Units, signals, alerts ------------------------------------------------------------

export type AlertStateName = 'IDLE' | 'TRIGGERED' | 'COOLDOWN' | 'ACKNOWLEDGED' | 'DISABLED';

export interface UnitState {
  strategyId: string;
  targetInstrumentId: string;
  state: AlertStateName;
  lastEvaluatedCandle: number | null;
  lastResult: TriState | null;
  lastSignalCandle: number | null;
  lastAlertAt: string | null;
  cooldownUntil: string | null;
  /** Latest evaluation, for "why did it (not) fire". */
  lastEvaluation: UnitEvaluation | null;
  updatedAt?: string;
}

export type SignalOutcome =
  | 'ALERTED'
  | 'SUPPRESSED_COOLDOWN'
  | 'SUPPRESSED_ACKNOWLEDGED'
  | 'SUPPRESSED_STALE'
  | 'SUPPRESSED_BEFORE_ENABLE'
  | 'NO_CHANNEL';

export interface McxSignal {
  id: string;
  identity: string;
  strategyId: string;
  version: number;
  targetInstrumentId: string;
  triggerTimeframe: McxTimeframe;
  candleTime: number;
  signalType: 'ENTRY';
  outcome: SignalOutcome;
  evaluation: UnitEvaluation;
  createdAt: string;
}

export type McxAlertStatus = 'SENT' | 'PARTIAL' | 'FAILED' | 'ACKNOWLEDGED';

export interface McxDelivery {
  channel: 'telegram' | 'email';
  status: 'sent' | 'failed';
  error?: string;
  sentAt: string;
}

export interface McxAlert {
  id: string;
  signalId: string;
  strategyId: string;
  strategyName: string;
  version: number;
  status: McxAlertStatus;
  instrument: McxInstrument;
  triggerTimeframe: McxTimeframe;
  candleTime: number;
  price: number | null;
  evaluation: UnitEvaluation;
  deliveries: McxDelivery[];
  acknowledgedAt: string | null;
  createdAt: string;
}

// ---- Scanner / settings / calendar -------------------------------------------------------

export interface McxScanError {
  strategyId?: string;
  instrumentId?: string;
  conditionId?: string;
  timeframe?: string;
  source: string;
  message: string;
}

export interface McxScanRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: 'OK' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  strategies: number;
  units: number;
  unitsEvaluated: number;
  instruments: number;
  seriesFetched: number;
  requests: number;
  budget: number;
  conditions: number;
  signals: number;
  alerts: number;
  errors: McxScanError[];
  notes: string[];
}

export interface McxSettings {
  /** Overrides TELEGRAM_CHAT_ID for MCX V2 alerts. */
  telegramChatId?: string;
  emailRecipients: string[];
  emailFrom: string;
  /** Max target instruments per strategy. */
  universeCap: number;
  /** Max historical-candle requests per scanner cycle. */
  requestBudget: number;
}

export const DEFAULT_MCX_SETTINGS: McxSettings = {
  emailRecipients: [],
  emailFrom: 'Algo Hunt <onboarding@resend.dev>',
  universeCap: 40,
  requestBudget: 150,
};

export type CalendarEntry =
  | { date: string; kind: 'HOLIDAY'; note?: string }
  /** A trading day with custom hours, minutes after IST midnight. */
  | { date: string; kind: 'SPECIAL_SESSION'; openMin: number; closeMin: number; note?: string };

// ---- Universe resolution (preview + scanner) ------------------------------------------------

export interface ResolvedUnit {
  target: McxInstrument;
  reference: McxInstrument | null;
  /** ATM strike used for this target's expiry (options with ATM-relative selection). */
  atmStrike?: number;
}

export interface UniverseResolution {
  units: ResolvedUnit[];
  /** Reference futures used, with the LTP that set ATM. */
  references: Array<{ instrument: McxInstrument; ltp?: number }>;
  expiries: string[];
  errors: string[];
  notes: string[];
}
