/**
 * V2 application service — the operations the /api/v2 API exposes. Strategies
 * and products are independent; connections join them and produce alerts.
 */
import type {
  CalendarEntry,
  ConnectionConfig,
  StrategyDefinition,
  V2Alert,
  V2Connection,
  V2Product,
  V2Settings,
  V2Strategy,
  ValidationIssue,
} from '@/shared/v2';
import { hasErrors, incompatibility, strategySummary, validateConnection, validateStrategy } from '@/shared/v2';
import { istDate } from '../utils/marketTime';
import { envChannelFactory, type ChannelFactory, type ChannelName } from './alerts/notifications';
import { calendars } from './calendar/MarketCalendar';
import type { Quote, V2DataProvider } from './data/DataProvider';
import type { ProductService } from './data/ProductService';
import { V2Tools, type CompareRequest } from './debug/tools';
import type { ProductFilters, V2Store } from './persistence/V2Store';
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

export class V2Service {
  readonly scanner: V2Scanner;
  readonly tools: V2Tools;
  private readonly channels: ChannelFactory;

  constructor(private readonly deps: V2ServiceDeps) {
    this.channels = deps.channels ?? envChannelFactory;
    this.scanner = new V2Scanner({ ...deps, channels: this.channels });
    this.tools = new V2Tools(deps);
  }

  private now(): number {
    return this.deps.clock ? this.deps.clock() : Date.now();
  }

  // ---- status / products ---------------------------------------------------------------

  async status() {
    const now = this.now();
    const { store } = this.deps;
    const [entries, instruments, products, syncedAt, strategies, connections, runs, settings, kite] = await Promise.all([
      store.calendar.list(),
      store.instruments.count(),
      store.products.count(),
      store.instruments.syncedAt(),
      store.strategies.list(),
      store.connections.list(),
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
      strategies: strategies.length,
      connections: { total: connections.length, enabled: connections.filter((c) => c.enabled).length },
      lastRun: runs[0] ?? null,
      channels: this.channels.status(settings),
    };
  }

  products(f: ProductFilters) {
    return this.deps.store.products.list(f);
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

  alerts(q: { connectionId?: string; strategyId?: string; active?: boolean; limit?: number }) {
    return this.deps.store.alerts.list(q);
  }

  async acknowledge(id: string): Promise<V2Alert> {
    const a = await this.deps.store.alerts.get(id);
    if (!a) throw new V2ServiceError(404, 'Alert not found');
    const out = await this.deps.store.alerts.acknowledge(id, new Date(this.now()).toISOString());
    const unit = await this.deps.store.units.get(a.connectionId, a.unit.key);
    if (unit && unit.state !== 'DISABLED') await this.deps.store.units.upsert({ ...unit, state: 'ACKNOWLEDGED' });
    return out!;
  }

  signals(q: { connectionId?: string; strategyId?: string; limit?: number }) {
    return this.deps.store.signals.list(q);
  }

  scan(opts: ScanOptions = {}) {
    return this.scanner.runLocked(opts);
  }

  scanRuns(limit = 100) {
    return this.deps.store.scanRuns.list(Math.min(limit, 500));
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
    await ch.send({ subject: 'Algo Hunt · V2 test', text, html: `<p>${text}</p>` });
    return { ok: true };
  }
}
