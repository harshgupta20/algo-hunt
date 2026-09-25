/**
 * End-to-end scanner tests with the two Definition-of-Done strategies running
 * side by side on fixture data (real engine, universe resolver, calendar,
 * alert policy, dispatcher; in-memory store + fixture provider).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { McxInstrument, McxStrategyDefinition } from '../../src/shared/mcx';
import { validateStrategy } from '../../src/shared/mcx';
import { McxInstrumentService } from '../../src/server/mcx/data/McxInstrumentService';
import type { RawCandle } from '../../src/server/mcx/engine/candles';
import { McxScanner } from '../../src/server/mcx/scanner/McxScanner';
import { McxDryRun } from '../../src/server/mcx/debug/dryRun';
import { HeikinAshi } from '../../src/server/services/indicator/candles';
import {
  FixtureMcxProvider,
  MemoryMcxStore,
  RecordingChannels,
  TARGET,
  and,
  candlesAt,
  cond,
  field,
  future,
  ind,
  ist,
  num,
  option,
  timesEndingAt,
} from '../helpers/mcxFakes';

const D = '2026-10-07';
const NOW = ist(D, '11:00') + 30_000; // 15m 10:45 and 5m 10:55 candles just closed

// ---- instruments ------------------------------------------------------------------
const goldDec = future('GOLD', '2026-12-04');
const silverDec = future('SILVER', '2026-12-04');
const instruments: McxInstrument[] = [goldDec, silverDec, future('GOLD', '2027-02-05')];
const goldCe = new Map<number, McxInstrument>();
for (let k = 74_500; k <= 75_500; k += 100) {
  const ce = option('GOLD', '2026-10-26', k, 'CE');
  goldCe.set(k, ce);
  instruments.push(ce, option('GOLD', '2026-10-26', k, 'PE'), option('GOLD', '2026-11-24', k, 'CE'));
}
const silverPe = new Map<number, McxInstrument>();
for (const e of ['2026-10-30', '2026-11-27']) {
  for (let k = 88_000; k <= 92_000; k += 500) {
    const pe = option('SILVER', e, k, 'PE');
    if (e === '2026-11-27') silverPe.set(k, pe);
    instruments.push(pe, option('SILVER', e, k, 'CE'));
  }
}

// ---- strategies ---------------------------------------------------------------------
const S1: McxStrategyDefinition = {
  schemaVersion: 1,
  market: 'MCX',
  name: 'GOLD ATM±2 CE momentum',
  universe: {
    underlying: 'GOLD',
    reference: { expiry: { mode: 'MATCH_TARGET' } },
    target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, optionTypes: ['CE'], strikes: { mode: 'ATM_OFFSETS', offsets: [-2, -1, 0, 1, 2] } },
  },
  evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
  expression: and(
    cond(ind(TARGET('15m'), 'RSI', { period: 14 }), 'CROSSED_ABOVE', num(60)),
    cond(ind(TARGET('15m'), 'ADX', { period: 14, smoothing: 14 }), 'GT', num(25)),
    cond(field(TARGET('15m')), 'CROSSED_ABOVE', ind(TARGET('15m'), 'SMA', { period: 20 })),
  ),
  alert: { channels: { telegram: true, email: true }, trigger: 'ON_TRANSITION', cooldownMinutes: 30, oncePerCandle: true },
};

const HA5 = TARGET('5m', { type: 'HEIKIN_ASHI' });
const S2: McxStrategyDefinition = {
  schemaVersion: 1,
  market: 'MCX',
  name: 'SILVER OTM PE hammer on volume',
  universe: {
    underlying: 'SILVER',
    reference: { expiry: { mode: 'MATCH_TARGET' } },
    target: { kind: 'OPTION', expiry: { mode: 'SPECIFIC', date: '2026-11-27' }, optionTypes: ['PE'], strikes: { mode: 'OTM', count: 2 } },
  },
  evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '5m' },
  expression: and(cond(field(HA5, 'volume'), 'GT', ind(HA5, 'SMA', { period: 20 }, { source: 'volume' })), { type: 'PATTERN', id: 'p1', series: HA5, pattern: 'HAMMER' }),
  alert: { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION', cooldownMinutes: null, oncePerCandle: true },
};

// ---- candle fixtures ------------------------------------------------------------------
/** Uptrend, 4-candle pullback, then a jump: RSI crosses 60, close crosses SMA(20), ADX ≫ 25 — all on the last candle only. */
function momentumCloses(finalJump: number): number[] {
  const closes: number[] = [];
  let p = 300;
  for (let i = 0; i < 60; i++) closes.push((p += i % 3 === 0 ? 1 : 2.5));
  for (let i = 0; i < 4; i++) closes.push((p -= 6));
  closes.push(p + finalJump);
  return closes;
}
const t15 = timesEndingAt(ist(D, '10:45'), 15, 65);

