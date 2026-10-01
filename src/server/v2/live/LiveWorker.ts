/**
 * The V2 live worker (`npm run live`): streams Kite ticks for every contract the
 * switched-on connections use, builds candles as they form, and evaluates each
 * connection the moment its trigger candle closes.
 *
 * Accuracy: a result is decided on live-built candles only when it is clearly
 * false on fully observed data. Anything that would alert, sits near a
 * threshold where it could matter, or touches a stretch the stream didn't fully
 * observe is re-checked against Kite's official candles first (a few seconds
 * after the close) — alerts carry "verified" when Kite's candles agreed.
 *
 * Every second (`step`):
 *   session   Kite login → start / restart the stream (new token each morning)
 *   day       new trading day → fresh candles + history; morning instrument sync
 *   context   switched-on connections, strategies, products, calendar (every 15 s)
 *   plan      contracts to stream: legs at the current ATM + nearby strikes (every 60 s)
 *   candles   close finished minutes
 *   evaluate  connections whose trigger candle just closed (live-candle mode: every minute)
 *   paper     open paper trades: stop / target on every tick; square-off, expiry and prices (every 10 s)
 *   status    heartbeat row for the app and the backup scanner (every 5 s)
 */
import { randomUUID } from 'node:crypto';
import type { LiveCandleStat, LiveState, LiveStatus, Market, PaperTrade, UnitEvaluation, UnitState, V2Instrument, V2Settings } from '@/shared/v2';
import { TIMEFRAME, marketOfExchange } from '@/shared/v2';
import { IST_OFFSET_MS, istDate } from '../../utils/marketTime';
import { childLogger } from '../../utils/logger';
import { initialState } from '../alerts/alertPolicy';
import { deliver, type ChannelFactory, type Message } from '../alerts/notifications';
import { calendars, dateStartMs, type MarketCalendar } from '../calendar/MarketCalendar';
import { LOOKBACK_DAYS } from '../data/CandleService';
import type { NativeInterval, V2DataProvider } from '../data/DataProvider';
import type { ProductService } from '../data/ProductService';
import { buildSeries } from '../engine/candles';
import { evaluateUnit, type SeriesLookup, type SeriesResult, type UnitEvalInput } from '../engine/evaluator';
import { seriesKey, seriesOf } from '../engine/series';
import type { V2Store } from '../persistence/V2Store';
import { PaperTrader, paperHit } from '../paper/PaperTrader';
import { commitUnit, previousResult, type Clock, type CommitDeps, type CommitStats, type UnitTarget } from '../scanner/commit';
import { clockFor } from '../scanner/V2Scanner';
import { resolveUnits } from '../universe/resolve';
import { FetchQueue } from './FetchQueue';
import { LIVE_STALE_MS } from './health';
import { LiveCandles, MINUTE_GRACE_MS } from './LiveCandles';
import type { StreamCredentials, StreamEvents, TickStream } from './KiteStream';
import { BUFFER_STRIKES, LIVE_CAPACITY, planSubscriptions, type PlanConnection, type SubscriptionPlan } from './plan';
import type { Tick } from './ticks';
import { checkReason, type CheckReason } from './verify';

const log = childLogger('v2-live');

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Evaluate this long after a candle closes (its last minute is closed by then). */
export const EVAL_DELAY_MS = MINUTE_GRACE_MS + 500;
/** First look at Kite's candles this long after the close. */
export const CONFIRM_DELAY_MS = 4_000;
/** Second look when Kite's candle differed from the live one. */
const CONFIRM_REREAD_MS = 10_000;
/** Give up waiting for Kite's candles (decide on live candles, marked unverified). */
export const CONFIRM_DEADLINE_MS = 120_000;
const CONFIRM_RETRY_MS = 5_000;
const SESSION_EVERY_MS = 30_000;
const CONTEXT_EVERY_MS = 15_000;
/** Reload connections etc. at least this often even when nothing seems changed. */
const CONTEXT_FULL_EVERY_MS = 10 * 60_000;
const PLAN_EVERY_MS = 60_000;
/** Heartbeat / status save interval (memory in the one-process app; the database for a separate worker). */
const STATUS_EVERY_MS = 5_000;
const PAPER_EVERY_MS = 10_000;
const DOWN_WARN_MS = 60_000;
/** Morning instrument sync (Kite republishes contracts daily; new weeklies appear overnight). */
const MORNING_SYNC_MIN = 8 * 60 + 15;
const KEEP_CANDLE_STATS = 30;
const KEEP_ERRORS = 20;

export interface LiveSession {
  /** Kite credentials of the logged-in session, or null (not logged in / expired). */
  credentials(): Promise<StreamCredentials | null>;
}

export interface LiveWorkerDeps {
  store: V2Store;
  provider: V2DataProvider;
  products: ProductService;
  channels: ChannelFactory;
  stream: TickStream;
  session: LiveSession;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  workerId?: string;
  bufferStrikes?: number;
  capacity?: number;
  /** How often the status is saved (default 5 s). */
  statusEveryMs?: number;
}

interface Ctx {
  settings: V2Settings;
  cals: Record<Market, MarketCalendar>;
  list: PlanConnection[];
  signature: string;
}

