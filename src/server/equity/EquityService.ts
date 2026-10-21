/**
 * Equity application service — what /api/equity exposes: the stock universe and presets, strategies (checked
 * before saving), watchlists, and backtests / screens running as background jobs.
 */
import type {
  EqBacktestJob,
  EqBacktestRequest,
  EqBacktestResult,
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
import { EQ_TEMPLATES, hasErrors, normalizeDefinition, requiredBars, validateDefinition } from '@/shared/equity';
import { addDays, type Bars } from './engine/bars';
import { runBacktest, type StockCandles } from './engine/backtest';
import { screenStock } from './engine/screen';
import type { CandleCache } from './data/candles';
import type { Universe } from './data/universe';
import { Jobs, type JobRun } from './jobs';
import type { EquityStore, WatchlistInput } from './store/EquityStore';

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
  // ~250 trading days a year; weekly candles need 7 calendar days each.
  return Math.max(60, Math.ceil(requiredBars(d) * (d.timeframe === '1w' ? 7 : 1.5)) + 30);
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
    if (unknown.length) throw new EquityError(400, `Not NSE stocks: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? ` (+${unknown.length - 10} more)` : ''}`);
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

  /** Each stock's daily candles, one by one through Kite's queue (progress + cancel). */
  private async fetchAll(stocks: Array<{ symbol: string; name: string; token: number }>, from: string, to: string, run: JobRun, each?: (c: StockCandles) => void): Promise<StockCandles[]> {
    const out: StockCandles[] = [];
    for (const [i, s] of stocks.entries()) {
      run.checkpoint();
      run.progress({ phase: 'FETCH', done: i, total: stocks.length, current: s.symbol });
      let c: StockCandles;
      try {
        c = { symbol: s.symbol, name: s.name, daily: await this.deps.candles.daily(s.token, from, to, run.stats) };
      } catch (err) {
        c = { symbol: s.symbol, name: s.name, daily: null, error: `Candles: ${msg(err)}` };
      }
      if (each) each(c);
      else out.push(c);
    }
    run.progress({ phase: 'RUN', done: stocks.length, current: null });
    return out;
  }

  async startBacktest(req: EqBacktestRequest): Promise<EqBacktestJob> {
    const def = await this.definitionOf(req);
    if (req.from > req.to) throw new EquityError(400, '“From” must be on or before “to”');
    if (def.sizing.mode === 'PERCENT' && req.capital === null) throw new EquityError(400, '“% of the account” sizing needs a starting capital — set one or size by ₹ / shares');
    await this.requireKite('backtest on');
    const { found, unknown } = await this.deps.universe.resolve(req.symbols);
    if (!found.length) throw new EquityError(400, `None of these are NSE stocks: ${unknown.slice(0, 10).join(', ')}`);
    const fetchFrom = addDays(req.from, -warmupDays(def));
    return this.backtests.start({ strategyName: def.name, request: req, total: found.length }, async (run) => {
      const benchToken = await this.deps.universe.benchmarkToken().catch(() => null);
      let bench: Bars | null = null;
      if (benchToken) bench = await this.deps.candles.daily(benchToken, req.from, req.to, run.stats).catch(() => null);
      const candles = await this.fetchAll(found, fetchFrom, req.to, run);
      run.checkpoint();
      const result = runBacktest(def, req, candles, bench, this.deps.candles.endDate(req.to));
      if (unknown.length) result.notes.unshift(`Not NSE stocks (skipped): ${unknown.join(', ')}`);
      return { ...result, requests: run.stats.fetched };
    });
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
    if (!found.length) throw new EquityError(400, `None of these are NSE stocks: ${unknown.slice(0, 10).join(', ')}`);
    const today = this.deps.candles.endDate('9999-12-31');
    const from = addDays(today, -warmupDays(def) - 14);
    return this.screens.start({ strategyName: def.name, request: req, total: found.length }, async (run) => {
      const rows: EqScreenRow[] = [];
      await this.fetchAll(found, from, today, run, (c) => rows.push(screenStock(def, c, today)));
      const rank = (r: EqScreenRow) => (r.fresh ? 0 : r.entry ? 1 : r.error ? 3 : 2);
      rows.sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));
      const notes = [`Each stock at its last completed ${def.timeframe === '1w' ? 'week' : 'daily close'} (data up to ${today}).`];
      if (unknown.length) notes.push(`Not NSE stocks (skipped): ${unknown.join(', ')}`);
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
