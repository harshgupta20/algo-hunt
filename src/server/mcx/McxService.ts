/**
 * MCX V2 application service — the operations the API exposes, composed from
 * the store, provider, resolver, scanner and dry-run tools. Controllers stay
 * thin: parse input → call one method → return data.
 */
import type {
  CalendarEntry,
  McxAlert,
  McxInstrument,
  McxSettings,
  McxStrategy,
  McxStrategyDefinition,
  Universe,
  UniverseResolution,
  ValidationIssue,
} from '@/shared/mcx';
import { MCX2_PRODUCTS, hasErrors, strategySummary, validateStrategy } from '@/shared/mcx';
import { istDate } from '../utils/marketTime';
import { envChannelFactory, formatAlert, type ChannelFactory, type ChannelName } from './alerts/notifications';
import { McxMarketCalendar } from './calendar/McxMarketCalendar';
import type { McxDataProvider, McxQuote } from './data/McxDataProvider';
import type { McxInstrumentService } from './data/McxInstrumentService';
import { McxDryRun, type ReplayRequest } from './debug/dryRun';
import type { McxStore } from './persistence/McxStore';
import { McxScanner, type ScanOptions } from './scanner/McxScanner';
import { futuresOf, optionExpiriesOf, referenceFutures, resolveUniverse, strikesOf } from './universe/UniverseResolver';

export class McxServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'McxServiceError';
  }
}

export interface McxServiceDeps {
  store: McxStore;
  provider: McxDataProvider;
  instruments: McxInstrumentService;
  channels?: ChannelFactory;
  clock?: () => number;
}

