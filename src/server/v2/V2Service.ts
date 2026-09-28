/**
 * V2 application service — the operations the /api/v2 API exposes. Strategies
 * and products are independent; connections join them and produce alerts.
 */
import type {
  CalendarEntry,
  ConnectionConfig,
  AlertQuery,
  BacktestRequest,
  BacktestResult,
  PaperOverride,
  PaperPlan,
  PaperQuery,
  PaperSummary,
  SignalQuery,
  PaperTrade,
  StrategyDefinition,
  V2Alert,
  V2Connection,
  V2Product,
  V2Settings,
  V2Strategy,
  ValidationIssue,
} from '@/shared/v2';
import { DEFAULT_TELEGRAM_BOT, defaultPaperPlan, hasErrors, resolveRules, incompatibility, strategySummary, validateConnection, validateStrategy } from '@/shared/v2';
import { istDate } from '../utils/marketTime';
import { envChannelFactory, recentTelegramChats, telegramBotInfo, type ChannelFactory, type ChannelName } from './alerts/notifications';
import { getConfig } from '../config/index';
import { calendars, dateStartMs } from './calendar/MarketCalendar';
import type { Quote, V2DataProvider } from './data/DataProvider';
import type { ProductService } from './data/ProductService';
import { V2Tools, type CompareRequest } from './debug/tools';
import type { ProductFilters, V2Store } from './persistence/V2Store';
import { liveHealth } from './live/health';
import { PaperTrader, unrealizedPnl } from './paper/PaperTrader';
import { paperSummary } from './paper/summary';
import { runBacktest } from './paper/backtest';
import { V2Scanner, type ScanOptions } from './scanner/V2Scanner';
import { atmReference, resolveUnits, unitInstruments } from './universe/resolve';

export class V2ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'V2ServiceError';
  }
}

export interface V2ServiceDeps {
  store: V2Store;
  provider: V2DataProvider;
  products: ProductService;
  channels?: ChannelFactory;
  clock?: () => number;
}

export const DEFAULT_CONFIG: ConnectionConfig = {
  expiry: { mode: 'CURRENT' },
  strikeShifts: [0],
  alert: { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION', cooldownMinutes: 30, oncePerCandle: true },
};

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** IST calendar days (inclusive) → instants: `since` = start of `from`, `until` = start of the day after `to`. */
function istRange(from?: string, to?: string): { since?: string; until?: string } {
  return {
    since: from ? new Date(dateStartMs(from)).toISOString() : undefined,
    until: to ? new Date(dateStartMs(to) + 86_400_000).toISOString() : undefined,
  };
}

/** Paper-trading tables not created yet: say how to fix it instead of a raw database error. */
async function paperTables<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') throw new V2ServiceError(503, 'Paper trading isn’t set up in the database yet — restart `npm run dev` (or run `npm run db:migrate`) to apply the new migrations.');
    throw err;
  }
}

export class V2Service {
  readonly scanner: V2Scanner;
  readonly tools: V2Tools;
  private readonly channels: ChannelFactory;
  private readonly paper: PaperTrader;
  /** Closed paper trades already read, reused while none closes (they never change once closed). */
  private closedCache: { version: string; trades: PaperTrade[] } | null = null;

  constructor(private readonly deps: V2ServiceDeps) {
    this.channels = deps.channels ?? envChannelFactory;
    this.scanner = new V2Scanner({ ...deps, channels: this.channels });
    this.tools = new V2Tools(deps);
    this.paper = new PaperTrader({ store: deps.store, now: () => this.now(), prices: (list) => deps.provider.getLtp(list) });
  }

  private now(): number {
    return this.deps.clock ? this.deps.clock() : Date.now();
  }

  // ---- status / products ---------------------------------------------------------------

  /** The live worker's heartbeat row and how healthy it is right now. */
  async liveStatus() {
    const row = await this.deps.store.live.get();
    return { health: liveHealth(row, this.now()), status: row?.status ?? null, offlineNotifiedAt: row?.offlineNotifiedAt ?? null };
  }

