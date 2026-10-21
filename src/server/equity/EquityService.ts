/**
 * Equity application service — what /api/equity exposes: the stock universe and presets, strategies (checked
 * before saving), watchlists, backtests / screens running as background jobs, and the backtest history (every
 * finished backtest is kept: what, when, which strategy, the figures, the full result).
 */
import type {
  EqBacktestJob,
  EqBacktestRecord,
  EqBacktestRequest,
  EqBacktestResult,
  EqBacktestRun,
  EqPreset,
  EqScreenJob,
  EqScreenRequest,
  EqScreenResult,
  EqScreenRow,
  EqStrategy,
  EqStrategyDefinition,
  EqWatchlist,
  ValidationIssue,
} from '@/shared/equity';
import { EQ_TEMPLATES, hasErrors, normalizeDefinition, settleBars, validateDefinition } from '@/shared/equity';
import { addDays, onDates, type Bars } from './engine/bars';
import { runBacktest, usesVolume, type StockCandles } from './engine/backtest';
import { screenStock } from './engine/screen';
import type { CandleCache } from './data/candles';
import type { Universe } from './data/universe';
import { Jobs, type JobRun } from './jobs';
import type { EquityStore, WatchlistInput } from './store/EquityStore';
import { childLogger } from '../utils/logger';

const log = childLogger('equity');

export class EquityError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'EquityError';
  }
}

export interface EquityDeps {
  store: EquityStore;
  universe: Universe;
  candles: CandleCache;
  /** Kite logged in (backtests and screens need its candles). */
  kiteConnected: () => Promise<boolean>;
  now?: () => number;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Calendar days of daily candles to fetch before the period so every indicator has settled. */
export function warmupDays(d: EqStrategyDefinition): number {
  // ~245 trading days a year (+ a margin for holidays); weekly candles need 7 calendar days each.
  return Math.max(60, Math.ceil(settleBars(d) * (d.timeframe === '1w' ? 7 : 1.6)) + 30);
}

/** Kite's daily candles begin on 3 Jan 2000, and it serves up to 1,900 days per request (KiteHistoricalProvider). */
export const HISTORY_START = '2000-01-01';
const KITE_DAYS_PER_REQUEST = 1900;

/**
 * First date of daily candles to fetch for data ending `to` whose checks start at `from`: the warm-up every
 * indicator needs to match TradingView to 1 part in 10⁷ (warmupDays), stretched back to fill the last Kite
 * request — that history costs no extra request — and never before Kite's data begins (2000). The backtest and the
 * screener both use it; their starts can differ, but every recursive value has forgotten its start by then.
 */
export function historyFrom(d: EqStrategyDefinition, from: string, to: string): string {
  const want = addDays(from, -warmupDays(d));
  const span = Math.round((Date.parse(to) - Date.parse(want)) / 86_400_000) + 1;
  const start = addDays(to, -Math.ceil(span / KITE_DAYS_PER_REQUEST) * KITE_DAYS_PER_REQUEST + 1);
  return start < HISTORY_START ? HISTORY_START : start;
}

export class EquityService {
  private readonly now: () => number;
  private readonly backtests: Jobs<EqBacktestRequest, EqBacktestResult>;
  private readonly screens: Jobs<EqScreenRequest, EqScreenResult>;

  constructor(private readonly deps: EquityDeps) {
    this.now = deps.now ?? Date.now;
    this.backtests = new Jobs('BACKTEST', this.now);
    this.screens = new Jobs('SCREEN', this.now);
  }

  // ---- universe --------------------------------------------------------------------------------------

  stocks(q: { search?: string; preset?: EqPreset; symbols?: string[]; limit?: number }) {
    return this.deps.universe.search(q);
  }

  presets() {
    return this.deps.universe.presets();
  }

  // ---- strategies ------------------------------------------------------------------------------------

  templates() {
    return EQ_TEMPLATES;
  }

  validate(d: EqStrategyDefinition): ValidationIssue[] {
    return validateDefinition(normalizeDefinition(d));
  }

