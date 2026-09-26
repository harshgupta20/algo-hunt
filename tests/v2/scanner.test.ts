/**
 * End to end: one product-agnostic strategy (FUT vs CE comparison) connected to
 * NSE indices and an MCX commodity — live scanning, market gating, dedupe,
 * compatibility checks, explain and compare (real engine; in-memory store and
 * fixture data provider).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { StrategyDefinition } from '../../src/shared/v2';
import { V2Service, V2ServiceError } from '../../src/server/v2/V2Service';
import { ProductService } from '../../src/server/v2/data/ProductService';
import {
  FixtureV2Provider,
  MCX_SESSION,
  MemoryV2Store,
  NSE_SESSION,
  RecordingChannels,
  and,
  candlesAt,
  cond,
  config,
  field,
  fut,
  ind,
  ist,
  ladder,
  legSeries,
  momentumCloses,
  num,
  spot,
  strategy,
  timesEndingAt,
} from '../helpers/v2Fakes';

const D = '2026-10-07';
const NOW = ist(D, '11:00') + 30_000; // the 10:45–11:00 candle just closed in both sessions

const niftySpot = spot('NSE:NIFTY', 'NIFTY 50');
const niftyFut = fut('NSE:NIFTY', '2026-10-27');
const niftyOpts = ladder('NSE:NIFTY', '2026-10-13', 24_800, 25_200, 50);
const bankSpot = spot('NSE:BANKNIFTY', 'NIFTY BANK');
const bankFut = fut('NSE:BANKNIFTY', '2026-10-27');
const bankOpts = ladder('NSE:BANKNIFTY', '2026-10-13', 55_800, 56_200, 100);
const goldFut = fut('MCX:GOLD', '2026-12-04', 'MCX');
const goldOpts = ladder('MCX:GOLD', '2026-10-26', 74_500, 75_500, 100, 'MCX');
const itc = spot('NSE:ITC', 'ITC');
const ALL = [niftySpot, niftyFut, ...niftyOpts, bankSpot, bankFut, ...bankOpts, goldFut, ...goldOpts, itc];
const ce = (list: typeof niftyOpts, strike: number) => list.find((o) => o.kind === 'CE' && o.strike === strike)!;

/** Product-agnostic: the future must be stronger than the ATM call, and the call's RSI must cross above 60. */
const S: StrategyDefinition = {
  ...strategy(
    [
      { id: 'A', kind: 'FUT' },
      { id: 'B', kind: 'CE', strikeOffset: 0 },
    ],
    and(cond(ind(legSeries('A'), 'RSI', { period: 14 }), 'GT', ind(legSeries('B'), 'RSI', { period: 14 })), cond(ind(legSeries('B'), 'RSI', { period: 14 }), 'CROSSED_ABOVE', num(60))),
  ),
  name: 'Future leads the call',
};

function setup() {
  const clock = { now: NOW };
  const store = new MemoryV2Store(() => clock.now);
  const provider = new FixtureV2Provider(ALL, { ITC: 'ITC LTD' });
  const nse15 = timesEndingAt(ist(D, '10:45'), 15, 65, NSE_SESSION);
  const mcx15 = timesEndingAt(ist(D, '10:45'), 15, 65, MCX_SESSION);
  const rising = (base: number, step = 0.5) => Array.from({ length: 65 }, (_, i) => base + i * step);
  provider.set(niftySpot, '15m', candlesAt(nse15, rising(25_000, 0.1)));
  provider.set(niftyFut, '15m', candlesAt(nse15, rising(25_100)));
  provider.set(ce(niftyOpts, 25_000), '15m', candlesAt(nse15, momentumCloses(14), { spread: 0.5 }));
  provider.set(bankSpot, '15m', candlesAt(nse15, rising(56_010)));
  provider.set(bankFut, '15m', candlesAt(nse15, Array.from({ length: 65 }, (_, i) => 56_500 - i * 2))); // falling future → weaker than the call
  provider.set(ce(bankOpts, 56_000), '15m', candlesAt(nse15, momentumCloses(14), { spread: 0.5 }));
  provider.set(goldFut, '15m', candlesAt(mcx15, rising(75_000)));
  provider.set(ce(goldOpts, 75_000), '15m', candlesAt(mcx15, momentumCloses(14), { spread: 0.5 }));
  provider.ltp.set(niftySpot.token, 25_010);
  provider.ltp.set(bankSpot.token, 56_010);
  provider.ltp.set(goldFut.token, 75_040);
  const channels = new RecordingChannels();
  const products = new ProductService(store, provider);
  const svc = new V2Service({ store, provider, products, channels, clock: () => clock.now });
  return { clock, store, provider, channels, svc };
}

