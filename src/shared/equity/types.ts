/**
 * Equity (NSE cash stocks) — its own strategy model, separate from F&O (V2). A strategy reads one stock's own
 * candles: entry conditions, exits (target / stop-loss / trailing stop / exit conditions / time), pyramiding
 * (add a lot each time the rising MA reaches the last buy price; the MA becomes the stop for every lot), the
 * money per buy, and how orders fill. Long only (delivery).
 *
 * Precision rules (the engine follows these exactly — see server/equity/engine/simulate.ts):
 *   - Conditions are checked at each CLOSE of the strategy's timeframe (Daily: every trading day; Weekly: the
 *     last trading day of each completed week). A weekly value read on a daily close is the last COMPLETED
 *     week; a daily value read on a weekly close is that week's last day.
 *   - "Crosses above" = above now AND at or below at the previous check (TradingView ta.crossover).
 *   - Too little history for an indicator → the condition is unknown → it neither enters nor exits.
 */

export type EqTimeframe = '1d' | '1w';
export type PriceField = 'open' | 'high' | 'low' | 'close' | 'volume';
export type EqOperator = 'CROSSES_ABOVE' | 'CROSSES_BELOW' | 'GT' | 'GTE' | 'LT' | 'LTE';
export type EqMaType = 'SMA' | 'EMA' | 'WMA';

export type EqIndicatorId = 'SMA' | 'EMA' | 'WMA' | 'RSI' | 'MACD' | 'BB' | 'ATR' | 'SUPERTREND' | 'ADX' | 'DMI' | 'HIGHEST' | 'LOWEST' | 'ROC';

/** What a value measures — only like can be compared (a number compares with anything). */
export type EqUnit = 'price' | 'oscillator' | 'macd' | 'volume' | 'percent' | 'ratio' | 'direction' | 'range';

/** Shared by price and indicator operands. */
interface SeriesRef {
  /** Candle size this value is read on; omitted = the strategy's timeframe. */
  timeframe?: EqTimeframe;
  /** Read the value this many candles back (0 / omitted = the latest). */
  barsAgo?: number;
}

export type EqOperand =
  | ({ kind: 'PRICE'; field: PriceField } & SeriesRef)
  | ({
      kind: 'INDICATOR';
      indicator: EqIndicatorId;
      params: Record<string, number>;
      /** Input series (SMA of volume, RSI of high…); omitted = the indicator's default (close). */
      source?: PriceField;
      /** Which line of a multi-line indicator (MACD signal, Bollinger upper…). */
      output?: string;
      /** A moving average of the indicator itself — e.g. RSI(14) with an SMA(9): TradingView's "RSI-based MA". */
      ma?: { type: EqMaType; period: number };
      /** Scales the value, e.g. 1.5 × SMA(volume, 20). */
      multiplier?: number;
    } & SeriesRef)
  | { kind: 'NUMBER'; value: number };

export interface EqCondition {
  type: 'CONDITION';
  id: string;
  left: EqOperand;
  op: EqOperator;
  right: EqOperand;
}

export interface EqGroup {
  type: 'AND' | 'OR';
  id: string;
  label?: string;
  children: EqNode[];
}

export type EqNode = EqCondition | EqGroup;