  async status() {
    const now = this.now();
    const { store } = this.deps;
    const [entries, instruments, products, syncedAt, strategies, connections, runs, settings, kite] = await Promise.all([
      store.calendar.list(),
      store.instruments.count(),
      store.products.count(),
      store.instruments.syncedAt(),
      store.strategies.count(),
      store.connections.counts(),
      store.scanRuns.list(1),
      store.settings.get(),
      this.deps.provider.isConnected().catch(() => false),
    ]);
    const cals = calendars(entries);
    const today = istDate(now);
    const market = (m: 'NSE' | 'MCX') => ({ open: cals[m].isMarketOpen(now), today: cals[m].session(today) });
    return {
      now,
      markets: { NSE: market('NSE'), MCX: market('MCX') },
      kiteConnected: kite,
      instruments: { count: instruments, products, syncedAt },
      strategies,
      connections,
      lastRun: runs[0] ?? null,
      channels: this.channels.status(settings),
    };
  }

  products(f: ProductFilters) {
    return this.deps.store.products.list(f);
  }

  /** Products per type (and in total) matching the search — for the filter buttons. */
  async productCounts(f: Pick<ProductFilters, 'search' | 'market' | 'needs'>) {
    const byKind = await this.deps.store.products.countByKind(f);
    return { ...byKind, total: byKind.INDEX + byKind.STOCK + byKind.COMMODITY };
  }

  async product(id: string): Promise<V2Product> {
    const p = await this.deps.store.products.get(id);
    if (!p) throw new V2ServiceError(404, `Product ${id} not found — sync products`);
    return p;
  }

  syncProducts() {
    return this.deps.products.sync();
  }

  // ---- strategies ------------------------------------------------------------------------

  validateStrategy(d: StrategyDefinition) {
    const issues = validateStrategy(d);
    return { issues, valid: !hasErrors(issues), summary: strategySummary(d) };
  }

  async listStrategies() {
    const [strategies, connections] = await Promise.all([this.deps.store.strategies.list(), this.deps.store.connections.list()]);
    return strategies.map((s) => ({
      ...s,
      connections: connections.filter((c) => c.strategyId === s.id).length,
      enabledConnections: connections.filter((c) => c.strategyId === s.id && c.enabled).length,
    }));
  }

  async getStrategy(id: string): Promise<V2Strategy> {
    const s = await this.deps.store.strategies.get(id);
    if (!s) throw new V2ServiceError(404, 'Strategy not found');
    return s;
  }

  async createStrategy(d: StrategyDefinition): Promise<V2Strategy> {
    const issues = validateStrategy(d);
    if (hasErrors(issues)) throw new V2ServiceError(400, 'The strategy has errors', issues);
    return this.deps.store.strategies.create(d);
  }

  /** New version. Connections keep running on it; their unit state resets (the logic changed). */
  async updateStrategy(id: string, d: StrategyDefinition): Promise<V2Strategy> {
    await this.getStrategy(id);
    const issues = validateStrategy(d);
    if (hasErrors(issues)) throw new V2ServiceError(400, 'The strategy has errors', issues);
    const connections = await this.deps.store.connections.list(id);
    const products = new Map((await this.deps.store.products.list({ ids: connections.map((c) => c.productId) })).map((p) => [p.id, p]));
    const broken = connections.filter((c) => c.enabled && products.get(c.productId) && incompatibility(d, products.get(c.productId)!).length);
    if (broken.length) {
      throw new V2ServiceError(400, `This change doesn't fit ${broken.map((c) => c.productId).join(', ')} (enabled connections) — disable those first`);
    }
    const s = await this.deps.store.strategies.update(id, d);
    for (const c of connections) await this.deps.store.units.clear(c.id);
    return s!;
  }

  async duplicateStrategy(id: string): Promise<V2Strategy> {
    const s = await this.getStrategy(id);
    return this.deps.store.strategies.create({ ...s.definition, name: `${s.definition.name} (copy)` });
  }

  async removeStrategy(id: string): Promise<void> {
    if (!(await this.deps.store.strategies.remove(id))) throw new V2ServiceError(404, 'Strategy not found');
  }

  versions(id: string) {
    return this.deps.store.strategies.versions(id);
  }

  // ---- connections -------------------------------------------------------------------------