interface Group {
  market: Market;
  clock: Clock;
  /** Processed marker (trigger open, or the minute in live-candle mode). */
  mark: number;
  items: PlanConnection[];
}

interface CheckItem {
  target: UnitTarget;
  input: UnitEvalInput;
  provisional: UnitEvaluation;
  reason: CheckReason;
  state: UnitState;
}

interface Feed {
  instrument: V2Instrument;
  interval: NativeInterval;
  /** Kite's candles must reach this time (close of the last candle the series uses at T). */
  required: number;
  trigger: boolean;
}

const isIndexToken = (token: number) => (token & 0xff) === 9;
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const istClock = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(11, 16);

export class LiveWorker {
  readonly id: string;
  private readonly candles: LiveCandles;
  private readonly queue = new FetchQueue(2);
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stepping = false;
  private startedAt = 0;

  private creds: StreamCredentials | null = null;
  private credsAt = -Infinity;
  private ctx: Ctx | null = null;
  private ctxAt = -Infinity;
  private ctxStamp = '';
  private ctxFullAt = -Infinity;
  private plan: SubscriptionPlan | null = null;
  private planAt = -Infinity;
  private covered = new Set<string>();
  private day = '';
  private syncedToday = '';
  private syncRetryAt = -Infinity;
  private readonly retryAt = new Map<string, number>();
  private readonly restPrices = new Map<number, number>();
  private readonly contracts = new Map<string, V2Instrument[]>();
  private readonly warm = new Map<string, { needed: boolean; state: 'queued' | 'done' | 'failed' }>();
  private readonly processed = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly paper: PaperTrader;
  /** Open paper trades by contract token (checked on every tick). */
  private paperOpen = new Map<number, PaperTrade[]>();
  private readonly paperClosing = new Set<string>();
  private paperAt = -Infinity;

  private state: LiveState = 'STARTING';
  private detail = 'Starting';
  private statusAt = -Infinity;
  private lastState: LiveState | null = null;
  private readonly candleStats: LiveCandleStat[] = [];
  private readonly errors: Array<{ at: string; message: string }> = [];
  private today = { date: '', candles: 0, checked: 0, corrected: 0, unverified: 0, alerts: 0 };
  private tickCount = 0;
  private tickWindowAt = 0;
  private ticksPerSecond = 0;
  private lastTickAt: number | null = null;
  private driftMin: number | null = null;
  private clockDriftMs: number | null = null;
  private downSince: number | null = null;
  private downNotified = false;
  private loginNotifiedFor = '';

