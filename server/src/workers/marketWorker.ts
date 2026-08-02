/**
 * Background market worker. This is where live monitoring happens — NOT in the
 * Express routes. It wires the provider's tick stream through candle building,
 * incremental RSI, bucket-aligned strategy evaluation, and alert dispatch.
 *
 * Evaluation policy: a config is evaluated once per candle bucket, and only
 * when all three legs (future/call/put) have a *confirmed closed-candle* RSI for
 * that bucket. Live gauges use a provisional (peeked) RSI on the forming candle;
 * strategy decisions never do.
 */
import type { AlertConfiguration, ConfigRuntimeSnapshot, Leg, RsiUpdatePayload, Tick } from '@ash/shared';
import { previousBucket } from '../utils/time.js';
import { childLogger } from '../utils/logger.js';
import type { MarketDataProvider } from '../services/kite/MarketDataProvider.js';
import type { InstrumentStore } from '../services/kite/instrumentStore.js';
import type { StrategyEngine } from '../services/strategy/StrategyEngine.js';
import type { AlertService } from '../services/history/alertService.js';
import type { WsHub } from '../services/notification/wsHub.js';
import type { DataStore } from '../db/index.js';
import { buildScenarioSeries } from '../services/strategy/syntheticSeries.js';
import { computeRsiSeries } from '../services/indicator/rsi.js';
import type { Bar } from '../services/indicator/types.js';
import { ConfigRuntime, CustomConfigRuntime } from './instrumentState.js';

const log = childLogger('market-worker');

const RSI_BROADCAST_INTERVAL_MS = 900;

export interface WorkerDeps {
  provider: MarketDataProvider;
  instrumentStore: InstrumentStore;
  engine: StrategyEngine;
  alertService: AlertService;
  hub: WsHub;
  store: DataStore;
}

export class MarketWorker {
  private readonly runtimes = new Map<string, ConfigRuntime>();
  private readonly customRuntimes = new Map<string, CustomConfigRuntime>();
  private readonly tokenSubscribers = new Map<number, Set<string>>();
  private started = false;
  private live = false;

  constructor(private readonly deps: WorkerDeps) {}

  /** Wire event handlers. For mock, go live immediately; for Kite, wait for login. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.deps.provider.onStatus((s) => this.deps.hub.broadcastStatus(s));
    this.deps.provider.onTick((t) => {
      void this.handleTick(t);
    });

    if (this.deps.provider.name !== 'kite') {
      await this.startLive();
    } else {
      log.info('kite provider: awaiting login before connecting the live feed');
    }
  }

  get isLive(): boolean {
    return this.live;
  }

  /**
   * Load the instrument master, connect the feed, and (re)activate saved active
   * configs. Idempotent — the Kite auth manager calls this once a valid token is
   * available; mock calls it at start().
   */
  async startLive(): Promise<void> {
    if (this.live) return;
    this.live = true;
    try {
      await this.deps.instrumentStore.load();
      await this.deps.provider.connect();
      const active = await this.deps.store.configs.listActive();
      for (const cfg of active) {
        try {
          await this.activate(cfg);
        } catch (err) {
          log.error({ err, configId: cfg.id }, 'failed to re-activate config on startup');
        }
      }
      log.info({ active: this.runtimes.size + this.customRuntimes.size }, 'market worker live');
    } catch (err) {
      this.live = false; // allow retry after re-login
      throw err;
    }
  }

  async stop(): Promise<void> {
    await this.deps.provider.disconnect();
    this.runtimes.clear();
    this.customRuntimes.clear();
    this.tokenSubscribers.clear();
    this.started = false;
  }

  private levelFor(leg: Leg, config: AlertConfiguration): number {
    if (leg === 'future') return config.params.futureLevel;
    if (leg === 'call') return config.params.callLevel;
    return config.params.putLevel;
  }

  private subscribeTokens(configId: string, tokens: number[]): void {
    for (const token of tokens) {
      let set = this.tokenSubscribers.get(token);
      if (!set) {
        set = new Set();
        this.tokenSubscribers.set(token, set);
      }
      set.add(configId);
    }
    this.deps.provider.subscribe(tokens);
  }

  private async resolveActivation(config: AlertConfiguration) {
    const expiryDate =
      config.expiryDate ?? this.deps.instrumentStore.resolveExpiryDate(config.underlying, config.expiryType);
    if (!expiryDate) throw new Error(`No expiry available for ${config.underlying}`);
    const triplet = await this.deps.instrumentStore.resolveTriplet({
      underlying: config.underlying,
      expiry: expiryDate,
      strikeSelection: config.strikeSelection,
      customStrike: config.customStrike,
    });
    return { expiryDate, triplet };
  }