  async listConnections(strategyId?: string) {
    const [connections, strategies] = await Promise.all([this.deps.store.connections.list(strategyId), this.deps.store.strategies.list()]);
    const products = new Map((await this.deps.store.products.list({ ids: [...new Set(connections.map((c) => c.productId))] })).map((p) => [p.id, p]));
    const names = new Map(strategies.map((s) => [s.id, s.name]));
    return connections.map((c) => ({ ...c, strategyName: names.get(c.strategyId) ?? '—', product: products.get(c.productId) ?? null }));
  }

  async getConnection(id: string): Promise<V2Connection> {
    const c = await this.deps.store.connections.get(id);
    if (!c) throw new V2ServiceError(404, 'Connection not found');
    return c;
  }

  private async checkConnection(strategyId: string, productId: string, config: ConnectionConfig, forEnable: boolean) {
    const [s, p, settings] = await Promise.all([this.getStrategy(strategyId), this.deps.store.products.get(productId), this.deps.store.settings.get()]);
    const status = this.channels.status(settings);
    const issues = validateConnection(s.definition, p, config, {
      channelsConfigured: { telegram: status.telegram.configured, email: status.email.configured },
      forEnable,
    });
    return { strategy: s, product: p, issues };
  }

  async validateConnection(strategyId: string, productId: string, config: ConnectionConfig) {
    const { issues } = await this.checkConnection(strategyId, productId, config, false);
    return { issues, valid: !hasErrors(issues) };
  }

  /** Connect one strategy to several products at once (one connection each). */
  async createConnections(strategyId: string, productIds: string[], config: ConnectionConfig): Promise<V2Connection[]> {
    const existing = await this.deps.store.connections.list(strategyId);
    const out: V2Connection[] = [];
    const problems: ValidationIssue[] = [];
    for (const productId of [...new Set(productIds)]) {
      if (existing.some((c) => c.productId === productId)) {
        problems.push({ path: productId, message: `${productId} is already connected to this strategy`, severity: 'error' });
        continue;
      }
      const { issues } = await this.checkConnection(strategyId, productId, config, false);
      const errs = issues.filter((i) => i.severity === 'error');
      if (errs.length) problems.push(...errs.map((i) => ({ ...i, message: `${productId}: ${i.message}` })));
    }
    if (problems.length) throw new V2ServiceError(400, 'Some products can’t be connected', problems);
    for (const productId of [...new Set(productIds)]) out.push(await this.deps.store.connections.create(strategyId, productId, config));
    return out;
  }

  async updateConnection(id: string, config: ConnectionConfig): Promise<V2Connection> {
    const c = await this.getConnection(id);
    const { issues } = await this.checkConnection(c.strategyId, c.productId, config, c.enabled);
    if (hasErrors(issues)) throw new V2ServiceError(400, 'The connection has errors', issues);
    const out = await this.deps.store.connections.update(id, config);
    await this.deps.store.units.clear(id);
    return out!;
  }

  async enableConnection(id: string): Promise<V2Connection> {
    const c = await this.getConnection(id);
    const { issues } = await this.checkConnection(c.strategyId, c.productId, c.config, true);
    if (hasErrors(issues)) throw new V2ServiceError(400, 'Fix these before switching on', issues);
    await this.deps.store.units.clear(id);
    return (await this.deps.store.connections.setEnabled(id, true, new Date(this.now()).toISOString()))!;
  }

  async disableConnection(id: string): Promise<V2Connection> {
    await this.getConnection(id);
    const out = await this.deps.store.connections.setEnabled(id, false, new Date(this.now()).toISOString());
    for (const u of await this.deps.store.units.list(id)) await this.deps.store.units.upsert({ ...u, state: 'DISABLED' });
    return out!;
  }

