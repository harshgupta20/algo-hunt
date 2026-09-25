import { describe, expect, it } from 'vitest';
import type { McxInstrument, Universe } from '../../src/shared/mcx';
import { referenceFutures, resolveUniverse, selectStrikes } from '../../src/server/mcx/universe/UniverseResolver';
import { future, option } from '../helpers/mcxFakes';

const TODAY = '2026-10-07';
const futDec = future('GOLD', '2026-12-04');
const futFeb = future('GOLD', '2027-02-05');
const all: McxInstrument[] = [futDec, futFeb];
for (const e of ['2026-10-26', '2026-11-24']) for (let k = 74_500; k <= 75_500; k += 100) all.push(option('GOLD', e, k, 'CE'), option('GOLD', e, k, 'PE'));
all.push(option('GOLD', '2026-09-24', 75_000, 'CE')); // expired
const ltp = new Map([
  [futDec.token, 75_040],
  [futFeb.token, 75_600],
]);

const strikes = (r: ReturnType<typeof resolveUniverse>) => r.units.map((u) => `${u.target.strike}${u.target.optionType}`);

describe('universe resolution', () => {
  it('resolves GOLD current expiry ATM ± 2 CE from the future the options devolve into', () => {
    const u: Universe = {
      underlying: 'GOLD',
      reference: { expiry: { mode: 'MATCH_TARGET' } },
      target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, optionTypes: ['CE'], strikes: { mode: 'ATM_OFFSETS', offsets: [-2, -1, 0, 1, 2] } },
    };
    expect(referenceFutures(u, all, TODAY).map((f) => f.id)).toEqual([futDec.id]);
    const r = resolveUniverse(u, all, ltp, TODAY);
    expect(r.errors).toEqual([]);
    expect(r.expiries).toEqual(['2026-10-26']);
    expect(strikes(r)).toEqual(['74800CE', '74900CE', '75000CE', '75100CE', '75200CE']);
    expect(r.units.every((x) => x.reference?.id === futDec.id && x.atmStrike === 75_000)).toBe(true);
  });

  it('selects OTM PE strikes below ATM and ITM CE strikes below ATM', () => {
    const notes: string[] = [];
    const ladder = [74_800, 74_900, 75_000, 75_100, 75_200];
    expect(selectStrikes({ mode: 'OTM', count: 2 }, ladder, 2, 'PE', notes)).toEqual([74_800, 74_900]);
    expect(selectStrikes({ mode: 'OTM', count: 2 }, ladder, 2, 'CE', notes)).toEqual([75_100, 75_200]);
    expect(selectStrikes({ mode: 'ITM', count: 1 }, ladder, 2, 'CE', notes)).toEqual([74_900]);
    expect(selectStrikes({ mode: 'ITM', count: 1 }, ladder, 2, 'PE', notes)).toEqual([75_100]);
  });

  it('notes offsets outside the listed ladder instead of inventing strikes', () => {
    const notes: string[] = [];
    expect(selectStrikes({ mode: 'ATM_OFFSETS', offsets: [0, 3] }, [100, 200, 300], 1, 'CE', notes)).toEqual([200]);
    expect(notes[0]).toMatch(/\+3 from ATM is outside/);
  });

  it('resolves a specific expiry and reports a missing one', () => {
    const base: Universe = {
      underlying: 'GOLD',
      reference: { expiry: { mode: 'MATCH_TARGET' } },
      target: { kind: 'OPTION', expiry: { mode: 'SPECIFIC', date: '2026-11-24' }, optionTypes: ['PE'], strikes: { mode: 'SPECIFIC', strikes: [75_000, 99_999] } },
    };
    const r = resolveUniverse(base, all, ltp, TODAY);
    expect(strikes(r)).toEqual(['75000PE']);
    expect(r.notes.join()).toMatch(/99999/);
    const missing = resolveUniverse({ ...base, target: { ...base.target, expiry: { mode: 'SPECIFIC', date: '2026-10-30' } } as Universe['target'] }, all, ltp, TODAY);
    expect(missing.errors[0]).toMatch(/No GOLD option expiry matches 2026-10-30/);
  });

  it('refuses to guess ATM without a live price', () => {
    const u: Universe = {
      underlying: 'GOLD',
      reference: { expiry: { mode: 'MATCH_TARGET' } },
      target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, optionTypes: ['CE'], strikes: { mode: 'ATM_OFFSETS', offsets: [0] } },
    };
    const r = resolveUniverse(u, all, new Map(), TODAY);
    expect(r.units).toEqual([]);
    expect(r.errors[0]).toMatch(/No live price/);
  });

  it('resolves futures by expiry selector and ignores expired contracts', () => {
    const r = resolveUniverse({ underlying: 'GOLD', reference: { expiry: { mode: 'MATCH_TARGET' } }, target: { kind: 'FUTURE', expiry: { mode: 'ALL' } } }, all, ltp, TODAY);
    expect(r.units.map((u) => u.target.id)).toEqual([futDec.id, futFeb.id]);
    expect(r.units[1]!.reference?.id).toBe(futFeb.id);
  });
});
