import { describe, expect, it } from 'vitest';
import type { LegDef } from '../../src/shared/v2';
import { atmReference, resolveUnits } from '../../src/server/v2/universe/resolve';
import { and, cond, config, field, fut, ladder, legSeries, num, spot, strategy } from '../helpers/v2Fakes';

const TODAY = '2026-10-07';
// NIFTY: spot + monthly futures + weekly options (options are on the index).
const nifty = [spot('NSE:NIFTY', 'NIFTY 50'), fut('NSE:NIFTY', '2026-10-27'), fut('NSE:NIFTY', '2026-11-24'), ...ladder('NSE:NIFTY', '2026-10-13', 24_800, 25_200, 50), ...ladder('NSE:NIFTY', '2026-10-20', 24_800, 25_200, 50)];
// GOLD: no spot; options devolve into the December future.
const gold = [fut('MCX:GOLD', '2026-10-05', 'MCX'), fut('MCX:GOLD', '2026-12-04', 'MCX'), ...ladder('MCX:GOLD', '2026-10-26', 74_500, 75_500, 100, 'MCX')];

const d = (legs: LegDef[]) => strategy(legs, and(...legs.map((l) => cond(field(legSeries(l.id)), 'GT', num(0)))));

describe('connection → units', () => {
  const legs: LegDef[] = [
    { id: 'A', kind: 'FUT' },
    { id: 'B', kind: 'CE', strikeOffset: 0 },
    { id: 'C', kind: 'CE', strikeOffset: 2 },
    { id: 'D', kind: 'PE', strikeOffset: -1 },
  ];

  it('uses the spot price for ATM on NSE and the current weekly expiry; FUT = the future after that expiry', () => {
    const def = d(legs);
    expect(atmReference(def, nifty, config(), TODAY)?.symbol).toBe('NIFTY 50');
    const r = resolveUnits(def, 'NSE:NIFTY', nifty, config(), 25_010, TODAY);
    expect(r.errors).toEqual([]);
    const u = r.units[0]!;
    expect(u).toMatchObject({ key: '2026-10-13|25000', baseStrike: 25_000, atmStrike: 25_000, expiry: '2026-10-13' });
    expect(u.legs.A?.expiry).toBe('2026-10-27');
    expect([u.legs.B?.strike, u.legs.B?.kind]).toEqual([25_000, 'CE']);
    expect([u.legs.C?.strike, u.legs.C?.kind]).toEqual([25_100, 'CE']);
    expect([u.legs.D?.strike, u.legs.D?.kind]).toEqual([24_950, 'PE']);
  });

  it('uses the future for ATM when there is no spot (MCX), and that same future as the FUT leg', () => {
    const def = d(legs);
    const ref = atmReference(def, gold, config(), TODAY);
    expect(ref?.expiry).toBe('2026-12-04');
    const u = resolveUnits(def, 'MCX:GOLD', gold, config(), 75_040, TODAY).units[0]!;
    expect(u.legs.A?.id).toBe(ref?.id);
    expect(u.legs.C?.strike).toBe(75_200);
    expect(u.legs.D?.strike).toBe(74_900);
  });

  it('scans extra strike positions as separate units and notes legs outside the ladder', () => {
    const r = resolveUnits(d(legs), 'NSE:NIFTY', nifty, config({ strikeShifts: [-1, 0, 1], expiry: { mode: 'NEXT' } }), 25_010, TODAY);
    expect(r.units.map((u) => u.key)).toEqual(['2026-10-20|24950', '2026-10-20|25000', '2026-10-20|25050']);
    const edge = resolveUnits(d(legs), 'NSE:NIFTY', nifty, config(), 25_190, TODAY);
    expect(edge.units[0]!.legs.C).toBeNull();
    expect(edge.notes.join()).toMatch(/Leg C .* outside the listed strikes/);
  });

  it('never guesses ATM without a price', () => {
    const r = resolveUnits(d(legs), 'NSE:NIFTY', nifty, config(), undefined, TODAY);
    expect(r.units).toEqual([]);
    expect(r.errors[0]).toMatch(/No price for NIFTY 50/);
  });

  it('resolves spot / futures-only strategies without ATM', () => {
    const def = d([
      { id: 'A', kind: 'SPOT' },
      { id: 'B', kind: 'FUT' },
    ]);
    expect(atmReference(def, nifty, config(), TODAY)).toBeNull();
    const r = resolveUnits(def, 'NSE:NIFTY', nifty, config({ expiry: { mode: 'NEXT' } }), undefined, TODAY);
    expect(r.units).toHaveLength(1);
    expect(r.units[0]).toMatchObject({ key: 'FUT|2026-11-24', baseStrike: null });
    expect(r.units[0]!.legs.A?.symbol).toBe('NIFTY 50');
    expect(resolveUnits(d([{ id: 'A', kind: 'SPOT' }]), 'MCX:GOLD', gold, config(), undefined, TODAY).errors[0]).toMatch(/no spot/);
  });
});
