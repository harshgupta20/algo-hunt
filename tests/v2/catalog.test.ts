import { describe, expect, it } from 'vitest';
import type { StrategyDefinition } from '../../src/shared/v2';
import { incompatibility, legName, strategyDefinitionSchema, strategySummary, validateConnection, validateStrategy } from '../../src/shared/v2';
import { MarketCalendar } from '../../src/server/v2/calendar/MarketCalendar';
import { mapRow } from '../../src/server/v2/data/KiteDataProvider';
import { buildProducts } from '../../src/server/v2/data/ProductService';
import { and, cond, config, field, fut, ind, ist, ladder, legSeries, num, spot, strategy } from '../helpers/v2Fakes';

const TODAY = '2026-10-07';

describe('instrument dump → products', () => {
  const stockNames: Record<string, string> = {};
  const rows = [
    { instrument_token: 256265, tradingsymbol: 'NIFTY 50', name: 'NIFTY 50', instrument_type: 'EQ', segment: 'INDICES', exchange: 'NSE' },
    { instrument_token: 738561, tradingsymbol: 'RELIANCE', name: 'RELIANCE INDUSTRIES', instrument_type: 'EQ', segment: 'NSE', exchange: 'NSE' },
    { instrument_token: 1, tradingsymbol: 'RELIANCE-BE', name: 'RELIANCE', instrument_type: 'EQ', segment: 'NSE', exchange: 'NSE' },
    { instrument_token: 2, tradingsymbol: 'NIFTY26OCTFUT', name: 'NIFTY', instrument_type: 'FUT', segment: 'NFO-FUT', exchange: 'NFO', expiry: '2026-10-27', lot_size: 75 },
    { instrument_token: 3, tradingsymbol: 'NIFTY26O1325000CE', name: 'NIFTY', instrument_type: 'CE', segment: 'NFO-OPT', exchange: 'NFO', expiry: '2026-10-13', strike: 25000 },
    { instrument_token: 4, tradingsymbol: 'NIFTY26O1325050CE', name: 'NIFTY', instrument_type: 'CE', segment: 'NFO-OPT', exchange: 'NFO', expiry: '2026-10-13', strike: 25050 },
    { instrument_token: 5, tradingsymbol: 'RELIANCE26OCTFUT', name: 'RELIANCE', instrument_type: 'FUT', segment: 'NFO-FUT', exchange: 'NFO', expiry: '2026-10-27' },
    { instrument_token: 6, tradingsymbol: 'GOLD26DECFUT', name: 'GOLD', instrument_type: 'FUT', segment: 'MCX-FUT', exchange: 'MCX', expiry: '2026-12-04' },
    { instrument_token: 7, tradingsymbol: 'SENSEX', name: 'SENSEX', instrument_type: 'EQ', segment: 'INDICES', exchange: 'BSE' },
    { instrument_token: 8, tradingsymbol: 'OLD26SEPFUT', name: 'OLD', instrument_type: 'FUT', segment: 'NFO-FUT', exchange: 'NFO', expiry: '2026-09-24' },
  ];
  const list = rows.map((r) => mapRow(r, TODAY, stockNames)).filter((x) => x !== null);

  it('maps indices, cash stocks, F&O and commodities to products with legs; drops expired and non-EQ series', () => {
    expect(list.map((i) => `${i.productId}:${i.kind}`)).toEqual(['NSE:NIFTY:SPOT', 'NSE:RELIANCE:SPOT', 'NSE:NIFTY:FUT', 'NSE:NIFTY:CE', 'NSE:NIFTY:CE', 'NSE:RELIANCE:FUT', 'MCX:GOLD:FUT', 'BSE:SENSEX:SPOT']);
    const products = buildProducts(list, stockNames);
    const nifty = products.find((p) => p.id === 'NSE:NIFTY')!;
    expect(nifty).toMatchObject({ kind: 'INDEX', market: 'NSE', name: 'Nifty 50', hasSpot: true, hasFutures: true, hasOptions: true, strikeStep: 50, optionExpiries: ['2026-10-13'] });
    expect(products.find((p) => p.id === 'NSE:RELIANCE')).toMatchObject({ kind: 'STOCK', name: 'RELIANCE INDUSTRIES', hasSpot: true, hasFutures: true, hasOptions: false });
    expect(products.find((p) => p.id === 'MCX:GOLD')).toMatchObject({ kind: 'COMMODITY', market: 'MCX', hasSpot: false });
  });
});