  /**
   * Switch every connection of a strategy on or off in one go. Switching on checks each one exactly like a
   * single switch-on (legs available, expiry listed, alert channels configured); those that fail are
   * reported and stay off, the rest change.
   */
  async setStrategyConnections(strategyId: string, enabled: boolean): Promise<{ changed: number; unchanged: number; failed: Array<{ connectionId: string; productId: string; message: string }> }> {
    const s = await this.getStrategy(strategyId);
    const { store } = this.deps;
    const all = await store.connections.list(strategyId);
    const todo = all.filter((c) => c.enabled !== enabled);
    const failed: Array<{ connectionId: string; productId: string; message: string }> = [];
    let ok = todo;
    if (enabled && todo.length) {
      const [products, settings] = await Promise.all([store.products.list({ ids: [...new Set(todo.map((c) => c.productId))] }), store.settings.get()]);
      const byId = new Map(products.map((p) => [p.id, p]));
      const status = this.channels.status(settings);
      ok = [];
      for (const c of todo) {
        const errors = validateConnection(s.definition, byId.get(c.productId) ?? null, c.config, {
          channelsConfigured: { telegram: status.telegram.configured, email: status.email.configured },
          forEnable: true,
        }).filter((i) => i.severity === 'error');
        if (errors.length) failed.push({ connectionId: c.id, productId: c.productId, message: errors.map((e) => e.message).join('; ') });
        else ok.push(c);
      }
    }
    const ids = ok.map((c) => c.id);
    if (ids.length) {
      const at = new Date(this.now()).toISOString();
      if (enabled) await store.units.clearMany(ids); // same as a single switch-on: start fresh
      await store.connections.setEnabledMany(ids, enabled, at);
      if (!enabled) await store.units.disableMany(ids);
    }
    return { changed: ids.length, unchanged: all.length - todo.length, failed };
  }

  async removeConnection(id: string): Promise<void> {
    if (!(await this.deps.store.connections.remove(id))) throw new V2ServiceError(404, 'Connection not found');
  }

  units(connectionId: string) {
    return this.deps.store.units.list(connectionId);
  }

  /** The contracts a strategy + product + settings resolve to right now, with live quotes. */
  async previewConnection(input: { strategyId?: string; definition?: StrategyDefinition; productId: string; config: ConnectionConfig }) {
    const definition = input.definition ?? (input.strategyId ? (await this.getStrategy(input.strategyId)).definition : undefined);
    if (!definition) throw new V2ServiceError(400, 'strategyId or definition is required');
    const product = await this.product(input.productId);
    const now = this.now();
    const today = istDate(now);
    const all = await this.deps.products.instruments(product.id, now);
    const errors = incompatibility(definition, product);
    const ref = atmReference(definition, all, input.config, today);
    let price: number | undefined;
    if (ref) {
      try {
        price = (await this.deps.provider.getLtp([ref])).get(ref.token);
      } catch (err) {
        errors.push(`Live price unavailable: ${msg(err)}`);
      }
    }
    const res = resolveUnits(definition, product.id, all, input.config, price, today);
    const quotes: Record<string, Quote> = {};
    const insts = res.units.flatMap(unitInstruments);
    if (insts.length) {
      try {
        const q = await this.deps.provider.getQuotes(insts);
        for (const i of insts) {
          const v = q.get(i.token);
          if (v) quotes[i.id] = v;
        }
      } catch (err) {
        res.notes.push(`Quotes unavailable: ${msg(err)}`);
      }
    }
    return { ...res, errors: [...errors, ...res.errors], quotes, product };
  }

  // ---- explain / compare ------------------------------------------------------------------

  async explainConnection(id: string) {
    const c = await this.getConnection(id);
    const [s, p] = await Promise.all([this.getStrategy(c.strategyId), this.product(c.productId)]);
    return this.tools.explain({ definition: s.definition, strategyId: s.id, version: s.version, product: p, config: c.config, connectionId: c.id, enabledAt: c.enabledAt });
  }

  async explainDraft(input: { definition: StrategyDefinition; productId: string; config?: ConnectionConfig }) {
    const p = await this.product(input.productId);
    const issues = incompatibility(input.definition, p);
    if (issues.length) throw new V2ServiceError(400, issues.join('; '));
    return this.tools.explain({ definition: input.definition, product: p, config: input.config ?? DEFAULT_CONFIG });
  }