/** Downtrend on 5m, final raw candle shaped so its Heikin Ashi candle is a hammer, with a volume spike. */
function hammerCandles(withHammer: boolean): RawCandle[] {
  const times = timesEndingAt(ist(D, '10:55'), 5, 40);
  const closes = Array.from({ length: 39 }, (_, i) => 1000 - i * 4);
  const raw = candlesAt(times.slice(0, 39), closes, { volume: 100 });
  const ha = new HeikinAshi();
  let last = { open: 0, close: 0 };
  for (const c of raw) last = ha.next(c);
  const hO = (last.open + last.close) / 2;
  const final: RawCandle = withHammer
    ? { time: times[39]! / 1000, open: hO - 0.6, high: hO - 0.5, low: hO - 30, close: hO - 0.9, volume: 1000, oi: 5 }
    : { time: times[39]! / 1000, open: closes[38]!, high: closes[38]! + 1, low: closes[38]! - 5, close: closes[38]! - 4, volume: 1000, oi: 5 };
  return [...raw, final];
}

function setup() {
  const clock = { now: NOW };
  const store = new MemoryMcxStore(() => clock.now);
  const provider = new FixtureMcxProvider(instruments);
  provider.ltp.set(goldDec.token, 75_040); // ATM 75000 → 74800 … 75200 CE
  provider.ltp.set(silverDec.token, 90_100); // ATM 90000 → OTM PE 89500, 89000
  for (const [k, ce] of goldCe) provider.set(ce, '15m', candlesAt(t15, momentumCloses(k === 75_100 ? 14 : 5), { spread: 0.5 }));
  for (const [k, pe] of silverPe) provider.set(pe, '5m', hammerCandles(k === 89_500));
  const channels = new RecordingChannels();
  const instrumentService = new McxInstrumentService(store, provider);
  const scanner = new McxScanner({ store, provider, instruments: instrumentService, channels, clock: () => clock.now });
  return { clock, store, provider, channels, scanner, instrumentService };
}

async function enable(store: MemoryMcxStore, d: McxStrategyDefinition, at = ist(D, '09:30')) {
  const s = await store.strategies.create(d);
  await store.strategies.setEnabled(s.id, true, new Date(at).toISOString());
  return s;
}