export interface EqStrategyDefinition {
  name: string;
  description?: string;
  /** Conditions, exits and pyramiding are checked at each close of this timeframe. */
  timeframe: EqTimeframe;
  entry: {
    when: EqGroup;
    /** WHEN_TRUE: buy at any check where the conditions are true and no position is open. BECOMES_TRUE: only
     *  when they turn true (false or unknown at the previous check) — for level conditions like RSI > 60. */
    trigger: 'WHEN_TRUE' | 'BECOMES_TRUE';
  };
  exit: {
    /** Sell everything when the price reaches base × (1 + target %). A limit order: checked on every day's high. */
    targetPct: number | null;
    /** Sell everything when the price falls to base × (1 − stop %). */
    stopLossPct: number | null;
    /** Sell everything when the price falls this % below the highest high since the first buy. */
    trailingStopPct: number | null;
    /** What target and stop-loss % are measured from: the average buy price (moves with each add) or the first buy. */
    priceBase: 'AVERAGE' | 'FIRST_BUY';
    /** Exit conditions (e.g. SMA 50 crosses below SMA 100) — the position closes when this group is true. */
    when: EqGroup | null;
    /** Sell after this many candles of the strategy's timeframe (null = no time limit). */
    maxBars: number | null;
  };
  /**
   * Pyramiding: at a check where MA ≥ the last buy price (and the close is at or above the MA), buy one more lot;
   * the stop-loss for ALL lots becomes that MA value. Repeats until a stop or another exit closes the position.
   */
  pyramid: {
    enabled: boolean;
    maType: EqMaType;
    maPeriod: number;
    /** At most this many adds (null = until the stop is hit). */
    maxAdds: number | null;
  };
  /** Money per buy — the first buy and every add. */
  sizing: {
    /** AMOUNT: ₹ per buy (whole shares). QUANTITY: shares per buy. PERCENT: % of the account's value at the time. */
    mode: 'AMOUNT' | 'QUANTITY' | 'PERCENT';
    value: number;
  };
  execution: {
    /** CLOSE: orders fill at the close of the candle that signalled. NEXT_OPEN: at the next trading day's open
     *  (what an end-of-day alert lets you do). */
    fill: 'CLOSE' | 'NEXT_OPEN';
    /** TOUCH: a stop-loss sells when any day's low reaches it (a stop order). CLOSE: only when a check's close is
     *  below it (then fills like any exit signal). */
    stopTrigger: 'TOUCH' | 'CLOSE';
  };
  costs: {
    /** Zerodha delivery charges per order: STT, exchange, SEBI, stamp duty, GST and the DP charge on sells. */
    charges: boolean;
    /** % worse fill on every market order (not on target limit orders). */
    slippagePct: number;
  };
}