  async compare(input: { strategyId?: string; definition?: StrategyDefinition } & CompareRequest) {
    const definition = input.definition ?? (input.strategyId ? (await this.getStrategy(input.strategyId)).definition : undefined);
    if (!definition) throw new V2ServiceError(400, 'strategyId or definition is required');
    try {
      return await this.tools.compare(definition, input);
    } catch (err) {
      if (/limited to|must be on or before|at least one|at most/.test(msg(err))) throw new V2ServiceError(400, msg(err));
      throw err;
    }
  }

  // ---- alerts / signals / scanner ----------------------------------------------------------

  alerts(q: AlertQuery = {}) {
    const { from, to, ...rest } = q;
    return this.deps.store.alerts.list({ ...rest, ...istRange(from, to), limit: Math.min(q.limit ?? 200, 1000) });
  }

  /** One alert in full (with its condition trace). */
  async alert(id: string): Promise<V2Alert> {
    const a = await this.deps.store.alerts.get(id);
    if (!a) throw new V2ServiceError(404, 'Alert not found');
    return a;
  }

  /** New alerts since `after` (ISO) — small rows, polled by the app's alarm. */
  alertFeed(after: string | null, limit = 25) {
    return this.deps.store.alerts.feed(after, Math.min(limit, 100));
  }

  async acknowledge(id: string): Promise<V2Alert> {
    const a = await this.deps.store.alerts.get(id);
    if (!a) throw new V2ServiceError(404, 'Alert not found');
    const out = await this.deps.store.alerts.acknowledge(id, new Date(this.now()).toISOString());
    const unit = await this.deps.store.units.get(a.connectionId, a.unit.key);
    if (unit && unit.state !== 'DISABLED') await this.deps.store.units.upsert({ ...unit, state: 'ACKNOWLEDGED' });
    return out!;
  }

  signals(q: SignalQuery = {}) {
    const { from, to, ...rest } = q;
    return this.deps.store.signals.list({ ...rest, ...istRange(from, to), limit: Math.min(q.limit ?? 200, 1000) });
  }

  scan(opts: ScanOptions = {}) {
    return this.scanner.runLocked(opts);
  }

  scanRuns(limit = 100) {
    return this.deps.store.scanRuns.list(Math.min(limit, 500));
  }

  // ---- backtest ----------------------------------------------------------------------------

  /** What the strategy would have made on these products with this money over past candles (nothing saved). */
  async backtest(req: BacktestRequest): Promise<BacktestResult> {
    const s = await this.getStrategy(req.strategyId);
    if (req.from > req.to) throw new V2ServiceError(400, '“From” must be on or before “to”');
    try {
      return await runBacktest({ store: this.deps.store, provider: this.deps.provider, tools: this.tools, now: () => this.now() }, s, req);
    } catch (err) {
      throw new V2ServiceError(400, msg(err));
    }
  }

  // ---- paper trading -----------------------------------------------------------------------

  /** The strategy's paper plan (the preferred defaults, switched on, when it has none yet), rules matched to its current groups. */
  async paperPlan(strategyId: string): Promise<PaperPlan> {
    return paperTables(async () => {
      const s = await this.getStrategy(strategyId);
      const plan = await this.deps.store.paper.getPlan(strategyId);
      return plan ? { ...plan, rules: resolveRules(s.definition, plan.rules) } : defaultPaperPlan(s.definition);
    });
  }

  async savePaperPlan(strategyId: string, plan: PaperPlan): Promise<PaperPlan> {
    return paperTables(async () => {
      const s = await this.getStrategy(strategyId);
      return this.deps.store.paper.savePlan(strategyId, { ...plan, rules: resolveRules(s.definition, plan.rules) });
    });
  }

  /** Results for trades entered since `from` (IST date; all when absent), optionally one strategy's. */
  /** Every closed paper trade — read again only when one closed or trades were deleted. */
  private async closedTrades(): Promise<PaperTrade[]> {
    const version = await this.deps.store.paper.closedVersion();
    if (this.closedCache?.version !== version) this.closedCache = { version, trades: await this.deps.store.paper.listTrades({ status: 'CLOSED', limit: 50_000 }) };
    return this.closedCache.trades;
  }

