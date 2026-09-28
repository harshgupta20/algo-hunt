/**
 * V2 live worker (streaming): Kite tick parsing, live candle building, the
 * "check against Kite's candles" rule, subscription planning, the fetch queue,
 * and end to end — ticks in, a candle closes, the result is decided live or
 * confirmed on Kite's candles, and the alert says which.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExprTrace, LiveSocketStatus, StrategyDefinition, UnitEvaluation, V2Connection, V2Strategy } from '../../src/shared/v2';
import { calendars } from '../../src/server/v2/calendar/MarketCalendar';
import type { RawCandle } from '../../src/server/v2/engine/candles';
import { ProductService } from '../../src/server/v2/data/ProductService';
import { FetchQueue } from '../../src/server/v2/live/FetchQueue';
import { KiteStream, type SocketLike, type StreamCredentials, type StreamEvents, type TickStream } from '../../src/server/v2/live/KiteStream';
import { LiveCandles } from '../../src/server/v2/live/LiveCandles';
import { CONFIRM_DEADLINE_MS, LiveWorker } from '../../src/server/v2/live/LiveWorker';
import { planSubscriptions } from '../../src/server/v2/live/plan';
import { encodePackets, fullPacket, indexPacket, parseTicks } from '../../src/server/v2/live/ticks';
import { checkReason } from '../../src/server/v2/live/verify';
import { V2Service } from '../../src/server/v2/V2Service';
import { FixtureV2Provider, MemoryV2Store, NSE_SESSION, RecordingChannels, and, candlesAt, cond, config, field, fut, ind, ist, ladder, legSeries, num, productsOf, spot, strategy, timesEndingAt } from '../helpers/v2Fakes';

const D = '2026-10-07';
const IST = 330 * 60_000;
const at = (hms: string, date = D) => Date.parse(`${date}T${hms}Z`) - IST;

describe('Kite tick packets', () => {
  it('parses full-mode tradable and index packets; ignores heartbeats', () => {
    const FO = (5000 << 8) | 2; // NFO segment
    const t = ist(D, '10:00');
    const msg = encodePackets([
      fullPacket({ token: FO, price: 25_123.45, volume: 1_500, tradeTime: t + 12_000, exchangeTime: t + 13_000, oi: 900, dayOpen: 25_000 }),
      indexPacket({ token: 256_265, price: 25_010.5, exchangeTime: t + 13_000 }),
    ]);
    expect(parseTicks(msg)).toEqual([
      { token: FO, price: 25_123.45, volume: 1_500, oi: 900, tradeTime: t + 12_000, exchangeTime: t + 13_000, dayOpen: 25_000, index: false },
      { token: 256_265, price: 25_010.5, exchangeTime: t + 13_000, dayOpen: 25_010.5, index: true },
    ]);
    expect(parseTicks(new ArrayBuffer(1))).toEqual([]);
  });
});

describe('Kite stream sockets', () => {
  afterEach(() => vi.useRealTimers());

  class FakeSocket implements SocketLike {
    binaryType = '';
    readyState = 0;
    sent: unknown[] = [];
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    constructor(readonly url: string) {}
    send(d: string) {
      this.sent.push(JSON.parse(d));
    }
    close() {
      this.readyState = 3;
    }
    open() {
      this.readyState = 1;
      this.onopen?.({});
    }
  }

  it('subscribes in full mode on open, emits ticks, and reports + recovers from a drop', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const log: string[] = [];
    const stream = new KiteStream((url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    });
    stream.start({ apiKey: 'k', accessToken: 't' }, { ticks: (t) => log.push(`ticks:${t.map((x) => x.price).join()}`), observing: (tk) => log.push(`observing:${tk.join()}`), lost: (tk) => log.push(`lost:${tk.join()}`) });
    stream.setTokens([11, 12]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe('wss://ws.kite.trade?api_key=k&access_token=t');
    sockets[0]!.open();
    expect(sockets[0]!.sent).toEqual([{ a: 'subscribe', v: [11, 12] }, { a: 'mode', v: ['full', [11, 12]] }]);
    sockets[0]!.onmessage!({ data: encodePackets([fullPacket({ token: 11, price: 101.5, volume: 10, tradeTime: 1e12, exchangeTime: 1e12 })]) });
    sockets[0]!.onclose!({});
    expect(log).toEqual(['observing:11,12', 'ticks:101.5', 'lost:11,12']);
    expect(stream.status()[0]).toMatchObject({ state: 'CLOSED', reconnects: 1 });
    vi.advanceTimersByTime(1_000); // backoff, then a fresh socket that resubscribes everything
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent[0]).toEqual({ a: 'subscribe', v: [11, 12] });
    expect(log.at(-1)).toBe('observing:11,12');
    stream.setTokens([12, 13]);
    expect(sockets[1]!.sent.slice(-3)).toEqual([{ a: 'unsubscribe', v: [11] }, { a: 'subscribe', v: [13] }, { a: 'mode', v: ['full', [13]] }]);
    stream.stop();
  });
});

describe('live candles', () => {
  const T = 777;
  const make = () => {
    const lc = new LiveCandles(calendars([]));
    lc.track(T, 'NSE', false);
    lc.observing([T], at('09:10:00'));
    lc.applyOfficial(T, '1m', [], at('09:10:00'));
    lc.applyOfficial(T, '5m', [], at('09:10:00'));
    return lc;
  };
  const tick = (lc: LiveCandles, hms: string, price: number, volume: number) => lc.ingest({ token: T, price, volume, tradeTime: at(hms), exchangeTime: at(hms), dayOpen: 100, index: false }, at(hms) + 300);

  it('builds minutes like Kite: trade-time buckets, session only, day open, volume from the day total', () => {
    const lc = make();
    tick(lc, '09:08:00', 99, 50); // pre-open trade: no candle, but its volume counts in the first candle (as in Kite's day total)
    tick(lc, '09:15:05', 101, 80);
    tick(lc, '09:15:40', 102, 120);
    tick(lc, '09:16:10', 101.5, 150);
    lc.finalize(at('09:17:01'));
    expect(lc.view(T, '1m', at('09:17:00')).candles).toEqual([{ time: at('09:15:00') / 1000, open: 100, high: 102, low: 100, close: 102, volume: 120 }]);
    lc.finalize(at('09:17:03'));
    const v = lc.view(T, '1m', at('09:17:00'));
    expect(v.candles.at(-1)).toEqual({ time: at('09:16:00') / 1000, open: 101.5, high: 101.5, low: 101.5, close: 101.5, volume: 30 });
    expect(v.dirty).toBe(false);
    // A trade stamped in a minute that's already closed makes that minute suspect.
    tick(lc, '09:16:50', 101, 160);
    expect(lc.late).toBe(1);
    expect(lc.view(T, '1m', at('09:18:00')).dirty).toBe(true);
  });

  it('aggregates to the interval, and data from before the subscription is dirty', () => {
    const lc = new LiveCandles(calendars([]));
    lc.track(T, 'NSE', false);
    lc.applyOfficial(T, '5m', [], at('10:01:00'));
    lc.observing([T], at('10:01:30')); // joined mid-candle
    for (const [hms, p, v] of [['10:01:40', 200, 10], ['10:02:10', 201, 20], ['10:04:30', 199, 30], ['10:06:10', 202, 40]] as const) tick(lc, hms, p, v);
    lc.finalize(at('10:10:00'));
    const v = lc.view(T, '5m', at('10:05:00'));
    expect(v.candles.map((c) => [c.time, c.close])).toEqual([
      [at('10:00:00') / 1000, 199],
      [at('10:05:00') / 1000, 202],
    ]);
    expect(v.dirty).toBe(true); // 10:00–10:05 wasn't fully observed
    expect(lc.view(T, '5m', at('10:10:00')).dirty).toBe(true);
    // Kite's candle replaces it — then only fully observed live periods remain.
    lc.applyOfficial(T, '5m', [{ time: at('10:00:00') / 1000, open: 198, high: 203, low: 197, close: 199, volume: 90 }], at('10:05:04'));
    const after = lc.view(T, '5m', at('10:10:00'));
    expect(after.dirty).toBe(false);
    expect(after.candles[0]).toMatchObject({ open: 198, high: 203, volume: 90 });
  });

  it("doesn't trust Kite's data past a period it is still missing (Kite catching up)", () => {
    const lc = make();
    tick(lc, '09:15:30', 101, 10);
    tick(lc, '09:19:30', 103, 20);
    lc.finalize(at('09:20:03'));
    lc.applyOfficial(T, '5m', [], at('09:20:04')); // Kite hasn't got the 09:15 candle yet
    expect(lc.officialUntil(T, '5m')).toBeLessThan(at('09:20:00'));
    lc.applyOfficial(T, '5m', [{ time: at('09:15:00') / 1000, open: 100, high: 103, low: 100, close: 103, volume: 20 }], at('09:20:09'));
    expect(lc.officialUntil(T, '5m')).toBe(at('09:20:00'));
  });
});

describe('when a live result is re-checked on Kite candles', () => {
  const c1 = cond(field(legSeries('A', '5m')), 'GT', num(100));
  const c2 = cond(ind(legSeries('A', '5m'), 'RSI', { period: 14 }), 'GT', num(60));
  const root = and(c1, c2);
  const d = strategy([{ id: 'A', kind: 'FUT' }], root, '5m');
  const leaf = (n: typeof c1, value: number, level: number): ExprTrace => {
    const result = value > level ? 'TRUE' : 'FALSE';
    return { id: n.id, type: 'CONDITION', result, condition: { id: n.id, kind: 'CONDITION', text: '', result, operator: 'GT', left: { label: 'x', value }, right: { label: 'y', value: level } } };
  };
  const ev = (close: number, rsi: number): UnitEvaluation => {
    const children = [leaf(c1, close, 100), leaf(c2, rsi, 60)];
    const result = children.every((c) => c.result === 'TRUE') ? 'TRUE' : 'FALSE';
    return { result, trace: { id: root.id, type: 'AND', result, children } } as UnitEvaluation;
  };

  it('always checks alerts, gaps, and close calls that could change the result — nothing else', () => {
    expect(checkReason(d, ev(101, 70), false)).toBe('TRUE');
    expect(checkReason(d, ev(90, 70), true)).toBe('GAP');
    expect(checkReason(d, ev(99.9, 70), false)).toBe('NEAR'); // price within 0.25 % and it decides the result
    expect(checkReason(d, ev(101, 59.5), false)).toBe('NEAR'); // RSI within 1 point
    expect(checkReason(d, ev(99.9, 40), false)).toBeNull(); // near, but RSI 40 keeps it false anyway
    expect(checkReason(d, ev(90, 70), false)).toBeNull(); // clearly false
  });
});

describe('subscription plan', () => {
  const nSpot = spot('NSE:NIFTY', 'NIFTY 50');
  const nFut = fut('NSE:NIFTY', '2026-10-27');
  const nOpts = ladder('NSE:NIFTY', '2026-10-13', 24_800, 25_200, 50);
  const all = [nSpot, nFut, ...nOpts];
  const product = productsOf(all).find((p) => p.id === 'NSE:NIFTY')!;
  const d: StrategyDefinition = strategy(
    [
      { id: 'A', kind: 'FUT' },
      { id: 'B', kind: 'CE', strikeOffset: 0 },
      { id: 'C', kind: 'PE', strikeOffset: 0 },
    ],
    and(cond(field(legSeries('A', '5m')), 'GT', num(1)), cond(field(legSeries('B', '5m')), 'GT', num(1)), cond(field(legSeries('C', '5m')), 'GT', num(1))),
    '5m',
  );
  const connection: V2Connection = { id: 'c1', strategyId: 's1', productId: 'NSE:NIFTY', config: config(), enabled: true, enabledAt: null, createdAt: '', updatedAt: '' };
  const strat = { id: 's1', name: 'x', version: 1, definition: d } as V2Strategy;
  const list = [{ connection, strategy: strat, product, instruments: all }];
  const strikes = (p: ReturnType<typeof planSubscriptions>, needed: boolean) =>
    [...p.instruments.values()].filter((x) => x.needed === needed && x.instrument.strike).map((x) => `${x.instrument.kind}${x.instrument.strike}`).sort();

  it('streams the legs at ATM plus two strikes either side, and the ATM reference', () => {
    const p = planSubscriptions(list, (t) => (t === nSpot.token ? 25_010 : undefined), D);
    expect(strikes(p, true)).toEqual(['CE25000', 'PE25000']);
    expect(strikes(p, false)).toEqual(['CE24900', 'CE24950', 'CE25050', 'CE25100', 'PE24900', 'PE24950', 'PE25050', 'PE25100']);
    expect(p.instruments.get(nSpot.token)).toMatchObject({ needed: true });
    expect(p.instruments.get(nFut.token)?.intervals).toEqual(new Set(['5m']));
    expect([p.needed, p.buffer, p.covered, p.uncovered]).toEqual([4, 8, ['c1'], []]);
  });

  it('drops buffer strikes before needed contracts, then leaves connections to the backup scanner', () => {
    const tight = planSubscriptions(list, () => 25_010, D, { capacity: 10 });
    expect([tight.needed, tight.buffer, tight.overCapacity]).toEqual([4, 6, 2]);
    const full = planSubscriptions(list, () => 25_010, D, { capacity: 3 });
    expect([full.covered, full.uncovered, full.instruments.size]).toEqual([[], ['c1'], 0]);
    expect(planSubscriptions(list, () => undefined, D).waitingForPrice).toEqual(['c1']);
  });
});

describe('fetch queue', () => {
  it('runs confirmations first, shares identical requests and moves them up', async () => {
    const q = new FetchQueue(1);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    void q.run(3, 'a', async () => {
      await gate;
      order.push('a');
    });
    void q.run(2, 'b', async () => order.push('b'));
    void q.run(0, 'c', async () => order.push('c'));
    const d1 = q.run(2, 'd', async () => (order.push('d'), 1));
    const d2 = q.run(0, 'd', async () => 2);
    release();
    await q.idle();
    expect(order).toEqual(['a', 'c', 'd', 'b']);
    expect([await d1, await d2]).toEqual([1, 1]);
  });
});

// ---- end to end ------------------------------------------------------------------------------

class FakeStream implements TickStream {
  tokens: number[] = [];
  creds: StreamCredentials | null = null;
  events: StreamEvents | null = null;
  constructor(private readonly now: () => number) {}
  start(c: StreamCredentials, e: StreamEvents) {
    this.creds = c;
    this.events = e;
  }
  stop() {
    this.creds = null;
  }
  setTokens(list: number[]) {
    const fresh = list.filter((t) => !this.tokens.includes(t));
    this.tokens = list;
    if (fresh.length) this.events?.observing(fresh, this.now());
  }
  status(): LiveSocketStatus[] {
    return this.creds ? [{ id: 1, state: 'OPEN', tokens: this.tokens.length, lastMessageAt: null, reconnects: 0 }] : [];
  }
}

const nSpot = spot('NSE:NIFTY', 'NIFTY 50');
const nFut = fut('NSE:NIFTY', '2026-10-27');
const MINUTES = ['09:15', '09:16', '09:17', '09:18', '09:19'];

/** Future's 5-min close vs a level (the 09:15–09:20 candle is the first of the day). */
async function liveEnv(o: { close: number; level: number; officialClose?: number; failToday?: boolean; gap?: boolean; paper?: boolean }) {
  let t = at('09:05:00');
  const store = new MemoryV2Store(() => t);
  const provider = new FixtureV2Provider([nSpot, nFut]);
  const prices = [25_100, 25_102, 25_104, 25_106, o.close];
  const history = candlesAt(timesEndingAt(ist('2026-10-06', '15:25'), 5, 80, NSE_SESSION), Array.from({ length: 80 }, (_, i) => 25_000 + i * 0.1));
  const officialClose = o.officialClose ?? o.close;
  const first: RawCandle = { time: ist(D, '09:15') / 1000, open: 25_100, high: Math.max(25_106, officialClose), low: 25_100, close: officialClose, volume: 500 };
  provider.set(nFut, '5m', [...history, first]);
  const channels = new RecordingChannels();
  const products = new ProductService(store, provider);
  const svc = new V2Service({ store, provider, products, channels, clock: () => t });
  await svc.syncProducts();
  const s = await svc.createStrategy({ ...strategy([{ id: 'A', kind: 'FUT' }], cond(field(legSeries('A', '5m')), 'GT', num(o.level)), '5m'), name: 'Future above level' });
  const [c] = await svc.createConnections(s.id, ['NSE:NIFTY'], config());
  await svc.enableConnection(c!.id);
  if (o.paper) await svc.savePaperPlan(s.id, { ...(await svc.paperPlan(s.id)), enabled: true });

  const stream = new FakeStream(() => t);
  const worker = new LiveWorker({
    store,
    provider,
    products,
    channels,
    stream,
    session: { credentials: async () => ({ apiKey: 'key', accessToken: 'token' }) },
    clock: () => t,
    sleep: async (ms) => void (t += ms),
    workerId: 'w1',
  });
  const step = async (hms: string) => {
    t = Math.max(t, at(hms));
    await worker.step(t);
    await worker.idle();
  };

  await step('09:10:00'); // before the open: subscribe + warm up
  const warmupCalls = provider.calls.historical;
  MINUTES.forEach((m, i) => {
    if (o.gap && m === '09:17') {
      worker.events.lost([nFut.token], at('09:17:10'));
      worker.events.observing([nFut.token], at('09:18:10'));
      return;
    }
    if (o.failToday && i === 0) provider.failTokens.add(nFut.token);
    const tt = at(`${m}:30`);
    worker.events.ticks([{ token: nFut.token, price: prices[i]!, volume: 100 * (i + 1), tradeTime: tt, exchangeTime: tt, dayOpen: 25_100, index: false }], tt + 200);
  });
  await step('09:20:02.500');
  const state = await store.units.get(c!.id, 'FUT|2026-10-27');
  return { store, provider, channels, worker, svc, stream, state, warmupCalls, conn: c!, t: () => t, step };
}