export interface EqStrategy {
  id: string;
  name: string;
  definition: EqStrategyDefinition;
  /** Bumped on every save. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EqWatchlist {
  id: string;
  name: string;
  symbols: string[];
  createdAt: string;
  updatedAt: string;
}

/** Ready-made stock lists. Index lists come from NSE's published constituents; F&O = stocks with futures. */
export type EqPreset = 'NIFTY50' | 'NIFTYNEXT50' | 'NIFTY100' | 'MIDCAP150' | 'SMALLCAP250' | 'NIFTY500' | 'FNO' | 'ALL';

export interface EqStock {
  symbol: string;
  name: string;
  /** Kite instrument token (NSE cash). */
  token: number;
  sector: string | null;
  presets: EqPreset[];
}

export interface EqPresetInfo {
  preset: EqPreset;
  label: string;
  count: number;
  /** Why the list is empty or partial (e.g. NSE's file couldn't be read). */
  note?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

// ---- backtest --------------------------------------------------------------------------------------------

export interface EqBacktestRequest {
  /** A saved strategy, or an unsaved `definition` straight from the builder. */
  strategyId?: string;
  definition?: EqStrategyDefinition;
  symbols: string[];
  /** IST dates, inclusive. */
  from: string;
  to: string;
  /** Starting money; null = no limit (every signal is taken; P&L only). */
  capital: number | null;
  /** At most this many stocks held at once (null = no limit). */
  maxPositions: number | null;
}

export type EqExitReason = 'TARGET' | 'STOP_LOSS' | 'TRAILING_STOP' | 'PYRAMID_STOP' | 'EXIT_RULE' | 'TIME' | 'END';

export interface EqFill {
  /** IST date of the fill. */
  date: string;
  side: 'BUY' | 'SELL';
  kind: 'ENTRY' | 'ADD' | 'EXIT';
  quantity: number;
  price: number;
  charges: number;
  /** Why — the conditions with their values at the signal, or the stop / target that was hit. */
  reason: string;
  /** Date of the close that signalled (differs from `date` when filling at the next open). */
  signalDate: string;
  /** The stop-loss for the whole position after this fill (pyramiding / stop %), if any. */
  stopAfter: number | null;
}

export interface EqTrade {
  id: string;
  symbol: string;
  name: string;
  entryDate: string;
  exitDate: string;
  exitReason: EqExitReason;
  /** Shares bought in total (first buy + adds). */
  quantity: number;
  adds: number;
  avgPrice: number;
  exitPrice: number;
  /** Money put in (all buys). */
  invested: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  /** Net P&L ÷ money put in. */
  returnPct: number;
  holdingDays: number;
  fills: EqFill[];
}

export interface EqSkip {
  symbol: string;
  date: string;
  kind: 'ENTRY' | 'ADD';
  reason: string;
}

export interface EqStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** Average net P&L per trade. */
  expectancy: number;
  avgHoldingDays: number;
  bestTrade: number;
  worstTrade: number;
  charges: number;
  adds: number;
  /** Share of trading days with at least one stock held. */
  exposurePct: number;
}

export interface EqCurvePoint {
  date: string;
  /** Account value (capital + P&L, holdings at the close); with no capital limit: P&L so far. */
  equity: number;
  drawdownPct: number;
  /** NIFTY 50 bought with the same money on the first day. */
  benchmark?: number;
}

export interface EqSymbolResult {
  symbol: string;
  name: string;
  trades: number;
  wins: number;
  netPnl: number;
  invested: number;
  bestTrade: number;
  worstTrade: number;
  /** Data limits for this stock (e.g. candles start after the period began). */
  notes: string[];
  errors: string[];
}

export interface EqBacktestResult {
  strategyName: string;
  definition: EqStrategyDefinition;
  from: string;
  to: string;
  symbols: number;
  capital: number | null;
  finalEquity: number | null;
  netPnl: number;
  returnPct: number | null;
  cagrPct: number | null;
  maxDrawdownPct: number | null;
  maxDrawdown: number;
  stats: EqStats;
  benchmark: { name: string; returnPct: number; cagrPct: number | null; maxDrawdownPct: number } | null;
  curve: EqCurvePoint[];
  monthly: Array<{ month: string; returnPct: number }>;
  yearly: Array<{ year: string; returnPct: number }>;
  perSymbol: EqSymbolResult[];
  /** Newest first. */
  trades: EqTrade[];
  /** Positions still open at the end (also closed at the last close in `trades`, reason END). */
  openAtEnd: number;
  skipped: EqSkip[];
  /** Candle sets fetched from Kite (the rest came from memory). */
  requests: number;
  notes: string[];
}

// ---- screener --------------------------------------------------------------------------------------------

export interface EqScreenRequest {
  strategyId?: string;
  definition?: EqStrategyDefinition;
  symbols: string[];
}

export interface EqLeafValue {
  text: string;
  value: boolean | null;
  left: number | null;
  right: number | null;
}

export interface EqScreenRow {
  symbol: string;
  name: string;
  /** IST date of the last completed check (daily close, or the week's last day). */
  asOf: string | null;
  close: number | null;
  changePct: number | null;
  /** Entry conditions at the last check. */
  entry: boolean | null;
  /** True at the last check and not at the one before — a fresh signal. */
  fresh: boolean;
  /** Exit conditions at the last check (for stocks you hold). */
  exit: boolean | null;
  leaves: EqLeafValue[];
  error?: string;
}

export interface EqScreenResult {
  strategyName: string;
  timeframe: EqTimeframe;
  rows: EqScreenRow[];
  requests: number;
  notes: string[];
}

// ---- jobs ------------------------------------------------------------------------------------------------

/** A backtest or screen running in the background (memory only): stocks are fetched one by one through
 *  Kite's request queue, then evaluated. */
export interface EqJob<Req, Res> {
  id: string;
  kind: 'BACKTEST' | 'SCREEN';
  strategyName: string;
  status: 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  startedAt: number;
  finishedAt: number | null;
  /** FETCH: candles stock by stock. RUN: evaluating / simulating. */
  phase: 'FETCH' | 'RUN';
  done: number;
  total: number;
  current: string | null;
  fetched: number;
  cached: number;
  etaSeconds: number | null;
  error: string | null;
  request: Req;
  result?: Res;
}

export type EqBacktestJob = EqJob<EqBacktestRequest, EqBacktestResult>;
export type EqScreenJob = EqJob<EqScreenRequest, EqScreenResult>;