  /** Activate a config for live monitoring (built-in RSI or a custom strategy). */
  async activate(config: AlertConfiguration): Promise<AlertConfiguration> {
    return config.strategy === 'rsi-sync' ? this.activateBuiltin(config) : this.activateCustom(config);
  }

  private async activateBuiltin(config: AlertConfiguration): Promise<AlertConfiguration> {
    if (this.runtimes.has(config.id)) return config;
    const { expiryDate, triplet } = await this.resolveActivation(config);
    const resolvedConfig: AlertConfiguration = { ...config, expiryDate, active: true };
    this.runtimes.set(config.id, new ConfigRuntime(resolvedConfig, triplet));
    this.subscribeTokens(config.id, [triplet.future.token, triplet.call.token, triplet.put.token]);
    const saved = await this.deps.store.configs.setActive(config.id, true, expiryDate);
    log.info(
      { configId: config.id, underlying: config.underlying, strike: triplet.strike, expiry: expiryDate },
      'config activated (built-in rsi-sync)',
    );
    return saved ?? resolvedConfig;
  }

  private async activateCustom(config: AlertConfiguration): Promise<AlertConfiguration> {
    if (this.customRuntimes.has(config.id)) return config;
    const def = await this.deps.store.strategies.get(config.strategy);
    if (!def) throw new Error(`Custom strategy not found: ${config.strategy}`);
    const { expiryDate, triplet } = await this.resolveActivation(config);
    const resolvedConfig: AlertConfiguration = { ...config, expiryDate, active: true };
    const runtime = new CustomConfigRuntime(resolvedConfig, def, triplet);
    this.customRuntimes.set(config.id, runtime);
    this.subscribeTokens(config.id, runtime.tokens);
    const saved = await this.deps.store.configs.setActive(config.id, true, expiryDate);
    log.info(
      { configId: config.id, strategy: def.name, underlying: config.underlying, strike: triplet.strike },
      'config activated (custom strategy)',
    );
    return saved ?? resolvedConfig;
  }

  /** Remove a config from live monitoring and unsubscribe its now-unused tokens. */
  async deactivate(configId: string): Promise<void> {
    const tokens = this.runtimes.get(configId)?.tokens ?? this.customRuntimes.get(configId)?.tokens;
    if (tokens) {
      for (const token of tokens) {
        const set = this.tokenSubscribers.get(token);
        set?.delete(configId);
        if (set && set.size === 0) {
          this.deps.provider.unsubscribe([token]);
          this.tokenSubscribers.delete(token);
        }
      }
      this.runtimes.delete(configId);
      this.customRuntimes.delete(configId);
    }
    await this.deps.store.configs.setActive(configId, false);
    log.info({ configId }, 'config deactivated');
  }

  /** Route a tick to the config runtime(s) using its token (built-in or custom). */
  async handleTick(tick: Tick): Promise<void> {
    const subs = this.tokenSubscribers.get(tick.token);
    if (!subs) return;

    for (const configId of subs) {
      const builtin = this.runtimes.get(configId);
      if (builtin) {
        await this.handleBuiltinTick(builtin, tick);
        continue;
      }
      const custom = this.customRuntimes.get(configId);
      if (custom) await this.handleCustomTick(custom, tick);
    }
  }

  private async handleBuiltinTick(runtime: ConfigRuntime, tick: Tick): Promise<void> {
    const legRuntime = runtime.legByToken(tick.token);
    if (!legRuntime) return;
    const { closed } = legRuntime.builder.update(tick);
    if (closed) {
      const rsi = legRuntime.rsi.update(closed.close);
      runtime.recordClosedRsi(legRuntime.leg, closed.bucket, rsi);
      await this.maybeEvaluate(runtime, closed.bucket);
    }
    this.maybeBroadcastRsi(runtime, tick.timestamp);
  }

  private async handleCustomTick(runtime: CustomConfigRuntime, tick: Tick): Promise<void> {
    const found = runtime.builderFor(tick.token);
    if (!found) return;
    const { closed } = found.builder.update(tick);
    if (!closed) return;
    const bar: Bar = {
      time: Math.floor(closed.bucket / 1000),
      open: closed.open,
      high: closed.high,
      low: closed.low,
      close: closed.close,
      volume: 0,
    };
    runtime.recordBar(found.instrument, closed.bucket, bar);
    await this.maybeEvaluateCustom(runtime, closed.bucket);
  }