  /** Paper trades by strategy / connection / entered since: closed ones from what was read before, open ones fresh. */
  private async paperTradesFor(q: PaperQuery): Promise<PaperTrade[]> {
    const since = istRange(q.from).since;
    const keep = (t: PaperTrade) => (!q.strategyId || t.strategyId === q.strategyId) && (!q.connectionId || t.connectionId === q.connectionId) && (!since || t.entryAt >= since);
    const [closed, open] = await Promise.all([
      q.status === 'OPEN' ? Promise.resolve([]) : this.closedTrades(),
      q.status === 'CLOSED' ? Promise.resolve([]) : this.deps.store.paper.listTrades({ status: 'OPEN', strategyId: q.strategyId, connectionId: q.connectionId, since, limit: 5_000 }),
    ]);
    return [...open, ...closed.filter(keep)].sort((a, b) => b.entryAt.localeCompare(a.entryAt));
  }

  /** Results for the trades matching the filters (all when none); connections are narrowed the same way. */
  async paperSummary(q: PaperQuery = {}): Promise<PaperSummary> {
    return paperTables(async () => {
      const { store } = this.deps;
      const [raw, strategies, connections, plans, overrides] = await Promise.all([
        this.paperTradesFor({ ...q, status: undefined }),
        store.strategies.list(),
        store.connections.list(),
        store.paper.listPlans(),
        store.paper.listOverrides(),
      ]);
      const scope = await this.paperScope(q, strategies, [...raw.map((t) => t.productId), ...connections.map((c) => c.productId)]);
      return paperSummary({
        trades: raw.filter(scope.trade),
        strategies,
        connections: connections.filter((c) => (!q.connectionId || c.id === q.connectionId) && scope.product(c.productId, c.strategyId)),
        plans,
        overrides,
        now: this.now(),
        from: q.from ?? null,
        strategyId: q.strategyId,
      });
    });
  }

  /** What a paper filter keeps: products (type, market, symbol, the strategy's timeframe) and trades (also period end, side, group). */
  private async paperScope(q: PaperQuery, strategies: V2Strategy[], productIds: string[]) {
    const needProducts = !!(q.kinds?.length || q.markets?.length);
    const products = needProducts ? new Map((await this.deps.store.products.list({ ids: [...new Set(productIds)] })).map((p) => [p.id, p])) : new Map<string, V2Product>();
    const tf = new Map(strategies.map((s) => [s.id, s.definition.evaluation.triggerTimeframe]));
    const until = istRange(undefined, q.to).until;
    const search = q.search?.trim().toLowerCase();
    const product = (productId: string, strategyId: string) => {
      const p = products.get(productId);
      return (
        (!q.kinds?.length || (!!p && q.kinds.includes(p.kind))) &&
        (!q.markets?.length || (!!p && q.markets.includes(p.market))) &&
        (!search || (productId.split(':')[1] ?? '').toLowerCase().includes(search)) &&
        (!q.timeframes?.length || q.timeframes.includes(tf.get(strategyId)!))
      );
    };
    const trade = (t: PaperTrade) =>
      product(t.productId, t.strategyId) && (!until || t.entryAt < until) && (!q.sides?.length || q.sides.includes(t.side)) && (!q.groups?.length || (t.group !== null && q.groups.includes(t.group)));
    return { product, trade };
  }

  /** Every strategy's paper plan (defaults where none is saved) and every connection's own values — for the settings chips. */
  async paperSettings(): Promise<{ plans: Record<string, PaperPlan>; overrides: Record<string, PaperOverride> }> {
    return paperTables(async () => {
      const { store } = this.deps;
      const [strategies, plans, overrides] = await Promise.all([store.strategies.list(), store.paper.listPlans(), store.paper.listOverrides()]);
      const saved = new Map(plans.map((p) => [p.strategyId, p.plan]));
      return {
        plans: Object.fromEntries(strategies.map((s) => [s.id, saved.get(s.id) ? { ...saved.get(s.id)!, rules: resolveRules(s.definition, saved.get(s.id)!.rules) } : defaultPaperPlan(s.definition)])),
        overrides: Object.fromEntries(overrides.map((o) => [o.connectionId, o.override])),
      };
    });
  }

