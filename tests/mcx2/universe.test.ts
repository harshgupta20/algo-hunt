import { describe, expect, it } from 'vitest';
import type { ExpirySelector, McxInstrument, StrikeSelector, Universe } from '../../src/shared/mcx';
import { upgradeDefinition } from '../../src/shared/mcx';
import { referenceFutures, resolveUniverse, selectStrikes, unitForKey } from '../../src/server/mcx/universe/UniverseResolver';
import { future, option } from '../helpers/mcxFakes';

const TODAY = '2026-10-07';
const futDec = future('GOLD', '2026-12-04');
const futFeb = future('GOLD', '2027-02-05');
const all: McxInstrument[] = [futDec, futFeb];
for (const e of ['2026-10-26', '2026-11-24']) for (let k = 74_500; k <= 75_500; k += 100) all.push(option('GOLD', e, k, 'CE'), option('GOLD', e, k, 'PE'));
all.push(option('GOLD', '2026-10-26', 75_550, 'CE')); // call-only strike
all.push(option('GOLD', '2026-09-24', 75_000, 'CE')); // expired
const ltp = new Map([
  [futDec.token, 75_040],
  [futFeb.token, 75_600],
]);

const options = (strikes: StrikeSelector, expiry: ExpirySelector = { mode: 'CURRENT' }): Universe => ({
  underlying: 'GOLD',
  target: { kind: 'OPTION', expiry, strikes },
});

describe('universe resolution', () => {
  it('resolves ATM ± 2 into five strike units, each with FUT, CE and PE legs', () => {
    const u = options({ mode: 'ATM_OFFSETS', offsets: [-2, -1, 0, 1, 2] });
    expect(referenceFutures(u, all, TODAY).map((f) => f.id)).toEqual([futDec.id]); // the future Oct options expire into
    const r = resolveUniverse(u, all, ltp, TODAY);
    expect(r.errors).toEqual([]);
    expect(r.expiries).toEqual(['2026-10-26']);
    expect(r.units.map((x) => x.strike)).toEqual([74_800, 74_900, 75_000, 75_100, 75_200]);
    const atm = r.units[2]!;
    expect(atm).toMatchObject({ key: 'GOLD:2026-10-26:75000', atmStrike: 75_000 });
    expect(atm.fut?.id).toBe(futDec.id);
    expect(atm.ce?.optionType).toBe('CE');
    expect(atm.pe?.optionType).toBe('PE');
    expect(atm.ce?.strike).toBe(75_000);
    expect(r.references).toEqual([{ instrument: futDec, ltp: 75_040 }]);
  });

  it('selects strikes above / below ATM', () => {
    const notes: string[] = [];
    const ladder = [74_800, 74_900, 75_000, 75_100, 75_200];
    expect(selectStrikes({ mode: 'ATM_OFFSETS', offsets: [-1, -2] }, ladder, 2, notes)).toEqual([74_800, 74_900]);
    expect(selectStrikes({ mode: 'ATM_OFFSETS', offsets: [1, 2] }, ladder, 2, notes)).toEqual([75_100, 75_200]);
    expect(selectStrikes({ mode: 'ATM_OFFSETS', offsets: [0, 3] }, ladder, 2, notes)).toEqual([75_000]);
    expect(notes[0]).toMatch(/\+3 from ATM is outside/);
  });

  it('keeps a strike even if one side is not listed (that leg is simply missing)', () => {
    const r = resolveUniverse(options({ mode: 'SPECIFIC', strikes: [75_550] }), all, ltp, TODAY);
    expect(r.units).toHaveLength(1);
    expect(r.units[0]!.ce).not.toBeNull();
    expect(r.units[0]!.pe).toBeNull();
  });

  it('resolves a specific expiry, reports a missing one, and needs no live price for fixed strikes', () => {
    const r = resolveUniverse(options({ mode: 'SPECIFIC', strikes: [75_000, 99_999] }, { mode: 'SPECIFIC', date: '2026-11-24' }), all, new Map(), TODAY);
    expect(r.units.map((x) => x.key)).toEqual(['GOLD:2026-11-24:75000']);
    expect(r.notes.join()).toMatch(/99999/);
    expect(r.references).toEqual([]);
    const missing = resolveUniverse(options({ mode: 'ALL' }, { mode: 'SPECIFIC', date: '2026-10-30' }), all, ltp, TODAY);
    expect(missing.errors[0]).toMatch(/No GOLD option expiry matches 2026-10-30/);
  });

  it('refuses to guess ATM without a live price', () => {
    const r = resolveUniverse(options({ mode: 'ATM_OFFSETS', offsets: [0] }), all, new Map(), TODAY);
    expect(r.units).toEqual([]);
    expect(r.errors[0]).toMatch(/No live price/);
  });

  it('resolves futures (FUT leg only) and ignores expired contracts', () => {
    const r = resolveUniverse({ underlying: 'GOLD', target: { kind: 'FUTURE', expiry: { mode: 'ALL' } } }, all, ltp, TODAY);
    expect(r.units.map((u) => u.key)).toEqual([futDec.id, futFeb.id]);
    expect(r.units[0]).toMatchObject({ strike: null, ce: null, pe: null });
    expect(r.references).toEqual([]);
  });

  it('rebuilds a unit from its key (replay / explain)', () => {
    expect(unitForKey(all, 'GOLD:2026-11-24:75100', TODAY)?.fut?.id).toBe(futDec.id);
    expect(unitForKey(all, futFeb.id, TODAY)?.fut?.id).toBe(futFeb.id);
    expect(unitForKey(all, 'GOLD:2026-11-24:1', TODAY)).toBeNull();
  });
});

describe('definition upgrade (v1 → v2)', () => {
  it('turns an options target with OTM puts into strike offsets and TARGET operands into the PE leg', () => {
    const v1 = {
      schemaVersion: 1,
      market: 'MCX',
      name: 'old',
      universe: { underlying: 'SILVER', reference: { expiry: { mode: 'MATCH_TARGET' } }, target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, optionTypes: ['PE'], strikes: { mode: 'OTM', count: 2 } } },
      evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '5m' },
      expression: {
        type: 'AND',
        id: 'g',
        children: [
          { type: 'CONDITION', id: 'a', left: { kind: 'FIELD', series: { instrument: { role: 'TARGET' }, timeframe: '5m', candle: { type: 'NORMAL' } }, field: 'close' }, operator: 'GT', right: { kind: 'CONSTANT', value: 1 } },
          { type: 'PATTERN', id: 'p', series: { instrument: { role: 'UNDERLYING' }, timeframe: '5m', candle: { type: 'NORMAL' } }, pattern: 'HAMMER' },
        ],
      },
      alert: { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION', cooldownMinutes: null, oncePerCandle: true },
    };
    const v2 = upgradeDefinition(v1);
    expect(v2.schemaVersion).toBe(2);
    expect(v2.universe).toEqual({ underlying: 'SILVER', target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, strikes: { mode: 'ATM_OFFSETS', offsets: [-1, -2] } } });
    const [c, p] = (v2.expression as { children: Array<Record<string, any>> }).children; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(c!.left.series.leg).toBe('PE');
    expect(p!.series.leg).toBe('FUT');
  });
});