describe('MCX V2 scanner — Definition of Done', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it('both DoD strategies validate against the catalog', () => {
    expect(validateStrategy(S1, { syncedProducts: ['GOLD', 'SILVER'], channelsConfigured: { telegram: true, email: true }, forEnable: true }).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateStrategy(S2, { syncedProducts: ['GOLD', 'SILVER'], channelsConfigured: { telegram: true, email: false }, forEnable: true }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('strategy #1 alerts exactly one GOLD CE strike on Telegram + Email; strategy #2 independently alerts one SILVER OTM PE', async () => {
    const s1 = await enable(env.store, S1);
    const s2 = await enable(env.store, S2);
    const { run } = await env.scanner.runLocked();

    expect(run.status).toBe('OK');
    expect(run.errors).toEqual([]);
    expect(run.units).toBe(7); // 5 CE + 2 PE
    expect(run.unitsEvaluated).toBe(7);
    expect(run.seriesFetched).toBe(7);
    expect(env.provider.calls.ltp).toBe(1); // one batched LTP call for both reference futures

    const alerts = env.store.data.alerts;
    expect(alerts.map((a) => [a.strategyId, a.instrument.symbol]).sort()).toEqual(
      [
        [s1.id, goldCe.get(75_100)!.symbol],
        [s2.id, silverPe.get(89_500)!.symbol],
      ].sort(),
    );
    const a1 = alerts.find((a) => a.strategyId === s1.id)!;
    expect(a1).toMatchObject({ status: 'SENT', version: 1, triggerTimeframe: '15m', candleTime: ist(D, '10:45') / 1000 });
    expect(a1.deliveries.map((d) => d.channel).sort()).toEqual(['email', 'telegram']);
    expect(a1.evaluation.trace.children!.map((c) => c.result)).toEqual(['TRUE', 'TRUE', 'TRUE']);
    expect(a1.evaluation.reference?.id).toBe(goldDec.id);
    const a2 = alerts.find((a) => a.strategyId === s2.id)!;
    expect(a2.deliveries.map((d) => d.channel)).toEqual(['telegram']);
    expect(a2.candleTime).toBe(ist(D, '10:55') / 1000);

    expect(env.channels.sent.map((m) => m.channel).sort()).toEqual(['email', 'telegram', 'telegram']);
    expect(env.channels.sent[0]!.message.text).toMatch(/MCX · /);

    // Unit states: the alerted strike is TRIGGERED with a 30 min cooldown; the others stay IDLE with an explanation.
    const u = await env.store.units.get(s1.id, goldCe.get(75_100)!.id);
    expect(u?.state).toBe('TRIGGERED');
    expect(Date.parse(u!.cooldownUntil!) - NOW).toBe(30 * 60_000);
    const idle = await env.store.units.get(s1.id, goldCe.get(75_000)!.id);
    expect(idle).toMatchObject({ state: 'IDLE', lastResult: 'FALSE' });
    expect(idle?.lastEvaluation?.trace.children![2]!.condition!.result).toBe('FALSE'); // close stayed below SMA(20)
  });

  it('does not re-fetch, re-evaluate or re-alert a candle it already evaluated', async () => {
    await enable(env.store, S1);
    await env.scanner.run();
    expect(env.store.data.alerts).toHaveLength(1);
    const before = env.provider.calls.historical;

    env.clock.now = NOW + 60_000;
    const again = await env.scanner.run();
    expect(again.run.notes.join()).toMatch(/already evaluated/);
    expect(env.provider.calls.historical).toBe(before); // no fetch at all
    expect(env.store.data.alerts).toHaveLength(1);
  });

  it('dedupes by signal identity even if unit state was lost', async () => {
    const s1 = await enable(env.store, S1);
    await env.scanner.run();
    await env.store.units.clear(s1.id);
    env.clock.now = NOW + 60_000;
    await env.scanner.run();
    expect(env.store.data.alerts).toHaveLength(1);
    expect(env.store.data.signals).toHaveLength(1);
  });

  it('never alerts for candles that closed before the strategy was enabled', async () => {
    await enable(env.store, S1, ist(D, '11:00') + 10_000);
    await env.scanner.run();
    expect(env.store.data.alerts).toHaveLength(0);
    expect(env.store.data.signals.map((s) => s.outcome)).toEqual(['SUPPRESSED_BEFORE_ENABLE']);
  });

  it('isolates failures: a broken series only affects its unit', async () => {
    const s1 = await enable(env.store, S1);
    await enable(env.store, S2);
    env.provider.failTokens.add(goldCe.get(75_000)!.token);
    const { run } = await env.scanner.run();
    expect(run.status).toBe('PARTIAL');
    expect(run.errors.map((e) => e.source)).toEqual(['candles']);
    expect(env.store.data.alerts).toHaveLength(2);
    const broken = await env.store.units.get(s1.id, goldCe.get(75_000)!.id);
    expect(broken?.lastResult).toBe('UNKNOWN');
    expect(broken?.lastEvaluation?.trace.children![0]!.condition!.reason).toMatch(/data fetch failed/);
  });

  it('records a failed channel without blocking the other one', async () => {
    await enable(env.store, S1);
    env.channels.fail.add('email');
    const { run } = await env.scanner.run();
    const a = env.store.data.alerts[0]!;
    expect(a.status).toBe('PARTIAL');
    expect(a.deliveries.find((d) => d.channel === 'email')).toMatchObject({ status: 'failed', error: 'email down' });
    expect(run.errors.map((e) => e.source)).toEqual(['delivery:email']);
  });

  it('respects the request budget and defers the remaining units', async () => {
    await enable(env.store, S1);
    await env.store.settings.save({ ...(await env.store.settings.get()), requestBudget: 3 });
    const { run } = await env.scanner.run();
    expect(run.seriesFetched).toBe(3);
    expect(run.unitsEvaluated).toBe(3);
    expect(run.errors[0]).toMatchObject({ source: 'budget' });
    // Next cycle picks up the deferred units.
    env.clock.now = NOW + 60_000;
    await env.store.settings.save({ ...(await env.store.settings.get()), requestBudget: 150 });
    const next = await env.scanner.run();
    expect(next.run.unitsEvaluated).toBe(2);
    expect(env.store.data.alerts).toHaveLength(1);
  });

  it('skips when the market is closed, when nothing is enabled, and when another scan holds the lease', async () => {
    env.clock.now = ist('2026-10-10', '12:00'); // Saturday
    expect((await env.scanner.runLocked()).skipped).toBe('market-closed');
    env.clock.now = NOW;
    expect((await env.scanner.runLocked()).skipped).toBe('no-strategies');
    await env.store.locks.acquire('mcx-v2-scan', 240, 0);
    expect((await env.scanner.runLocked()).skipped).toBe('busy');
  });

  it('explains every unit without persisting and replays past candles', async () => {
    const s1 = await enable(env.store, S1);
    const dry = new McxDryRun({ store: env.store, provider: env.provider, instruments: env.instrumentService, clock: () => env.clock.now });
    await env.instrumentService.sync();
    const ex = await dry.explain(s1);
    expect(ex.units).toHaveLength(5);
    expect(ex.units.find((u) => u.target.strike === 75_100)).toMatchObject({ outcome: 'ALERTED', prevResult: 'FALSE' });
    expect(ex.units.filter((u) => u.outcome).length).toBe(1);
    expect(env.store.data.alerts).toHaveLength(0);
    expect(env.store.data.units.size).toBe(0);

    const rp = await dry.replay(s1, { from: '2026-10-05', to: D, targetIds: [goldCe.get(75_100)!.id] });
    const signals = rp.units[0]!.rows.filter((r) => r.outcome);
    expect(signals.map((r) => r.candleTime)).toEqual([ist(D, '10:45') / 1000]);
    expect(signals[0]!.trace).toBeDefined();
  });
});