  /** A connection's own paper values (empty = follow the strategy). */
  async saveConnectionPaper(connectionId: string, override: PaperOverride): Promise<{ override: PaperOverride | null }> {
    return paperTables(async () => {
      await this.getConnection(connectionId);
      const clean = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined)) as PaperOverride;
      return { override: await this.deps.store.paper.saveOverride(connectionId, clean) };
    });
  }

  async paperTrades(q: PaperQuery = {}): Promise<PaperTrade[]> {
    return paperTables(async () => {
      const limit = Math.min(q.limit ?? 500, 5_000);
      const filtered = !!(q.kinds?.length || q.markets?.length || q.search?.trim() || q.timeframes?.length || q.to || q.sides?.length || q.groups?.length);
      const list = await this.paperTradesFor(q);
      const scope = filtered ? await this.paperScope(q, await this.deps.store.strategies.list(), list.map((t) => t.productId)) : null;
      return (scope ? list.filter(scope.trade) : list).slice(0, limit).map((t) => (t.status === 'OPEN' ? { ...t, openPnl: unrealizedPnl(t) } : t));
    });
  }

  async closePaperTrade(id: string): Promise<PaperTrade> {
    return paperTables(async () => {
      const t = await this.paper.closeManual(id);
      if (!t) throw new V2ServiceError(404, 'No open paper trade with that id (it may have closed already)');
      return t;
    });
  }

  async resetPaper(strategyId: string): Promise<{ deleted: number }> {
    return paperTables(async () => {
      await this.getStrategy(strategyId);
      return { deleted: await this.deps.store.paper.reset(strategyId) };
    });
  }

  // ---- settings / calendar / channels ------------------------------------------------------

  settings() {
    return this.deps.store.settings.get();
  }

  saveSettings(s: V2Settings) {
    return this.deps.store.settings.save(s);
  }

  calendarEntries() {
    return this.deps.store.calendar.list();
  }

  async saveCalendar(entries: CalendarEntry[]) {
    const keys = entries.map((e) => `${e.market}|${e.date}`);
    if (new Set(keys).size !== keys.length) throw new V2ServiceError(400, 'Each market + date may appear only once');
    await this.deps.store.calendar.replaceAll(entries);
    return this.deps.store.calendar.list();
  }

  async channelStatus() {
    return this.channels.status(await this.deps.store.settings.get());
  }

  async testChannel(name: ChannelName) {
    const settings = await this.deps.store.settings.get();
    const ch = this.channels.channel(name, settings);
    if (!ch) throw new V2ServiceError(400, this.channels.status(settings)[name].detail);
    const text = `✅ Algo Hunt · V2 test message (${name}) — ${new Date(this.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;
    const results = ((await ch.send({ subject: 'Algo Hunt · V2 test', text, html: `<p>${text}</p>` })) ?? [{}]).map((r) => ({ target: r.target, ok: !r.error, error: r.error }));
    if (results.every((r) => !r.ok)) throw new V2ServiceError(400, results.map((r) => (r.target ? `${r.target}: ${r.error}` : r.error)).join(' · '));
    return { ok: results.every((r) => r.ok), results };
  }

  private botCache: { at: number; info: { username: string; name: string; verified: boolean } } | null = null;

  /** The Telegram bot people should open and press Start on (looked up from the token, else the default bot). */
  async telegramBot(): Promise<{ username: string; name: string; verified: boolean }> {
    const now = this.now();
    if (this.botCache && now - this.botCache.at < 10 * 60_000) return this.botCache.info;
    const token = getConfig().telegramBotToken;
    let info = { username: DEFAULT_TELEGRAM_BOT, name: 'Algo Hunt', verified: false };
    if (token) {
      try {
        info = { ...(await telegramBotInfo(token)), verified: true };
      } catch {
        /* offline / bad token — show the default bot */
      }
    }
    this.botCache = { at: now, info };
    return info;
  }

  /** Chats that recently messaged the Telegram bot (people who pressed Start, groups it was added to). */
  async telegramRecentChats() {
    const token = getConfig().telegramBotToken;
    if (!token) throw new V2ServiceError(400, 'TELEGRAM_BOT_TOKEN is not set on the server');
    try {
      return await recentTelegramChats(token);
    } catch (err) {
      throw new V2ServiceError(400, msg(err));
    }
  }
}