  /** Upgraded to the current model (one timeframe, fixed order rules), then checked. */
  private checked(d: EqStrategyDefinition): EqStrategyDefinition {
    const def = normalizeDefinition(d);
    const issues = validateDefinition(def);
    if (hasErrors(issues)) throw new EquityError(400, issues.find((i) => i.severity === 'error')!.message, issues);
    return def;
  }

  /** Saved rows may predate the current model — they're upgraded as they're read (and on their next save). */
  private current(s: EqStrategy): EqStrategy {
    return { ...s, definition: normalizeDefinition(s.definition) };
  }

  async listStrategies(): Promise<EqStrategy[]> {
    return (await this.deps.store.strategies.list()).map((s) => this.current(s));
  }

  async getStrategy(id: string): Promise<EqStrategy> {
    const s = await this.deps.store.strategies.get(id);
    if (!s) throw new EquityError(404, 'Strategy not found');
    return this.current(s);
  }

  async createStrategy(d: EqStrategyDefinition) {
    return this.deps.store.strategies.create(this.checked(d));
  }

  async updateStrategy(id: string, d: EqStrategyDefinition) {
    const s = await this.deps.store.strategies.update(id, this.checked(d));
    if (!s) throw new EquityError(404, 'Strategy not found');
    return s;
  }

  async duplicateStrategy(id: string) {
    const s = await this.getStrategy(id);
    return this.deps.store.strategies.create({ ...s.definition, name: `${s.name} (copy)` });
  }

  async removeStrategy(id: string) {
    if (!(await this.deps.store.strategies.remove(id))) throw new EquityError(404, 'Strategy not found');
  }

  // ---- watchlists ------------------------------------------------------------------------------------

  listWatchlists(): Promise<EqWatchlist[]> {
    return this.deps.store.watchlists.list();
  }

  private async cleanSymbols(input: WatchlistInput): Promise<WatchlistInput> {
    const { found, unknown } = await this.deps.universe.resolve(input.symbols);
    if (unknown.length) throw new EquityError(400, `Not NSE stocks or indices: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? ` (+${unknown.length - 10} more)` : ''}`);
    return { name: input.name.trim(), symbols: found.map((s) => s.symbol) };
  }

  async createWatchlist(input: WatchlistInput) {
    return this.deps.store.watchlists.create(await this.cleanSymbols(input));
  }

  async updateWatchlist(id: string, input: WatchlistInput) {
    const w = await this.deps.store.watchlists.update(id, await this.cleanSymbols(input));
    if (!w) throw new EquityError(404, 'Watchlist not found');
    return w;
  }

  async removeWatchlist(id: string) {
    if (!(await this.deps.store.watchlists.remove(id))) throw new EquityError(404, 'Watchlist not found');
  }

  // ---- backtests & screens ---------------------------------------------------------------------------

  private async definitionOf(r: { strategyId?: string; definition?: EqStrategyDefinition }): Promise<EqStrategyDefinition> {
    const d = r.definition ?? (r.strategyId ? (await this.getStrategy(r.strategyId)).definition : undefined);
    if (!d) throw new EquityError(400, 'Choose a strategy');
    return this.checked(d);
  }

  private async requireKite(what: string) {
    if (!(await this.deps.kiteConnected())) throw new EquityError(409, `Kite isn’t logged in, so there are no candles to ${what}. Log in to Kite (Connect Kite in the top bar), then run it again.`);
  }

  /**
   * NSE's trading days from `from` to `to`: NIFTY 50's candles (null when Kite can't give them). An index's candles
   * on other days — a base value on a holiday, a bond index computed on weekends — are dropped (sessions on a
   * Saturday, like a Budget day, are NIFTY 50 days too).
   */
  private async marketDays(from: string, to: string, run: JobRun): Promise<Bars | null> {
    const token = await this.deps.universe.benchmarkToken().catch(() => null);
    return token ? this.deps.candles.daily(token, from, to, run.stats).catch(() => null) : null;
  }