  constructor(private readonly deps: LiveWorkerDeps) {
    this.id = deps.workerId ?? randomUUID();
    this.now = deps.clock ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.candles = new LiveCandles(calendars([]));
    this.paper = new PaperTrader({ store: deps.store, now: this.now, prices: (list) => this.pricesFor(list) });
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  /** Refuses to start while another worker's heartbeat is fresh (unless `force`). */
  async start(opts: { force?: boolean; intervalMs?: number } = {}): Promise<void> {
    const other = await this.deps.store.live.get();
    if (!opts.force && other && other.status.workerId !== this.id && other.status.state !== 'STOPPED' && this.now() - Date.parse(other.status.heartbeatAt) < LIVE_STALE_MS) {
      throw new Error(`Another live worker is running (heartbeat ${Math.round((this.now() - Date.parse(other.status.heartbeatAt)) / 1000)} s ago). Stop it first, or start with --force.`);
    }
    this.startedAt = this.now();
    await this.saveStatus(true);
    this.timer = setInterval(() => void this.tick(), opts.intervalMs ?? 1000);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.deps.stream.stop();
    this.queue.clear();
    this.state = 'STOPPED';
    this.detail = 'Stopped';
    await this.saveStatus(true).catch(() => undefined);
  }

  private async tick(): Promise<void> {
    if (this.stepping) return;
    this.stepping = true;
    try {
      await this.step();
    } catch (err) {
      this.error(`Step failed: ${msg(err)}`);
    } finally {
      this.stepping = false;
    }
  }

  /** Waits until queued fetches and confirmations are done (tests). */
  async idle(): Promise<void> {
    for (;;) {
      await this.queue.idle();
      if (!this.tasks.size) return;
      await Promise.allSettled([...this.tasks]);
    }
  }

  /** Stream events (the stream calls these). */
  readonly events: StreamEvents = {
    ticks: (ticks, receivedAt) => {
      for (const t of ticks) this.candles.ingest(t, receivedAt);
      if (this.paperOpen.size) this.paperTicks(ticks);
      this.tickCount += ticks.length;
      this.lastTickAt = receivedAt;
      for (const t of ticks) {
        if (t.exchangeTime) {
          const d = receivedAt - t.exchangeTime;
          this.driftMin = this.driftMin === null ? d : Math.min(this.driftMin, d);
        }
      }
    },
    observing: (tokens, at) => this.candles.observing(tokens, at),
    lost: (tokens, at) => this.candles.lost(tokens, at),
  };

  // ---- one step ----------------------------------------------------------------------------

  async step(now = this.now()): Promise<void> {
    if (now - this.credsAt >= SESSION_EVERY_MS || !this.creds) await this.refreshSession(now);
    if (!this.creds) {
      this.state = 'WAITING_LOGIN';
      this.detail = 'Waiting for Kite login (Settings → Broker Connection)';
      await this.maybeRemindLogin(now);
      await this.maybeSaveStatus(now);
      return;
    }
    const today = istDate(now);
    if (today !== this.day) this.newDay(now);
    if (now - this.ctxAt >= CONTEXT_EVERY_MS) await this.loadContext(now);
    if (!this.ctx) {
      await this.maybeSaveStatus(now);
      return;
    }
    await this.morningSync(now);
    if (now - this.paperAt >= PAPER_EVERY_MS) await this.paperStep(now);
    if (now - this.planAt >= PLAN_EVERY_MS) await this.replan(now);
    this.candles.finalize(now);
    await this.evaluateDue(now);
    this.updateState(now);
    await this.watchStream(now);
    await this.maybeSaveStatus(now);
  }

  private async refreshSession(now: number): Promise<void> {
    this.credsAt = now;
    let next: StreamCredentials | null = null;
    try {
      next = await this.deps.session.credentials();
    } catch (err) {
      this.error(`Kite session check failed: ${msg(err)}`);
    }
    const changed = next?.accessToken !== this.creds?.accessToken;
    if (!next) {
      if (this.creds) {
        this.candles.lost(this.candles.tokens(), now);
        this.deps.stream.stop();
      }
      this.creds = null;
      return;
    }
    if (changed) {
      if (this.creds) this.candles.lost(this.candles.tokens(), now);
      this.creds = next;
      this.deps.stream.start(next, this.events);
      this.planAt = -Infinity; // re-apply the subscription list to the new stream
    }
  }

  private newDay(now: number): void {
    this.day = istDate(now);
    this.candles.reset(now);
    this.queue.clear();
    this.warm.clear();
    this.processed.clear();
    this.contracts.clear();
    this.today = { date: this.day, candles: 0, checked: 0, corrected: 0, unverified: 0, alerts: 0 };
    this.planAt = -Infinity;
    log.info({ day: this.day }, 'new trading day');
  }

  /** Once per trading day after 08:15 IST: refresh the contract list from Kite (retried every 10 min on failure). */
  private async morningSync(now: number): Promise<void> {
    if (this.syncedToday === this.day || !this.ctx || now < this.syncRetryAt) return;
    const minute = Math.floor((now - dateStartMs(this.day)) / MINUTE);
    const trading = this.ctx.cals.NSE.isTradingDay(this.day) || this.ctx.cals.MCX.isTradingDay(this.day);
    if (!trading || minute < MORNING_SYNC_MIN) return;
    try {
      const at = await this.deps.store.instruments.syncedAt();
      if (!at || Date.parse(at) < dateStartMs(this.day) + MORNING_SYNC_MIN * MINUTE) {
        const r = await this.deps.products.sync();
        log.info(r, 'morning instrument sync');
        this.contracts.clear();
        this.ctxAt = -Infinity;
        this.ctxStamp = ''; // force a full reload with the new contracts
        this.planAt = -Infinity;
      }
      this.syncedToday = this.day;
    } catch (err) {
      this.syncRetryAt = now + 10 * MINUTE;
      this.error(`Instrument sync failed (retrying in 10 min): ${msg(err)}`);
    }
  }

  private async loadContext(now: number): Promise<void> {
    this.ctxAt = now;
    const { store, products } = this.deps;
    try {
      // A one-value check first: connections, strategies, settings, calendar and products rarely change.
      const stamp = await store.contextStamp();
      if (this.ctx && stamp === this.ctxStamp && now - this.ctxFullAt < CONTEXT_FULL_EVERY_MS) return;
      const [settings, entries, connections] = await Promise.all([store.settings.get(), store.calendar.list(), store.connections.list()]);
      const enabled = connections.filter((c) => c.enabled);
      const strategies = new Map(await Promise.all([...new Set(enabled.map((c) => c.strategyId))].map(async (id) => [id, await store.strategies.get(id)] as const)));
      const prods = new Map((enabled.length ? await store.products.list({ ids: [...new Set(enabled.map((c) => c.productId))] }) : []).map((p) => [p.id, p]));
      // Contracts only change at the daily sync: cached for the day, missing ones loaded in parallel.
      const missing = [...prods.keys()].filter((id) => !this.contracts.has(id));
      await Promise.all(missing.map(async (id) => this.contracts.set(id, await products.instruments(id, now))));
      const list: PlanConnection[] = [];
      for (const c of enabled) {
        const strategy = strategies.get(c.strategyId);
        const product = prods.get(c.productId);
        if (!strategy || !product) continue;
        list.push({ connection: c, strategy, product, instruments: this.contracts.get(product.id) ?? [] });
      }
      const signature = list.map((x) => `${x.connection.id}:${x.connection.updatedAt}:${x.connection.enabledAt}:${x.strategy.version}:${x.instruments.length}`).join('|');
      const cals = calendars(entries);
      this.candles.setCalendars(cals);
      const changed = signature !== this.ctx?.signature;
      this.ctx = { settings, cals, list, signature };
      this.ctxStamp = stamp; // only once the reload worked
      this.ctxFullAt = now;
      if (changed) this.planAt = -Infinity;
    } catch (err) {
      this.error(`Loading connections failed: ${msg(err)}`);
    }
  }

  // ---- subscriptions + warm-up -------------------------------------------------------------

  private async replan(now: number): Promise<void> {
    const ctx = this.ctx!;
    this.planAt = now;
    const today = istDate(now);
    const price = (t: number) => this.candles.lastPrice(t) ?? this.restPrices.get(t);
    const opts = { buffer: this.deps.bufferStrikes ?? BUFFER_STRIKES, capacity: this.deps.capacity ?? LIVE_CAPACITY };
    let plan = planSubscriptions(ctx.list, price, today, opts);
    if (plan.waitingForPrice.length) {
      const refs = [...new Map(plan.waitingForPrice.map((id) => plan.references.get(id)!).map((i) => [i.token, i])).values()];
      try {
        for (const [t, p] of await this.deps.provider.getLtp(refs)) this.restPrices.set(t, p);
        plan = planSubscriptions(ctx.list, price, today, opts);
      } catch (err) {
        this.error(`Prices for ATM failed: ${msg(err)}`);
      }
    }
    // Open paper trades keep streaming even after the ATM moves away from their strike.
    const paper = [...this.paperOpen.values()].map((l) => l[0]!.instrument).filter((i) => !plan.instruments.has(i.token));
    for (const i of [...[...plan.instruments.values()].map((p) => p.instrument), ...paper]) this.candles.track(i.token, marketOfExchange(i.exchange), isIndexToken(i.token));
    const keep = new Set([...plan.instruments.keys(), ...paper.map((i) => i.token)]);
    for (const t of this.candles.tokens()) if (!keep.has(t)) this.candles.untrack(t);
    this.deps.stream.setTokens([...keep]);
    this.plan = plan;
    this.covered = new Set(plan.covered);
    // History: contracts in use first, nearby strikes after.
    for (const p of plan.instruments.values()) for (const interval of p.intervals) this.warmUp(p.instrument, interval, p.needed);
  }

  private warmUp(instrument: V2Instrument, interval: NativeInterval, needed: boolean): void {
    const key = `${instrument.token}|${interval}`;
    const cur = this.warm.get(key);
    if (cur && cur.state !== 'failed') {
      if (needed && !cur.needed && cur.state === 'queued') {
        cur.needed = true;
        void this.queue.run(1, `warm|${key}`, () => Promise.resolve()).catch(() => undefined); // bumps the queued job
      }
      return;
    }
    const entry = { needed, state: 'queued' as const } as { needed: boolean; state: 'queued' | 'done' | 'failed' };
    this.warm.set(key, entry);
    this.queue
      .run(needed ? 1 : 2, `warm|${key}`, () => this.fetchOfficial(instrument, interval, 'history'))
      .then(
        () => (entry.state = 'done'),
        (err) => {
          entry.state = 'failed';
          if (msg(err) !== 'cancelled') this.error(`History for ${instrument.symbol} (${interval}) failed: ${msg(err)}`);
        },
      );
  }

  /** Kite's candles for a contract: full look-back (history) or just today (confirm / repair). */
  private async fetchOfficial(instrument: V2Instrument, interval: NativeInterval, range: 'history' | 'today'): Promise<void> {
    const startedAt = this.now();
    const today = istDate(startedAt);
    const known = this.candles.officialUntil(instrument.token, interval) !== undefined;
    const from = range === 'today' && known ? today : istDate(startedAt - LOOKBACK_DAYS[interval] * DAY);
    const rows = await this.deps.provider.getHistoricalCandles({ instrument, interval, from, to: today });
    this.candles.track(instrument.token, marketOfExchange(instrument.exchange), isIndexToken(instrument.token));
    this.candles.applyOfficial(instrument.token, interval, rows, startedAt);
  }

  // ---- evaluation --------------------------------------------------------------------------

  private async evaluateDue(now: number): Promise<void> {
    const ctx = this.ctx!;
    const groups = new Map<string, Group>();
    for (const pc of ctx.list) {
      if (!this.covered.has(pc.connection.id)) continue;
      const cal = ctx.cals[pc.product.market];
      if (!cal.isMarketOpen(now - EVAL_DELAY_MS, 1)) continue;
      const d = pc.strategy.definition;
      const live = d.evaluation.mode === 'LIVE_CANDLE';
      const ref = live ? Math.floor((now - EVAL_DELAY_MS) / MINUTE) * MINUTE : now - EVAL_DELAY_MS;
      const clock = clockFor(cal, d, ref);
      if (!clock) continue;
      const mark = live ? ref : clock.triggerOpenMs;
      if ((this.processed.get(pc.connection.id) ?? -Infinity) >= mark) continue;
      if ((this.retryAt.get(pc.connection.id) ?? -Infinity) > now) continue;
      const key = `${pc.product.market}|${d.evaluation.triggerTimeframe}|${d.evaluation.mode}|${clock.triggerOpenMs}|${clock.at}`;
      const g = groups.get(key) ?? { market: pc.product.market, clock, mark, items: [] };
      g.items.push(pc);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      try {
        await this.processGroup(g);
        for (const pc of g.items) this.processed.set(pc.connection.id, g.mark);
      } catch (err) {
        // Retried shortly (units already decided are skipped; signals are deduped).
        for (const pc of g.items) this.retryAt.set(pc.connection.id, now + 10_000);
        this.error(`Evaluating ${g.items.length} connection(s) failed (retrying): ${msg(err)}`);
      }
    }
  }

  /** A lookup over the live candles as of T; records contracts whose data had gaps. */
  private lookupAt(at: number): (dirty: Set<number>) => SeriesLookup {
    const cals = this.ctx!.cals;
    const built = new Map<string, { result: SeriesResult; dirty: boolean }>();
    return (dirty) => (instrument, spec) => {
      const key = seriesKey(instrument, spec);
      let hit = built.get(key);
      if (!hit) {
        const v = this.candles.view(instrument.token, TIMEFRAME[spec.timeframe].native, at);
        const result: SeriesResult =
          !v.warmed && !v.candles.length ? { error: 'no history yet (warming up)' } : { candles: buildSeries(v.candles, spec.timeframe, spec.candle, cals[marketOfExchange(instrument.exchange)], at) };
        hit = { result, dirty: v.dirty };
        built.set(key, hit);
      }
      if (hit.dirty) dirty.add(instrument.token);
      return hit.result;
    };
  }

  private async processGroup(g: Group): Promise<void> {
    const { store } = this.deps;
    const ctx = this.ctx!;
    const d0 = g.items[0]!.strategy.definition;
    const today = istDate(g.clock.at);
    const states = new Map((await store.units.listFor(g.items.map((x) => x.connection.id))).map((s) => [`${s.connectionId}|${s.unitKey}`, s]));
    const stat: LiveCandleStat = { market: g.market, timeframe: d0.evaluation.triggerTimeframe, candle: Math.floor(g.clock.triggerOpenMs / 1000), units: 0, evaluatedMs: 0, checked: 0, corrected: 0, unverified: 0, alerts: 0 };
    const lookup = this.lookupAt(g.clock.at);
    const memo = new Map<string, unknown>();
    const certain: Array<{ target: UnitTarget; input: UnitEvalInput; evaluation: UnitEvaluation; state: UnitState }> = [];
    const checks: CheckItem[] = [];
    const chained: Array<() => Promise<void>> = [];

    for (const pc of g.items) {
      const d = pc.strategy.definition;
      const ref = this.plan?.references.get(pc.connection.id);
      const px = ref ? (this.candles.priceAt(ref.token, g.clock.at) ?? this.restPrices.get(ref.token)) : undefined;
      const res = resolveUnits(d, pc.product.id, pc.instruments, pc.connection.config, px, today);
      for (const e of res.errors) this.error(`${pc.product.symbol}: ${e}`);
      const target: UnitTarget = { connection: pc.connection, strategy: pc.strategy, product: pc.product, clock: g.clock };
      for (const unit of res.units) {
        const state = states.get(`${pc.connection.id}|${unit.key}`) ?? initialState(pc.connection.id, unit.key);
        if (d.evaluation.mode === 'COMPLETED_CANDLE' && state.lastEvaluatedCandle === stat.candle) continue;
        const dirty = new Set<number>();
        const input: UnitEvalInput = { strategyId: pc.strategy.id, version: pc.strategy.version, productId: pc.product.id, definition: d, unit, lookup: lookup(dirty), triggerOpenMs: g.clock.triggerOpenMs, at: g.clock.at, memo };
        const evaluation: UnitEvaluation = { ...evaluateUnit(input), source: 'LIVE' };
        stat.units++;
        const reason = d.evaluation.mode === 'LIVE_CANDLE' ? null : checkReason(d, evaluation, dirty.size > 0);
        const unitId = `${pc.connection.id}|${unit.key}`;
        if (reason) checks.push({ target, input, provisional: evaluation, reason, state });
        else if (this.inflight.has(unitId)) chained.push(() => this.chain(unitId, () => this.commitOne(target, input, evaluation, stat)));
        else certain.push({ target, input, evaluation, state });
      }
    }

    // Clear results on fully observed data: decided now, states written in one batch.
    const stats: CommitStats = { signals: 0, alerts: 0, errors: [] };
    const next: UnitState[] = [];
    for (const c of certain) {
      const prev = previousResult(g.clock, c.state, c.input, c.evaluation);
      next.push(await commitUnit(this.commitDeps(), c.target, c.input.unit, c.evaluation, prev, c.state, ctx.settings, stats));
    }
    if (next.length) await store.units.upsertMany(next);
    for (const e of stats.errors) this.error(e.message);
    stat.alerts += stats.alerts;
    stat.evaluatedMs = this.now() - g.clock.at;
    stat.checked = checks.length;
    this.today.candles++;
    this.today.checked += checks.length;
    this.today.alerts += stats.alerts;
    this.pushStat(stat);

    for (const run of chained) this.track(run());
    if (!checks.length) {
      stat.confirmedMs = stat.evaluatedMs;
      return;
    }
    const order: Record<CheckReason, number> = { TRUE: 0, NEAR: 1, GAP: 2 };
    checks.sort((a, b) => order[a.reason] - order[b.reason]);
    const all = checks.map((item) => this.chain(`${item.target.connection.id}|${item.input.unit.key}`, () => this.confirmItem(g, item, stat)));
    this.track(
      Promise.allSettled(all).then(() => {
        stat.confirmedMs = this.now() - g.clock.at;
      }),
    );
  }

  /** Per-unit ordering: a unit's next candle waits for its previous confirmation. */
  private chain(unitId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.inflight.get(unitId) ?? Promise.resolve();
    const p = prev.then(fn, fn).catch((err) => this.error(`Unit ${unitId}: ${msg(err)}`));
    this.inflight.set(unitId, p);
    void p.finally(() => {
      if (this.inflight.get(unitId) === p) this.inflight.delete(unitId);
    });
    return p;
  }

  private track(p: Promise<unknown>): void {
    const t = p.then(
      () => undefined,
      () => undefined,
    );
    this.tasks.add(t);
    void t.finally(() => this.tasks.delete(t));
  }

  private feedsOf(item: CheckItem, cal: MarketCalendar): Feed[] {
    const at = item.input.at;
    const trig = item.input.definition.evaluation.triggerTimeframe;
    const out = new Map<string, Feed>();
    for (const s of seriesOf(item.input.definition)) {
      const instrument = item.input.unit.legs[s.leg];
      if (!instrument) continue;
      const interval = TIMEFRAME[s.timeframe].native;
      const key = `${instrument.token}|${interval}`;
      const last = cal.lastCompletedOpen(at, interval as keyof typeof TIMEFRAME);
      const required = last === null ? -Infinity : cal.candleClose(last, interval as keyof typeof TIMEFRAME);
      const trigger = s.timeframe === trig && !TIMEFRAME[trig].derived;
      const cur = out.get(key);
      out.set(key, { instrument, interval, required: Math.max(required, cur?.required ?? -Infinity), trigger: trigger || (cur?.trigger ?? false) });
    }
    return [...out.values()];
  }

  private covers(f: Feed): boolean {
    return (this.candles.officialUntil(f.instrument.token, f.interval) ?? -Infinity) >= f.required;
  }

  /** Kite's candle for the trigger period differs from the one built live (Kite may still be settling it). */
  private unsettled(feeds: Feed[], triggerOpenMs: number): Feed[] {
    return feeds.filter((f) => {
      if (!f.trigger) return false;
      const live = this.candles.liveCandle(f.instrument.token, f.interval, triggerOpenMs);
      const official = this.candles.officialCandle(f.instrument.token, f.interval, triggerOpenMs);
      if (!live) return false;
      if (!official) return true;
      const same = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a));
      return !(same(live.open, official.open) && same(live.high, official.high) && same(live.low, official.low) && same(live.close, official.close) && live.volume === official.volume);
    });
  }

  private async confirmItem(g: Group, item: CheckItem, stat: LiveCandleStat): Promise<void> {
    const at = g.clock.at;
    const cal = this.ctx!.cals[g.market];
    const feeds = this.feedsOf(item, cal);
    await this.sleepUntil(at + CONFIRM_DELAY_MS);
    let verified = false;
    let reread = false;
    for (let attempt = 0; ; attempt++) {
      const missing = feeds.filter((f) => !this.covers(f));
      await Promise.all(missing.map((f) => this.queue.run(0, `today|${f.instrument.token}|${f.interval}|${attempt}`, () => this.fetchOfficial(f.instrument, f.interval, 'today')).catch(() => undefined)));
      if (feeds.every((f) => this.covers(f))) {
        const shaky = reread ? [] : this.unsettled(feeds, g.clock.triggerOpenMs);
        if (shaky.length) {
          reread = true;
          await this.sleepUntil(at + CONFIRM_REREAD_MS);
          await Promise.all(shaky.map((f) => this.queue.run(0, `reread|${f.instrument.token}|${f.interval}|${at}`, () => this.fetchOfficial(f.instrument, f.interval, 'today')).catch(() => undefined)));
          if (this.unsettled(shaky, g.clock.triggerOpenMs).some((f) => !this.candles.officialCandle(f.instrument.token, f.interval, g.clock.triggerOpenMs))) {
            // Kite still has no candle where trades happened — keep waiting.
            if (this.now() >= at + CONFIRM_DEADLINE_MS) break;
            await this.sleep(CONFIRM_RETRY_MS);
            continue;
          }
        }
        verified = true;
        break;
      }
      if (this.now() >= at + CONFIRM_DEADLINE_MS) break;
      await this.sleep(CONFIRM_RETRY_MS);
    }

    const dirty = new Set<number>();
    const input: UnitEvalInput = { ...item.input, lookup: this.lookupAt(at)(dirty), memo: new Map() };
    const evaluation: UnitEvaluation = { ...evaluateUnit(input), source: verified ? 'LIVE_VERIFIED' : 'LIVE_UNVERIFIED' };
    if (evaluation.result !== item.provisional.result) {
      stat.corrected++;
      this.today.corrected++;
      log.info({ unit: input.unit.key, connection: item.target.connection.id, live: item.provisional.result, kite: evaluation.result, reason: item.reason }, 'kite candles changed a live result');
    }
    if (!verified) {
      stat.unverified++;
      this.today.unverified++;
    }
    await this.commitOne(item.target, input, evaluation, stat);
  }

  /** Commit one unit with its latest stored state (used after confirmations and for chained units). */
  private async commitOne(target: UnitTarget, input: UnitEvalInput, evaluation: UnitEvaluation, stat: LiveCandleStat): Promise<void> {
    const { store } = this.deps;
    const state = (await store.units.get(target.connection.id, input.unit.key)) ?? initialState(target.connection.id, input.unit.key);
    if (state.lastEvaluatedCandle !== null && state.lastEvaluatedCandle > evaluation.triggerCandle) return; // a newer candle was already decided
    if (input.definition.evaluation.mode === 'COMPLETED_CANDLE' && state.lastEvaluatedCandle === evaluation.triggerCandle) return;
    const stats: CommitStats = { signals: 0, alerts: 0, errors: [] };
    const prev = previousResult(target.clock, state, input, evaluation);
    const next = await commitUnit(this.commitDeps(), target, input.unit, evaluation, prev, state, this.ctx!.settings, stats);
    await store.units.upsert(next);
    for (const e of stats.errors) this.error(e.message);
    stat.alerts += stats.alerts;
    this.today.alerts += stats.alerts;
  }

  private commitDeps(): CommitDeps {
    return {
      store: this.deps.store,
      channels: this.deps.channels,
      now: this.now,
      onAlert: async (a) => {
        const line = await this.paper.onAlert({ ...a, cal: this.ctx!.cals[a.product.market] });
        if (line) this.paperAt = -Infinity; // watch the new trade from the next step
        return line;
      },
    };
  }

  // ---- paper trading -----------------------------------------------------------------------

  /** Streamed prices first; contracts without one from Kite's LTP. */
  private async pricesFor(list: V2Instrument[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    const missing: V2Instrument[] = [];
    for (const i of list) {
      const p = this.candles.lastPrice(i.token);
      if (p !== undefined) out.set(i.token, p);
      else missing.push(i);
    }
    if (missing.length) {
      try {
        for (const [t, p] of await this.deps.provider.getLtp(missing)) out.set(t, p);
      } catch (err) {
        this.error(`Paper trading prices failed: ${msg(err)}`);
      }
    }
    return out;
  }

  /** Square-off / expiry deadlines and fresh prices; refreshes the contracts watched tick by tick. */
  private async paperStep(now: number): Promise<void> {
    this.paperAt = now;
    try {
      const { open, closed } = await this.paper.monitor(this.ctx!.cals);
      const next = new Map<number, PaperTrade[]>();
      for (const t of open) next.set(t.instrument.token, [...(next.get(t.instrument.token) ?? []), t]);
      const streamed = new Set(this.candles.tokens());
      this.paperOpen = next;
      if ([...next.keys()].some((t) => !streamed.has(t))) this.planAt = -Infinity;
      if (closed.length) log.info({ closed: closed.map((t) => `${t.instrument.symbol} ${t.exitReason}`) }, 'paper trades closed');
    } catch (err) {
      this.error(`Checking paper trades failed: ${msg(err)}`);
    }
  }

  /** Stop-loss / target on each tick of a contract with an open paper trade. */
  private paperTicks(ticks: Tick[]): void {
    for (const tick of ticks) {
      const list = this.paperOpen.get(tick.token);
      if (!list) continue;
      for (const trade of list) {
        if (this.paperClosing.has(trade.id)) continue;
        const hit = paperHit(trade, tick.price);
        if (!hit) continue;
        this.paperClosing.add(trade.id);
        this.track(
          this.paper
            .close(trade, tick.price, hit)
            .then(() => {
              const rest = (this.paperOpen.get(tick.token) ?? []).filter((t) => t.id !== trade.id);
              if (rest.length) this.paperOpen.set(tick.token, rest);
              else this.paperOpen.delete(tick.token);
            })
            .catch((err) => this.error(`Closing paper trade ${trade.instrument.symbol} failed: ${msg(err)}`))
            .finally(() => this.paperClosing.delete(trade.id)),
        );
      }
    }
  }

  private async sleepUntil(t: number): Promise<void> {
    const wait = t - this.now();
    if (wait > 0) await this.sleep(wait);
  }

  // ---- health, notifications, status -------------------------------------------------------

  private updateState(now: number): void {
    const sockets = this.deps.stream.status();
    const tokens = this.plan?.instruments.size ?? 0;
    const neededWarm = [...this.warm.values()].filter((w) => w.needed);
    const warming = neededWarm.filter((w) => w.state === 'queued').length;
    if (tokens > 0 && !sockets.some((s) => s.state === 'OPEN')) {
      this.state = 'DEGRADED';
      const neverOpened = sockets.every((x) => x.lastMessageAt === null);
      this.detail = neverOpened ? 'Connecting to the Kite stream' : 'Kite stream disconnected — reconnecting; the backup scanner is covering';
      this.downSince ??= now;
    } else {
      this.downSince = null;
      if (warming > 0) {
        this.state = 'WARMING_UP';
        this.detail = `Loading history: ${neededWarm.length - warming} of ${neededWarm.length} contracts in use`;
      } else {
        this.state = 'LIVE';
        this.detail = tokens ? `Streaming ${tokens.toLocaleString('en-IN')} contracts` : 'No switched-on connections';
      }
    }
    if (now - this.tickWindowAt >= STATUS_EVERY_MS) {
      const secs = Math.max(1, (now - this.tickWindowAt) / 1000);
      this.ticksPerSecond = this.tickWindowAt ? Math.round(this.tickCount / secs) : 0;
      this.tickCount = 0;
      this.tickWindowAt = now;
      this.clockDriftMs = this.driftMin;
      this.driftMin = null;
      if (this.clockDriftMs !== null && Math.abs(this.clockDriftMs) > 3_000) this.error(`This computer's clock is ${Math.round(this.clockDriftMs / 1000)} s off the exchange — sync the system time`);
    }
  }

  private marketOpenForAny(now: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    return ctx.list.some((pc) => ctx.cals[pc.product.market].isMarketOpen(now));
  }

  private async notify(text: string): Promise<void> {
    const settings = this.ctx?.settings ?? (await this.deps.store.settings.get());
    const m: Message = { subject: 'V2 live alerts', text, html: `<p>${text.replace(/\n/g, '<br/>')}</p>` };
    await deliver(this.deps.channels, settings, { telegram: true, email: false }, m, this.now).catch(() => undefined);
  }

  private async watchStream(now: number): Promise<void> {
    if (this.downSince !== null && !this.downNotified && now - this.downSince >= DOWN_WARN_MS && this.marketOpenForAny(now)) {
      this.downNotified = true;
      await this.notify(`⚠️ V2 live feed disconnected since ${istClock(this.downSince)} IST — reconnecting.\nThe backup scanner covers your connections meanwhile (alerts may be a few minutes late).`);
    }
    if (this.downSince === null && this.downNotified) {
      this.downNotified = false;
      await this.notify('✅ V2 live feed reconnected — live alerts are back.');
    }
  }

  private async maybeRemindLogin(now: number): Promise<void> {
    if (this.loginNotifiedFor === istDate(now)) return;
    let ctx = this.ctx;
    if (!ctx) {
      await this.loadContext(now);
      ctx = this.ctx;
    }
    if (!ctx?.list.length) return;
    const date = istDate(now);
    const opens = [...new Set(ctx.list.map((pc) => pc.product.market))].filter((m) => ctx!.cals[m].isTradingDay(date)).map((m) => ctx!.cals[m].sessionStart(date));
    if (!opens.length) return;
    const first = Math.min(...opens);
    if (now >= first - 15 * MINUTE && now < first + 60 * MINUTE) {
      this.loginNotifiedFor = date;
      await this.notify('🔑 Log in to Kite (Algo Hunt → Settings → Broker Connection) — V2 live alerts start as soon as you do.');
    }
  }

  private pushStat(s: LiveCandleStat): void {
    this.candleStats.unshift(s);
    if (this.candleStats.length > KEEP_CANDLE_STATS) this.candleStats.length = KEEP_CANDLE_STATS;
  }

  private error(message: string): void {
    log.warn({ message }, 'v2 live');
    if (this.errors[0]?.message === message) return;
    this.errors.unshift({ at: new Date(this.now()).toISOString(), message });
    if (this.errors.length > KEEP_ERRORS) this.errors.length = KEEP_ERRORS;
  }

  private async maybeSaveStatus(now: number): Promise<void> {
    if (now - this.statusAt >= (this.deps.statusEveryMs ?? STATUS_EVERY_MS) || this.state !== this.lastState) await this.saveStatus(false);
  }

  status(): LiveStatus {
    const now = this.now();
    const warmList = [...this.warm.values()];
    const sizes = this.queue.sizes();
    return {
      workerId: this.id,
      startedAt: new Date(this.startedAt || now).toISOString(),
      heartbeatAt: new Date(now).toISOString(),
      state: this.state,
      detail: this.detail,
      sockets: this.deps.stream.status(),
      contracts: {
        needed: this.plan?.needed ?? 0,
        buffer: this.plan?.buffer ?? 0,
        subscribed: this.plan?.instruments.size ?? 0,
        capacity: this.deps.capacity ?? LIVE_CAPACITY,
        overCapacity: this.plan?.overCapacity ?? 0,
      },
      warmup: { done: warmList.filter((w) => w.state === 'done').length, total: warmList.length },
      queue: { confirm: sizes.confirm, warmup: sizes.warmup + sizes.buffer, repair: sizes.repair },
      ticks: { perSecond: this.ticksPerSecond, lastAt: this.lastTickAt ? new Date(this.lastTickAt).toISOString() : null, late: this.candles.late, clockDriftMs: this.clockDriftMs },
      connections: { covered: this.covered.size, uncovered: this.plan?.uncovered ?? [] },
      today: { ...this.today, date: this.today.date || istDate(now) },
      lastCandles: this.candleStats.slice(0, KEEP_CANDLE_STATS),
      errors: this.errors.slice(0, KEEP_ERRORS),
      memoryMb: Math.round(process.memoryUsage().rss / 1e6),
    };
  }

  private async saveStatus(force: boolean): Promise<void> {
    const now = this.now();
    if (!force && now - this.statusAt < 1000 && this.state === this.lastState) return;
    this.statusAt = now;
    this.lastState = this.state;
    try {
      await this.deps.store.live.save(this.status());
    } catch (err) {
      log.warn({ err: msg(err) }, 'saving live status failed');
    }
  }
}