describe('live worker end to end', () => {
  it('decides a clearly false result on live candles at the close — no extra Kite request', async () => {
    const e = await liveEnv({ close: 25_110, level: 25_300 });
    expect(e.state).toMatchObject({ lastResult: 'FALSE', lastEvaluatedCandle: ist(D, '09:15') / 1000 });
    expect(e.state?.lastEvaluation?.source).toBe('LIVE');
    expect(e.provider.calls.historical).toBe(e.warmupCalls);
    expect(e.store.data.alerts).toHaveLength(0);
    const s = e.worker.status();
    expect(s.state).toBe('LIVE');
    expect(s.lastCandles[0]).toMatchObject({ timeframe: '5m', units: 1, checked: 0, corrected: 0 });
    expect(s.lastCandles[0]!.evaluatedMs).toBeLessThan(5_000);
  });

  it('alerts only after Kite candles confirm — and says so', async () => {
    const e = await liveEnv({ close: 25_160, level: 25_150 });
    expect(e.store.data.alerts).toHaveLength(1);
    expect(e.store.data.alerts[0]!.evaluation.source).toBe('LIVE_VERIFIED');
    expect(e.channels.sent[0]!.message.text).toMatch(/Future above level[\s\S]*5 min candle[\s\S]*✓ Verified on Kite candles/);
    expect(e.provider.calls.historical).toBe(e.warmupCalls + 1);
    expect(e.worker.status().lastCandles[0]).toMatchObject({ checked: 1, corrected: 0, unverified: 0, alerts: 1 });
  });

  it("drops a live 'true' that Kite's candle doesn't confirm", async () => {
    const e = await liveEnv({ close: 25_160, level: 25_150, officialClose: 25_140 });
    expect(e.store.data.alerts).toHaveLength(0);
    expect(e.state).toMatchObject({ lastResult: 'FALSE' });
    expect(e.state?.lastEvaluation?.source).toBe('LIVE_VERIFIED');
    expect(e.worker.status().today).toMatchObject({ checked: 1, corrected: 1 });
  });

  it('re-checks a near miss that matters, and alerts when Kite says it crossed', async () => {
    const e = await liveEnv({ close: 25_140, level: 25_150, officialClose: 25_160 });
    expect(e.store.data.alerts).toHaveLength(1);
    expect(e.store.data.alerts[0]!.evaluation.source).toBe('LIVE_VERIFIED');
    expect(e.worker.status().today).toMatchObject({ checked: 1, corrected: 1, alerts: 1 });
  });

  it('re-checks when the stream had a gap', async () => {
    const e = await liveEnv({ close: 25_110, level: 25_300, gap: true });
    expect(e.provider.calls.historical).toBeGreaterThan(e.warmupCalls);
    expect(e.state?.lastEvaluation?.source).toBe('LIVE_VERIFIED');
    expect(e.store.data.alerts).toHaveLength(0);
  });

  it("still alerts when Kite's candles never arrive — marked unverified", async () => {
    const e = await liveEnv({ close: 25_160, level: 25_150, failToday: true });
    expect(e.store.data.alerts).toHaveLength(1);
    expect(e.store.data.alerts[0]!.evaluation.source).toBe('LIVE_UNVERIFIED');
    expect(e.channels.sent[0]!.message.text).toMatch(/Not verified/);
    expect(e.t()).toBeGreaterThanOrEqual(at('09:20:00') + CONFIRM_DEADLINE_MS);
  });

  it('a live alert opens a paper trade at the streamed price; a tick through the stop closes it at once', async () => {
    const e = await liveEnv({ close: 25_160, level: 25_150, paper: true });
    const [open] = e.store.data.paperTrades;
    // ₹10,000 against ≈12 % margin on ₹25,286 a unit → 3 units (lot size 1 in this fixture).
    expect(open).toMatchObject({ status: 'OPEN', side: 'BUY', leg: 'A', entryRef: 25_160, entryPrice: 25_285.8, quantity: 3, marginEstimated: true, stopPrice: 22_757.2 });
    expect(e.channels.sent[0]!.message.text).toMatch(/✓ Verified[\s\S]*📄 Paper: BUY 3 NIFTY20261027FUT @ ₹25,285\.8 · target ₹30,342\.95 · stop ₹22,757\.2/);
    await e.step('09:21:00'); // the worker starts watching the new trade
    const tt = e.t() + 500;
    e.worker.events.ticks([{ token: nFut.token, price: 22_700, volume: 900, tradeTime: tt, exchangeTime: tt, dayOpen: 25_100, index: false }], tt + 100);
    await e.worker.idle();
    expect(e.store.data.paperTrades[0]).toMatchObject({ status: 'CLOSED', exitReason: 'STOP', exitPrice: 22_586.5 }); // 22,700 − 0.5 %
  });

  it('the cron scanner steps aside while the worker streams, and warns once if it dies', async () => {
    const e = await liveEnv({ close: 25_110, level: 25_300 });
    const covering = await e.svc.scan();
    expect(covering.skipped).toBe('live-worker');

    // The worker stops heart-beating without a clean stop (crash / sleep).
    const row = (await e.store.live.get())!;
    e.store.data.live = { ...row, status: { ...row.status, heartbeatAt: new Date(at('09:20:00')).toISOString() } };
    const svc = new V2Service({ store: e.store, provider: e.provider, products: new ProductService(e.store, e.provider), channels: e.channels, clock: () => at('09:24:00') });
    const backup = await svc.scan({ force: false });
    expect(backup.skipped).toBeUndefined();
    expect(e.channels.sent.map((m) => m.message.text).join()).toMatch(/live worker is offline \(last seen 09:20 IST\)/);
    await e.store.locks.release('v2-scan');
    const svc2 = new V2Service({ store: e.store, provider: e.provider, products: new ProductService(e.store, e.provider), channels: e.channels, clock: () => at('09:25:00') });
    await svc2.scan();
    expect(e.channels.sent.filter((m) => /offline/.test(m.message.text))).toHaveLength(1);
  });

  it('refuses to start next to another running worker', async () => {
    const e = await liveEnv({ close: 25_110, level: 25_300 });
    const other = new LiveWorker({
      store: e.store,
      provider: e.provider,
      products: new ProductService(e.store, e.provider),
      channels: e.channels,
      stream: new FakeStream(() => e.t()),
      session: { credentials: async () => null },
      clock: () => e.t(),
      workerId: 'w2',
    });
    await expect(other.start()).rejects.toThrow(/Another live worker is running/);
  });
});