  /** Each stock's / index's daily candles, one by one through Kite's queue (progress + cancel); an index's only on `days`. */
  private async fetchAll(stocks: Array<{ symbol: string; name: string; token: number; index?: true }>, from: string, to: string, run: JobRun, days: Bars | null, each?: (c: StockCandles) => void): Promise<StockCandles[]> {
    const out: StockCandles[] = [];
    const open = days ? new Set(days.date) : null;
    for (const [i, s] of stocks.entries()) {
      run.checkpoint();
      run.progress({ phase: 'FETCH', done: i, total: stocks.length, current: s.symbol });
      let c: StockCandles;
      try {
        const daily = await this.deps.candles.daily(s.token, from, to, run.stats);
        c = { symbol: s.symbol, name: s.name, daily: s.index && open ? onDates(daily, open) : daily, ...(s.index ? { index: true } : {}) };
      } catch (err) {
        c = { symbol: s.symbol, name: s.name, daily: null, error: `Candles: ${msg(err)}`, ...(s.index ? { index: true } : {}) };
      }
      if (each) each(c);
      else out.push(c);
    }
    run.progress({ phase: 'RUN', done: stocks.length, current: null });
    return out;
  }

  async startBacktest(req: EqBacktestRequest): Promise<EqBacktestJob> {
    const def = await this.definitionOf(req);
    // For the history: the saved strategy and its version (a builder draft has neither).
    const saved = !req.definition && req.strategyId ? await this.getStrategy(req.strategyId) : null;
    const startedAt = this.now();
    if (req.from > req.to) throw new EquityError(400, '“From” must be on or before “to”');
    if (def.sizing.mode === 'PERCENT' && req.capital === null) throw new EquityError(400, '“% of the account” sizing needs a starting capital — set one or size by ₹ / shares');
    await this.requireKite('backtest on');
    const { found, unknown } = await this.deps.universe.resolve(req.symbols);
    if (!found.length) throw new EquityError(400, `None of these are NSE stocks or indices: ${unknown.slice(0, 10).join(', ')}`);
    // One data end for the whole job, fixed before fetching: a run crossing the 15:40 cut-off must not give some
    // stocks today's candle and others not.
    const end = this.deps.candles.endDate(req.to);
    const fetchFrom = historyFrom(def, req.from, end);
    return this.backtests.start({ strategyName: def.name, request: req, total: found.length }, async (run) => {
      // NIFTY 50 from the warm-up's start: the benchmark, the market's calendar, and the days an index's candles are kept.
      const bench = await this.marketDays(fetchFrom, end, run);
      const candles = await this.fetchAll(found, fetchFrom, end, run, bench);
      run.checkpoint();
      const result = runBacktest(def, req, candles, bench, end);
      if (addDays(req.from, -warmupDays(def)) < HISTORY_START) result.notes.unshift('Some indicators here need history from before 2000, where Kite has none — early in the period their values can differ slightly from TradingView’s, which has older data.');
      if (unknown.length) result.notes.unshift(`Not NSE stocks or indices (skipped): ${unknown.join(', ')}`);
      const full: EqBacktestResult = { ...result, requests: run.stats.fetched };
      await this.keepInHistory(full, { def, req, strategyId: saved?.id ?? null, strategyVersion: saved?.version ?? null, startedAt });
      return full;
    });
  }