  private async maybeEvaluateCustom(runtime: CustomConfigRuntime, bucket: number): Promise<void> {
    if (runtime.evaluatedBuckets.has(bucket)) return;
    const bars = runtime.barsIfComplete(bucket);
    if (!bars) return;
    runtime.evaluatedBuckets.add(bucket);
    for (const inst of runtime.instruments) runtime.evaluator.update(inst, bars.get(inst)!);
    const match = runtime.evaluator.evaluate();
    if (match) {
      await this.deps.alertService.recordCustom(runtime.config, runtime.triplet, runtime.def, match, bucket);
    }
    runtime.prune(bucket);
  }

  private async maybeEvaluate(runtime: ConfigRuntime, bucket: number): Promise<void> {
    if (runtime.evaluatedBuckets.has(bucket)) return;
    const cur = runtime.rsiByBucket.get(bucket);
    if (!cur || cur.future === undefined || cur.call === undefined || cur.put === undefined) return;

    runtime.evaluatedBuckets.add(bucket);
    const prev = runtime.rsiByBucket.get(previousBucket(bucket, runtime.config.timeframe)) ?? {};

    const match = this.deps.engine.evaluate(runtime.config.strategy, {
      timeframe: runtime.config.timeframe,
      bucket,
      readings: {
        future: { prev: prev.future, curr: cur.future },
        call: { prev: prev.call, curr: cur.call },
        put: { prev: prev.put, curr: cur.put },
      },
      params: runtime.config.params,
    });

    if (match) {
      await this.deps.alertService.record(runtime.config, runtime.triplet, match);
    }
    runtime.prune(bucket);
  }

  private maybeBroadcastRsi(runtime: ConfigRuntime, now: number): void {
    if (now - runtime.lastBroadcast < RSI_BROADCAST_INTERVAL_MS) return;
    runtime.lastBroadcast = now;

    const legs = {} as RsiUpdatePayload['legs'];
    for (const leg of ['future', 'call', 'put'] as Leg[]) {
      const lr = runtime.legs[leg];
      const forming = lr.builder.current;
      const provisional = forming ? lr.rsi.peek(forming.close) : undefined;
      const rsi = provisional ?? runtime.lastClosedRsi[leg];
      legs[leg] = { rsi: rsi ?? null, level: this.levelFor(leg, runtime.config) };
    }

    this.deps.hub.broadcastRsi({
      configId: runtime.config.id,
      underlying: runtime.config.underlying,
      timeframe: runtime.config.timeframe,
      strike: runtime.triplet.strike,
      bucket: runtime.legs.future.builder.current?.bucket ?? 0,
      legs,
    });
  }

  /**
   * Simulate a scenario end-to-end: craft synthetic closes that produce the
   * requested scenario, run them through the REAL RSI + strategy engine, and
   * record the resulting alert. Used by the dev "Simulate Trigger" endpoint.
   */
  async replayScenario(configId: string, scenario: 1 | 2): Promise<boolean> {
    const runtime = this.runtimes.get(configId);
    if (!runtime) throw new Error('Config is not active; activate it before simulating.');

    const series = buildScenarioSeries(scenario, runtime.config.params);
    const readings = {} as {
      future: { prev?: number; curr: number };
      call: { prev?: number; curr: number };
      put: { prev?: number; curr: number };
    };
    for (const leg of ['future', 'call', 'put'] as Leg[]) {
      const defined = computeRsiSeries(series[leg], runtime.config.params.rsiPeriod).filter(
        (v): v is number => v !== undefined,
      );
      readings[leg] = { prev: defined[defined.length - 2], curr: defined[defined.length - 1]! };
    }

    const bucket = Date.now(); // unique per invocation so repeated sims aren't deduped
    const match = this.deps.engine.evaluate(runtime.config.strategy, {
      timeframe: runtime.config.timeframe,
      bucket,
      readings,
      params: runtime.config.params,
    });
    if (!match) throw new Error('Synthetic series did not produce a match (unexpected)');

    const alert = await this.deps.alertService.record(runtime.config, runtime.triplet, match);
    return alert !== null;
  }

  /** Snapshot of active runtimes for the dashboard/API. */
  snapshots(): ConfigRuntimeSnapshot[] {
    return [...this.runtimes.values()].map((r) => ({
      configId: r.config.id,
      underlying: r.config.underlying,
      timeframe: r.config.timeframe,
      strike: r.triplet.strike,
      expiry: r.config.expiryDate ?? '',
      legs: {
        future: { rsi: r.lastClosedRsi.future, level: this.levelFor('future', r.config) },
        call: { rsi: r.lastClosedRsi.call, level: this.levelFor('call', r.config) },
        put: { rsi: r.lastClosedRsi.put, level: this.levelFor('put', r.config) },
      },
    }));
  }

  isActive(configId: string): boolean {
    return this.runtimes.has(configId) || this.customRuntimes.has(configId);
  }
}
