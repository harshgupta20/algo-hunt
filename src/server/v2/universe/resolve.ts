/**
 * Turns a connection (strategy legs + product + expiry + strike positions) into
 * evaluation units — the legs resolved to real contracts.
 *
 *   SPOT → the index / stock cash instrument.
 *   CE / PE → the chosen option expiry; strike = ATM (+ strike position) + the
 *             leg's offset, stepping along the listed strikes. ATM comes from the
 *             spot price, or from the future when the product has no spot (MCX).
 *   FUT → with option legs: the future the options expire into (first future
 *         expiring on/after the option expiry); otherwise the chosen futures expiry.
 *
 * Two steps, because ATM needs a live (or historical) price:
 *   1. atmReference() → the instrument whose price sets ATM (option strategies only).
 *   2. resolveUnits(…, price) → one unit per strike position.
 */
import type { ConnectionConfig, ExpirySelector, LegDef, StrategyDefinition, UnitResolution, V2Instrument, V2Unit } from '@/shared/v2';

export const hasOptionLegs = (legs: LegDef[]) => legs.some((l) => l.kind === 'CE' || l.kind === 'PE');

export function pickExpiry(sel: ExpirySelector, expiries: string[]): string | undefined {
  switch (sel.mode) {
    case 'CURRENT':
      return expiries[0];
    case 'NEXT':
      return expiries[1];
    case 'FAR':
      return expiries[2];
    case 'SPECIFIC':
      return expiries.includes(sel.date) ? sel.date : undefined;
  }
}

interface Contracts {
  spot: V2Instrument | null;
  futures: V2Instrument[];
  optionExpiries: string[];
  options: V2Instrument[];
}

function contracts(all: V2Instrument[], today: string): Contracts {
  const futures = all.filter((i) => i.kind === 'FUT' && (i.expiry ?? '') >= today).sort((a, b) => (a.expiry ?? '').localeCompare(b.expiry ?? ''));
  const options = all.filter((i) => (i.kind === 'CE' || i.kind === 'PE') && (i.expiry ?? '') >= today);
  return { spot: all.find((i) => i.kind === 'SPOT') ?? null, futures, optionExpiries: [...new Set(options.map((o) => o.expiry!))].sort(), options };
}

const futureFor = (futures: V2Instrument[], expiry: string) => futures.find((f) => (f.expiry ?? '') >= expiry) ?? futures[futures.length - 1] ?? null;

const expiryName = (e: ExpirySelector) => (e.mode === 'SPECIFIC' ? e.date : e.mode.toLowerCase());

/** Step 1: which instrument's price sets ATM (null when the strategy has no option legs). */
export function atmReference(d: StrategyDefinition, all: V2Instrument[], config: Pick<ConnectionConfig, 'expiry'>, today: string): V2Instrument | null {
  if (!hasOptionLegs(d.legs)) return null;
  const c = contracts(all, today);
  if (c.spot) return c.spot;
  const expiry = pickExpiry(config.expiry, c.optionExpiries);
  return expiry ? futureFor(c.futures, expiry) : null;
}

const offsetName = (o: number) => (o === 0 ? 'ATM' : `ATM${o > 0 ? '+' : '−'}${Math.abs(o)}`);

/** Step 2: resolve units. `price` = the ATM reference's price (option strategies). */
export function resolveUnits(
  d: StrategyDefinition,
  productId: string,
  all: V2Instrument[],
  config: Pick<ConnectionConfig, 'expiry' | 'strikeShifts'>,
  price: number | undefined,
  today: string,
): UnitResolution {
  const errors: string[] = [];
  const notes: string[] = [];
  const c = contracts(all, today);
  const need = new Set(d.legs.map((l) => l.kind));
  if (need.has('SPOT') && !c.spot) errors.push('This product has no spot / cash price');

  if (!hasOptionLegs(d.legs)) {
    let fut: V2Instrument | null = null;
    if (need.has('FUT')) {
      const e = pickExpiry(config.expiry, c.futures.map((f) => f.expiry!));
      fut = c.futures.find((f) => f.expiry === e) ?? null;
      if (!fut) errors.push(`No future for the ${expiryName(config.expiry)} expiry`);
    }
    const legs: V2Unit['legs'] = {};
    for (const l of d.legs) legs[l.id] = l.kind === 'SPOT' ? c.spot : fut;
    const unit: V2Unit = { key: fut ? `FUT|${fut.expiry}` : 'SPOT', productId, expiry: fut?.expiry ?? null, baseStrike: null, shift: 0, legs };
    return { units: errors.length ? [] : [unit], references: [], errors, notes };
  }

  const expiry = pickExpiry(config.expiry, c.optionExpiries);
  if (!c.optionExpiries.length) errors.push('This product has no listed options');
  else if (!expiry) errors.push(`No option expiry matches ${expiryName(config.expiry)}`);
  const fut = expiry ? futureFor(c.futures, expiry) : null;
  if (need.has('FUT') && expiry && !fut) errors.push(`No future found for the ${expiry} options`);
  const ref = c.spot ?? fut;
  const references = ref ? [{ instrument: ref, ltp: price }] : [];
  if (!expiry) return { units: [], references, errors, notes };
  if (price === undefined) {
    errors.push(ref ? `No price for ${ref.symbol} — ATM can't be computed` : 'No spot or future to derive ATM from');
    return { units: [], references, errors, notes };
  }

  const strikes = [...new Set(c.options.filter((o) => o.expiry === expiry).map((o) => o.strike!))].sort((a, b) => a - b);
  let atm = 0;
  for (let i = 1; i < strikes.length; i++) if (Math.abs(strikes[i]! - price) < Math.abs(strikes[atm]! - price)) atm = i;
  const option = (kind: 'CE' | 'PE', strike: number) => c.options.find((o) => o.expiry === expiry && o.kind === kind && o.strike === strike) ?? null;

  const units: V2Unit[] = [];
  for (const shift of [...new Set(config.strikeShifts)].sort((a, b) => a - b)) {
    const base = strikes[atm + shift];
    if (base === undefined) {
      notes.push(`Strike position ${shift > 0 ? '+' : ''}${shift} is outside the listed strikes — skipped`);
      continue;
    }
    const legs: V2Unit['legs'] = {};
    for (const l of d.legs) {
      if (l.kind === 'SPOT') legs[l.id] = c.spot;
      else if (l.kind === 'FUT') legs[l.id] = fut;
      else {
        const k = strikes[atm + shift + (l.strikeOffset ?? 0)];
        legs[l.id] = k === undefined ? null : option(l.kind, k);
        if (k === undefined) notes.push(`Leg ${l.id} (${l.kind} ${offsetName((l.strikeOffset ?? 0) + shift)}) is outside the listed strikes`);
        else if (!legs[l.id]) notes.push(`Leg ${l.id}: no ${l.kind} listed at ${k}`);
      }
    }
    units.push({ key: `${expiry}|${base}`, productId, expiry, baseStrike: base, atmStrike: strikes[atm], shift, legs });
  }
  return { units, references, errors, notes: [...new Set(notes)] };
}

/** Instruments a unit reads (for quotes / fetch planning). */
export function unitInstruments(u: V2Unit): V2Instrument[] {
  const seen = new Map<number, V2Instrument>();
  for (const i of Object.values(u.legs)) if (i) seen.set(i.token, i);
  return [...seen.values()];
}