  /** Every finished backtest goes into the history. Failing to save it never fails the backtest — it's noted. */
  private async keepInHistory(result: EqBacktestResult, o: { def: EqStrategyDefinition; req: EqBacktestRequest; strategyId: string | null; strategyVersion: number | null; startedAt: number }): Promise<void> {
    const now = this.now();
    try {
      await this.deps.store.backtests.add({
        run: {
          ranAt: new Date(now).toISOString(),
          seconds: Math.max(0, Math.round((now - o.startedAt) / 1000)),
          strategyId: o.strategyId,
          strategyName: o.def.name,
          strategyVersion: o.strategyVersion,
          timeframe: o.def.timeframe,
          stocksLabel: o.req.stocksLabel?.trim() || `${result.symbols} stock${result.symbols === 1 ? '' : 's'}`,
          symbols: result.symbols,
          from: o.req.from,
          to: o.req.to,
          capital: o.req.capital,
          maxPositions: o.req.maxPositions,
          finalEquity: result.finalEquity,
          netPnl: result.netPnl,
          returnPct: result.returnPct,
          cagrPct: result.cagrPct,
          maxDrawdownPct: result.maxDrawdownPct,
          trades: result.stats.trades,
          winRate: result.stats.winRate,
          profitFactor: result.stats.profitFactor,
          benchmarkReturnPct: result.benchmark?.returnPct ?? null,
        },
        request: { ...o.req, definition: o.def },
        result,
      });
    } catch (err) {
      log.warn({ err: msg(err) }, 'could not keep the backtest in the history');
      result.notes.unshift(`Not kept in the backtest history — the database couldn’t save it (${msg(err)}).`);
    }
  }

  // ---- backtest history ------------------------------------------------------------------------------

  /** Every finished backtest, newest first (the lines — open one for its result). */
  backtestHistory(): Promise<EqBacktestRun[]> {
    return this.deps.store.backtests.list();
  }

  async backtestRecord(id: string): Promise<EqBacktestRecord> {
    const r = await this.deps.store.backtests.get(id);
    if (!r) throw new EquityError(404, 'This backtest is no longer in the history');
    return r;
  }

  async removeBacktestRecord(id: string): Promise<void> {
    if (!(await this.deps.store.backtests.remove(id))) throw new EquityError(404, 'This backtest is no longer in the history');
  }

  backtestJob(id: string): EqBacktestJob {
    const j = this.backtests.get(id);
    if (!j) throw new EquityError(404, 'This backtest is no longer in memory (the app restarted, or it finished over an hour ago) — run it again');
    return j;
  }

  latestBacktest(): EqBacktestJob | null {
    return this.backtests.latest();
  }

  cancelBacktest(id: string): EqBacktestJob {
    const j = this.backtests.cancel(id);
    if (!j) throw new EquityError(404, 'This backtest is no longer in memory');
    return j;
  }

  async startScreen(req: EqScreenRequest): Promise<EqScreenJob> {
    const def = await this.definitionOf(req);
    await this.requireKite('screen');
    const { found, unknown } = await this.deps.universe.resolve(req.symbols);
    if (!found.length) throw new EquityError(400, `None of these are NSE stocks or indices: ${unknown.slice(0, 10).join(', ')}`);
    const today = this.deps.candles.endDate('9999-12-31');
    const from = historyFrom(def, today, today);
    return this.screens.start({ strategyName: def.name, request: req, total: found.length }, async (run) => {
      const rows: EqScreenRow[] = [];
      const indices = found.some((s) => s.index);
      await this.fetchAll(found, from, today, run, indices ? await this.marketDays(from, today, run) : null, (c) => rows.push(screenStock(def, c, today)));
      const rank = (r: EqScreenRow) => (r.fresh ? 0 : r.entry ? 1 : r.error ? 3 : 2);
      rows.sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));
      const notes = [`Each stock at its last completed ${def.timeframe === '1w' ? 'week' : 'daily close'} (data up to ${today}).`];
      if (indices && usesVolume(def)) notes.push('Kite has no volume for indices (always 0) — this strategy’s volume conditions don’t work on them.');
      if (unknown.length) notes.push(`Not NSE stocks or indices (skipped): ${unknown.join(', ')}`);
      return { strategyName: def.name, timeframe: def.timeframe, rows, requests: run.stats.fetched, notes };
    });
  }

  screenJob(id: string): EqScreenJob {
    const j = this.screens.get(id);
    if (!j) throw new EquityError(404, 'This screen is no longer in memory — run it again');
    return j;
  }

  latestScreen(): EqScreenJob | null {
    return this.screens.latest();
  }

  cancelScreen(id: string): EqScreenJob {
    const j = this.screens.cancel(id);
    if (!j) throw new EquityError(404, 'This screen is no longer in memory');
    return j;
  }
}