export interface UniversePreview extends UniverseResolution {
  cap: number;
  quotes: Record<string, McxQuote>;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class McxService {
  readonly scanner: McxScanner;
  readonly dryRun: McxDryRun;
  private readonly channels: ChannelFactory;

  constructor(private readonly deps: McxServiceDeps) {
    this.channels = deps.channels ?? envChannelFactory;
    this.scanner = new McxScanner({ ...deps, channels: this.channels });
    this.dryRun = new McxDryRun(deps);
  }

  private now(): number {
    return this.deps.clock ? this.deps.clock() : Date.now();
  }

  private async calendar(): Promise<McxMarketCalendar> {
    return new McxMarketCalendar(await this.deps.store.calendar.list());
  }

  // ---- status / catalog ----------------------------------------------------------------

  async status() {
    const now = this.now();
    const { store } = this.deps;
    const [cal, count, syncedAt, strategies, runs, settings, connected] = await Promise.all([
      this.calendar(),
      store.instruments.count(),
      store.instruments.syncedAt(),
      store.strategies.list(),
      store.scanRuns.list(1),
      store.settings.get(),
      this.deps.provider.isConnected().catch(() => false),
    ]);
    const today = istDate(now);
    const session = cal.session(today);
    return {
      now,
      market: {
        open: cal.isMarketOpen(now),
        today: session,
        sessionStart: session.trading ? cal.sessionStart(today) : null,
        sessionEnd: session.trading ? cal.sessionEnd(today) : null,
      },
      kiteConnected: connected,
      instruments: { count, syncedAt },
      strategies: { total: strategies.length, enabled: strategies.filter((s) => s.enabled).length },
      lastRun: runs[0] ?? null,
      channels: this.channels.status(settings),
    };
  }

  /** Products with their listed futures, option expiries and strike counts (from the V2 instrument master). */
  async products() {
    const all = await this.deps.instruments.list();
    const today = istDate(this.now());
    return MCX2_PRODUCTS.map((p) => {
      const futures = futuresOf(all, p.symbol, today);
      const expiries = optionExpiriesOf(all, p.symbol, today);
      return {
        ...p,
        futures: futures.map((f) => ({ id: f.id, symbol: f.symbol, expiry: f.expiry })),
        optionExpiries: expiries.map((e) => ({ expiry: e, strikes: strikesOf(all, p.symbol, e).length })),
      };
    });
  }

  async instruments(q: { underlying?: string; expiry?: string; type?: string; search?: string; limit?: number }): Promise<{ total: number; items: McxInstrument[] }> {
    const all = await this.deps.instruments.list();
    const s = q.search?.trim().toUpperCase();
    const items = all
      .filter(
        (i) =>
          i.active &&
          (!q.underlying || i.underlying === q.underlying) &&
          (!q.expiry || i.expiry === q.expiry) &&
          (!q.type || i.instrumentType === q.type || i.optionType === q.type) &&
          (!s || i.symbol.includes(s)),
      )
      .sort((a, b) => a.underlying.localeCompare(b.underlying) || (a.expiry ?? '').localeCompare(b.expiry ?? '') || (a.strike ?? 0) - (b.strike ?? 0) || a.symbol.localeCompare(b.symbol));
    return { total: items.length, items: items.slice(0, Math.min(q.limit ?? 500, 2000)) };
  }

  syncInstruments() {
    return this.deps.instruments.sync();
  }

  // ---- universe --------------------------------------------------------------------------

  async previewUniverse(u: Universe): Promise<UniversePreview> {
    const all = await this.deps.instruments.list();
    const today = istDate(this.now());
    const settings = await this.deps.store.settings.get();
    const refs = referenceFutures(u, all, today);
    let ltp = new Map<number, number>();
    const errors: string[] = [];
    if (refs.length) {
      try {
        ltp = await this.deps.provider.getLtp(refs);
      } catch (err) {
        errors.push(`Live price unavailable: ${msg(err)}`);
      }
    }
    const res = resolveUniverse(u, all, ltp, today);
    const quotes: Record<string, McxQuote> = {};
    const shown = res.units.slice(0, settings.universeCap);
    if (shown.length) {
      try {
        const q = await this.deps.provider.getQuotes(shown.map((x) => x.target));
        for (const x of shown) {
          const v = q.get(x.target.token);
          if (v) quotes[x.target.id] = v;
        }
      } catch (err) {
        res.notes.push(`Quotes unavailable: ${msg(err)}`);
      }
    }
    return { ...res, errors: [...errors, ...res.errors], cap: settings.universeCap, quotes };
  }

  // ---- strategies ------------------------------------------------------------------------

  async validate(d: McxStrategyDefinition, opts: { forEnable?: boolean; resolve?: boolean } = {}) {
    const [all, settings] = await Promise.all([this.deps.instruments.list(), this.deps.store.settings.get()]);
    const status = this.channels.status(settings);
    let resolvedTargets: number | undefined;
    let resolution: UniverseResolution | undefined;
    if (opts.resolve || opts.forEnable) {
      const today = istDate(this.now());
      const refs = referenceFutures(d.universe, all, today);
      const ltp = refs.length ? await this.deps.provider.getLtp(refs).catch(() => new Map<number, number>()) : new Map<number, number>();
      resolution = resolveUniverse(d.universe, all, ltp, today);
      // Without a live price ATM can't be resolved — don't block on that (the scanner re-resolves every cycle).
      if (!resolution.errors.some((e) => /live price/i.test(e))) resolvedTargets = resolution.units.length;
    }
    const issues = validateStrategy(d, {
      syncedProducts: [...new Set(all.map((i) => i.underlying))],
      channelsConfigured: { telegram: status.telegram.configured, email: status.email.configured },
      resolvedTargets,
      universeCap: settings.universeCap,
      forEnable: opts.forEnable,
    });
    for (const e of resolution?.errors ?? []) issues.push({ path: 'universe', message: e, severity: 'warning' });
    return { issues, valid: !hasErrors(issues), summary: strategySummary(d), resolvedTargets };
  }

  listStrategies() {
    return this.deps.store.strategies.list();
  }

  async getStrategy(id: string): Promise<McxStrategy> {
    const s = await this.deps.store.strategies.get(id);
    if (!s) throw new McxServiceError(404, 'Strategy not found');
    return s;
  }

  async createStrategy(d: McxStrategyDefinition): Promise<McxStrategy> {
    const v = await this.validate(d);
    if (!v.valid) throw new McxServiceError(400, 'The strategy has errors', v.issues);
    return this.deps.store.strategies.create(d);
  }

  /** Saves a new version. Unit state is reset (the logic changed); an enabled strategy must stay enable-valid. */
  async updateStrategy(id: string, d: McxStrategyDefinition): Promise<McxStrategy> {
    const cur = await this.getStrategy(id);
    const v = await this.validate(d, { forEnable: cur.enabled });
    if (!v.valid) throw new McxServiceError(400, 'The strategy has errors', v.issues);
    const s = await this.deps.store.strategies.update(id, d);
    await this.deps.store.units.clear(id);
    if (cur.enabled) await this.deps.store.strategies.setEnabled(id, true, new Date(this.now()).toISOString());
    return (await this.deps.store.strategies.get(id)) ?? s!;
  }

  async duplicateStrategy(id: string): Promise<McxStrategy> {
    const s = await this.getStrategy(id);
    return this.deps.store.strategies.create({ ...s.definition, name: `${s.definition.name} (copy)` });
  }

  async removeStrategy(id: string): Promise<void> {
    if (!(await this.deps.store.strategies.remove(id))) throw new McxServiceError(404, 'Strategy not found');
  }

  async enable(id: string): Promise<McxStrategy> {
    const s = await this.getStrategy(id);
    const v = await this.validate(s.definition, { forEnable: true });
    if (!v.valid) throw new McxServiceError(400, 'Fix these before enabling', v.issues);
    await this.deps.store.units.clear(id);
    return (await this.deps.store.strategies.setEnabled(id, true, new Date(this.now()).toISOString()))!;
  }

  async disable(id: string): Promise<McxStrategy> {
    await this.getStrategy(id);
    const s = await this.deps.store.strategies.setEnabled(id, false, new Date(this.now()).toISOString());
    for (const u of await this.deps.store.units.list(id)) await this.deps.store.units.upsert({ ...u, state: 'DISABLED' });
    return s!;
  }

  versions(id: string) {
    return this.deps.store.strategies.versions(id);
  }

  units(id: string) {
    return this.deps.store.units.list(id);
  }

  async explain(input: { strategyId?: string; definition?: McxStrategyDefinition; targetId?: string }) {
    const s = input.strategyId ? await this.getStrategy(input.strategyId) : undefined;
    const definition = input.definition ?? s?.definition;
    if (!definition) throw new McxServiceError(400, 'strategyId or definition is required');
    return this.dryRun.explain({ id: s?.id, version: s?.version, enabledAt: s?.enabledAt, definition }, { targetId: input.targetId });
  }

  async replay(input: { strategyId?: string; definition?: McxStrategyDefinition } & ReplayRequest) {
    const s = input.strategyId ? await this.getStrategy(input.strategyId) : undefined;
    const definition = input.definition ?? s?.definition;
    if (!definition) throw new McxServiceError(400, 'strategyId or definition is required');
    try {
      return await this.dryRun.replay({ id: s?.id, version: s?.version, definition }, input);
    } catch (err) {
      if (/limited to|must be on or before|not in the MCX V2/.test(msg(err))) throw new McxServiceError(400, msg(err));
      throw err;
    }
  }

  // ---- alerts / signals -----------------------------------------------------------------

  alerts(q: { strategyId?: string; active?: boolean; limit?: number }) {
    return this.deps.store.alerts.list(q);
  }

  async alert(id: string): Promise<McxAlert> {
    const a = await this.deps.store.alerts.get(id);
    if (!a) throw new McxServiceError(404, 'Alert not found');
    return a;
  }

  /** Acknowledge an alert: its unit stops alerting until the strategy turns false again. */
  async acknowledge(id: string): Promise<McxAlert> {
    const a = await this.alert(id);
    const out = await this.deps.store.alerts.acknowledge(id, new Date(this.now()).toISOString());
    const unit = await this.deps.store.units.get(a.strategyId, a.instrument.id);
    if (unit && unit.state !== 'DISABLED') await this.deps.store.units.upsert({ ...unit, state: 'ACKNOWLEDGED' });
    return out!;
  }

  signals(q: { strategyId?: string; limit?: number }) {
    return this.deps.store.signals.list(q.strategyId, Math.min(q.limit ?? 100, 500));
  }

  // ---- scanner -----------------------------------------------------------------------------

  scan(opts: ScanOptions = {}) {
    return this.scanner.runLocked(opts);
  }

  scanRuns(limit = 50) {
    return this.deps.store.scanRuns.list(Math.min(limit, 500));
  }

  async scanRun(id: string) {
    const r = await this.deps.store.scanRuns.get(id);
    if (!r) throw new McxServiceError(404, 'Scan run not found');
    return r;
  }

  // ---- settings / calendar / channels -------------------------------------------------------

  settings() {
    return this.deps.store.settings.get();
  }

  saveSettings(s: McxSettings) {
    return this.deps.store.settings.save(s);
  }

  calendarEntries() {
    return this.deps.store.calendar.list();
  }

  async saveCalendar(entries: CalendarEntry[]) {
    const dates = entries.map((e) => e.date);
    if (new Set(dates).size !== dates.length) throw new McxServiceError(400, 'Each date may appear only once');
    await this.deps.store.calendar.replaceAll([...entries].sort((a, b) => a.date.localeCompare(b.date)));
    return this.deps.store.calendar.list();
  }

  async channelStatus() {
    return this.channels.status(await this.deps.store.settings.get());
  }

  async testChannel(name: ChannelName) {
    const settings = await this.deps.store.settings.get();
    const ch = this.channels.channel(name, settings);
    if (!ch) throw new McxServiceError(400, this.channels.status(settings)[name].detail);
    const text = `✅ Algo Hunt · MCX V2 test message (${name}) — ${new Date(this.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;
    await ch.send({ subject: 'Algo Hunt · MCX V2 test', text, html: `<p>${text}</p>` });
    return { ok: true };
  }

  /** For tests / previews: the message an alert would produce. */
  preview(alert: Parameters<typeof formatAlert>[0]) {
    return formatAlert(alert);
  }
}