describe('V2 — strategy + product = alert', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(async () => {
    env = setup();
    await env.svc.syncProducts();
  });

  /** Connect and switch on in the morning (candles closing before switch-on never alert). */
  async function connectAll() {
    env.clock.now = ist(D, '09:30');
    const s = await env.svc.createStrategy(S);
    const conns = await env.svc.createConnections(s.id, ['NSE:NIFTY', 'NSE:BANKNIFTY', 'MCX:GOLD'], config());
    for (const c of conns) await env.svc.enableConnection(c.id);
    env.clock.now = NOW;
    return { s, byProduct: new Map(conns.map((c) => [c.productId, c])) };
  }

  it('builds a catalogue of indices, stocks and commodities with the legs each offers', async () => {
    const products = await env.svc.products({});
    expect(products.map((p) => [p.id, p.kind, p.hasSpot, p.hasFutures, p.hasOptions])).toEqual(
      expect.arrayContaining([
        ['NSE:NIFTY', 'INDEX', true, true, true],
        ['MCX:GOLD', 'COMMODITY', false, true, true],
        ['NSE:ITC', 'STOCK', true, false, false],
      ]),
    );
  });

  it('one strategy connected to three products alerts where its conditions hold (FUT vs CE)', async () => {
    const { s, byProduct } = await connectAll();
    const { run } = await env.svc.scan();
    expect(run.errors).toEqual([]);
    expect(run.connections).toBe(3);
    expect(run.unitsEvaluated).toBe(3);

    const alerts = env.store.data.alerts;
    expect(alerts.map((a) => a.productId).sort()).toEqual(['MCX:GOLD', 'NSE:NIFTY']);
    const nifty = alerts.find((a) => a.productId === 'NSE:NIFTY')!;
    expect(nifty).toMatchObject({ strategyId: s.id, connectionId: byProduct.get('NSE:NIFTY')!.id, candleTime: ist(D, '10:45') / 1000 });
    expect(nifty.unit).toMatchObject({ key: '2026-10-13|25000', baseStrike: 25_000 });
    expect(nifty.unit.legs.A?.id).toBe(niftyFut.id);
    expect(nifty.unit.legs.B?.id).toBe(ce(niftyOpts, 25_000).id);
    expect(nifty.evaluation.trace.children!.map((c) => [c.condition!.left!.leg, c.condition!.right!.leg ?? null, c.result])).toEqual([
      ['A', 'B', 'TRUE'],
      ['B', null, 'TRUE'],
    ]);
    const gold = alerts.find((a) => a.productId === 'MCX:GOLD')!;
    expect(gold.unit.legs.A?.id).toBe(goldFut.id); // MCX: the future the options expire into

    // BANKNIFTY: the call crossed 60 but the future is weaker → no alert, and the reason is visible.
    const bank = await env.store.units.get(byProduct.get('NSE:BANKNIFTY')!.id, '2026-10-13|56000');
    expect(bank?.lastEvaluation?.trace.children!.map((c) => c.result)).toEqual(['FALSE', 'TRUE']);

    expect(env.channels.sent).toHaveLength(2);
    expect(env.channels.sent.map((m) => m.message.text).join('\n')).toMatch(/Future leads the call[\s\S]*A · FUT: NIFTY20261027FUT[\s\S]*B · CE ATM: NIFTY2026101325000CE/);
  });

  it('does not re-alert the same candle and only scans products whose market is open', async () => {
    await connectAll();
    await env.svc.scan();
    env.clock.now = NOW + 60_000;
    const again = await env.svc.scan();
    expect(again.run.notes.join()).toMatch(/already evaluated/);
    expect(env.store.data.alerts).toHaveLength(2);

    env.clock.now = ist(D, '16:00') + 30_000; // NSE closed, MCX still open
    const evening = await env.svc.scan();
    expect(evening.run.connections).toBe(1);
  });

  it('refuses to connect a strategy to a product that lacks its legs', async () => {
    const s = await env.svc.createStrategy(S);
    const err = await env.svc.createConnections(s.id, ['NSE:ITC'], config()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2ServiceError);
    expect((err as V2ServiceError).issues!.map((i) => i.message).join()).toMatch(/ITC has no futures/);
  });

  it('refuses to switch on a connection whose channel is not configured', async () => {
    env.channels.configured.telegram = false;
    const s = await env.svc.createStrategy(S);
    const [c] = await env.svc.createConnections(s.id, ['NSE:NIFTY'], config());
    await expect(env.svc.enableConnection(c!.id)).rejects.toThrow(/Fix these before switching on/);
  });

  it('explains a connection now without saving anything', async () => {
    const { byProduct } = await connectAll();
    const ex = await env.svc.explainConnection(byProduct.get('NSE:BANKNIFTY')!.id);
    expect(ex.units).toHaveLength(1);
    expect(ex.units[0]!.evaluation?.result).toBe('FALSE');
    expect(ex.references).toEqual([{ symbol: 'NIFTY BANK', ltp: 56_010 }]);
    expect(env.store.data.alerts).toHaveLength(0);
  });

  it('compares one strategy across products over past candles (alerts only)', async () => {
    const s = await env.svc.createStrategy(S);
    const cmp = await env.svc.compare({ strategyId: s.id, products: ['NSE:BANKNIFTY', 'NSE:NIFTY', 'MCX:GOLD'], from: D, to: D });
    expect(cmp.products.map((p) => [p.productId, p.alerts.length])).toEqual([
      ['NSE:NIFTY', 1],
      ['MCX:GOLD', 1],
      ['NSE:BANKNIFTY', 0],
    ]);
    const nifty = cmp.products[0]!;
    expect(nifty.candles).toBe(7); // 09:15 … 10:45 on the NSE clock
    expect(nifty.alerts[0]!.candleTime).toBe(ist(D, '10:45') / 1000);
    expect(nifty.unit?.baseStrike).toBe(25_000);
    expect(cmp.products[1]!.candles).toBe(8); // 09:00 … 10:45 on the MCX clock
    await expect(env.svc.compare({ strategyId: s.id, products: ['NSE:NIFTY'], from: '2026-09-01', to: D })).rejects.toThrow(/limited to 20 days/);
  });

  it('keeps a spot-only strategy compatible with cash stocks', async () => {
    const cash = await env.svc.createStrategy({ ...strategy([{ id: 'A', kind: 'SPOT' }], cond(field(legSeries('A')), 'GT', num(0))), name: 'Spot only' });
    const conns = await env.svc.createConnections(cash.id, ['NSE:ITC', 'NSE:NIFTY'], config());
    expect(conns.map((c) => c.productId)).toEqual(['NSE:ITC', 'NSE:NIFTY']);
    await expect(env.svc.createConnections(cash.id, ['MCX:GOLD'], config())).rejects.toThrow(/can’t be connected/);
  });
});