describe('NSE calendar', () => {
  const cal = new MarketCalendar('NSE', [{ market: 'NSE', date: '2026-10-02', kind: 'HOLIDAY' }, { market: 'MCX', date: '2026-10-07', kind: 'HOLIDAY' }]);
  it('trades 09:15–15:30 and aligns candles to 09:15', () => {
    expect(cal.session('2026-10-07')).toMatchObject({ trading: true, openMin: 555, closeMin: 930 });
    expect(cal.isTradingDay('2026-10-02')).toBe(false); // NSE holiday
    expect(cal.periodOpen(ist('2026-10-07', '10:50'), '15m')).toBe(ist('2026-10-07', '10:45'));
    expect(cal.periodOpen(ist('2026-10-07', '10:50'), '1h')).toBe(ist('2026-10-07', '10:15'));
    expect(cal.candleClose(ist('2026-10-07', '15:15'), '1h')).toBe(ist('2026-10-07', '15:30'));
    expect(cal.lastCompletedOpen(ist('2026-10-07', '09:20'), '15m')).toBe(ist('2026-10-06', '15:15'));
    expect(cal.isMarketOpen(ist('2026-10-07', '16:00'))).toBe(false);
  });
  it('keeps market calendars separate', () => {
    expect(new MarketCalendar('MCX', [{ market: 'NSE', date: '2026-10-02', kind: 'HOLIDAY' }]).isTradingDay('2026-10-02')).toBe(true);
  });
});

describe('strategy + connection validation', () => {
  const s: StrategyDefinition = strategy(
    [
      { id: 'A', kind: 'FUT' },
      { id: 'B', kind: 'CE', strikeOffset: 1 },
    ],
    and(cond(ind(legSeries('A'), 'RSI', { period: 14 }), 'GT', ind(legSeries('B'), 'RSI', { period: 14 })), cond(field(legSeries('A')), 'GT', num(1))),
  );

  it('accepts a product-agnostic strategy comparing two legs', () => {
    expect(strategyDefinitionSchema.safeParse(s).success).toBe(true);
    expect(validateStrategy(s).filter((i) => i.severity === 'error')).toEqual([]);
    expect(legName(s.legs[1]!)).toBe('B · CE ATM+1');
    expect(strategySummary(s)).toMatch(/\[A · FUT\] \[15 min\] \[Normal\] RSI\(14\) > \[B · CE ATM\+1\] \[15 min\] \[Normal\] RSI\(14\)/);
  });

  it('rejects conditions on missing legs, flags unused legs and more than 4 legs', () => {
    const missing = { ...s, expression: cond(field(legSeries('C')), 'GT', num(1)) };
    expect(validateStrategy(missing).map((i) => i.message).join()).toMatch(/Uses leg C, which the strategy doesn't have/);
    expect(validateStrategy({ ...s, legs: [...s.legs, { id: 'C', kind: 'PE' }] }).some((i) => i.severity === 'warning' && /Leg C isn't used/.test(i.message))).toBe(true);
    expect(strategyDefinitionSchema.safeParse({ ...s, legs: ['A', 'B', 'C', 'D', 'A'].map((id) => ({ id, kind: 'FUT' })) }).success).toBe(false);
  });

  it('checks which products a strategy can connect to', () => {
    const products = buildProducts([spot('NSE:ITC', 'ITC'), fut('NSE:NIFTY', '2026-10-27'), ...ladder('NSE:NIFTY', '2026-10-13', 25_000, 25_100, 50)], {});
    const itc = products.find((p) => p.id === 'NSE:ITC')!;
    const nifty = products.find((p) => p.id === 'NSE:NIFTY')!;
    expect(incompatibility(s, itc)).toEqual(['ITC has no futures', 'ITC has no options']);
    expect(incompatibility(s, nifty)).toEqual([]);
    expect(validateConnection(s, nifty, config(), { channelsConfigured: { telegram: false, email: false }, forEnable: true }).map((i) => i.severity)).toContain('error');
    expect(validateConnection(s, nifty, config({ expiry: { mode: 'SPECIFIC', date: '2030-01-01' } })).map((i) => i.message).join()).toMatch(/no option expiry on 2030-01-01/);
  });
});

describe('named groups', () => {
  it('shows nested group names in the strategy text', () => {
    const d = strategy(
      [
        { id: 'A', kind: 'FUT' },
        { id: 'B', kind: 'CE', strikeOffset: 0 },
      ],
      {
        type: 'AND',
        id: 'root',
        children: [
          { type: 'AND', id: 'f', label: 'Future conditions', children: [cond(ind(legSeries('A'), 'RSI', { period: 14 }), 'GT', num(60))] },
          { type: 'OR', id: 'o', label: 'Option conditions', children: [cond(ind(legSeries('B'), 'RSI', { period: 14 }), 'CROSSED_ABOVE', num(60))] },
        ],
      },
    );
    const text = strategySummary(d);
    expect(text).toMatch(/Future conditions: \(\[A · FUT\] \[15 min\] \[Normal\] RSI\(14\) > 60\)/);
    expect(text).toMatch(/AND Option conditions: \(\[B · CE ATM\]/);
  });
});
