/**
 * Universe resolution: turns a strategy's universe into evaluation units.
 *
 *   Futures → one unit per selected future (FUT leg only).
 *   Options → one unit per selected strike, with three legs: FUT (the future the
 *             options expire into — first future expiring on/after the option),
 *             CE and PE at that strike and expiry.
 *
 * Two steps, because ATM needs live prices:
 *   1. referenceFutures() → the futures whose LTP sets ATM.
 *   2. resolveUniverse(…, ltp) → units.
 * ATM-relative strikes are re-resolved every cycle and never stored.
 */
import type { ExpirySelector, McxInstrument, McxUnit, StrikeSelector, Universe, UniverseResolution } from '@/shared/mcx';

const byExpiry = (a: McxInstrument, b: McxInstrument) => (a.expiry ?? '').localeCompare(b.expiry ?? '');

/** Upcoming futures of the product, nearest first. */
export function futuresOf(all: McxInstrument[], underlying: string, today: string): McxInstrument[] {
  return all
    .filter((i) => i.underlying === underlying && i.instrumentType === 'MCX_FUTURE' && (i.expiry ?? '') >= today)
    .sort(byExpiry);
}

/** Upcoming option expiries of the product, ascending. */
export function optionExpiriesOf(all: McxInstrument[], underlying: string, today: string): string[] {
  return [...new Set(all.filter((i) => i.underlying === underlying && i.instrumentType === 'MCX_OPTION' && (i.expiry ?? '') >= today).map((i) => i.expiry!))].sort();
}

/** Listed strikes for a product + option expiry, ascending. */
export function strikesOf(all: McxInstrument[], underlying: string, expiry: string): number[] {
  return [...new Set(all.filter((i) => i.underlying === underlying && i.instrumentType === 'MCX_OPTION' && i.expiry === expiry).map((i) => i.strike!))].sort(
    (a, b) => a - b,
  );
}

export function pickExpiries(sel: ExpirySelector, expiries: string[]): string[] {
  switch (sel.mode) {
    case 'CURRENT':
      return expiries.slice(0, 1);
    case 'NEXT':
      return expiries.slice(1, 2);
    case 'FAR':
      return expiries.slice(2, 3);
    case 'ALL':
      return expiries;
    case 'SPECIFIC':
      return expiries.includes(sel.date) ? [sel.date] : [];
  }
}

/** The future options of `expiry` devolve into: the first future expiring on/after it. */
export function futureForOptionExpiry(futures: McxInstrument[], expiry: string): McxInstrument | null {
  return futures.find((f) => (f.expiry ?? '') >= expiry) ?? futures[futures.length - 1] ?? null;
}

/** Index of the listed strike nearest to `price`. */
export function nearestStrikeIndex(strikes: number[], price: number): number {
  let best = 0;
  for (let i = 1; i < strikes.length; i++) if (Math.abs(strikes[i]! - price) < Math.abs(strikes[best]! - price)) best = i;
  return best;
}

/** Strikes selected from the listed ladder (`atm` = index of the ATM strike, for ATM-relative selections). */
export function selectStrikes(sel: StrikeSelector, strikes: number[], atm: number, notes: string[]): number[] {
  let picked: number[];
  switch (sel.mode) {
    case 'ATM_OFFSETS':
      picked = [...new Set(sel.offsets)].flatMap((o) => {
        const k = strikes[atm + o];
        if (k === undefined) {
          notes.push(`Strike ${o >= 0 ? '+' : ''}${o} from ATM is outside the listed strikes — skipped`);
          return [];
        }
        return [k];
      });
      break;
    case 'SPECIFIC': {
      const missing = sel.strikes.filter((k) => !strikes.includes(k));
      if (missing.length) notes.push(`Strikes not listed for this expiry: ${missing.join(', ')}`);
      picked = sel.strikes.filter((k) => strikes.includes(k));
      break;
    }
    case 'RANGE':
      picked = strikes.filter((k) => k >= sel.from && k <= sel.to);
      break;
    case 'ALL':
      picked = strikes;
      break;
  }
  return [...new Set(picked)].sort((a, b) => a - b);
}

export function futureUnit(f: McxInstrument): McxUnit {
  return { key: f.id, underlying: f.underlying, expiry: f.expiry, strike: null, fut: f, ce: null, pe: null };
}

export function strikeKey(underlying: string, expiry: string, strike: number): string {
  return `${underlying}:${expiry}:${strike}`;
}

function strikeUnit(all: McxInstrument[], underlying: string, expiry: string, strike: number, fut: McxInstrument | null, atmStrike?: number): McxUnit {
  const opt = (type: 'CE' | 'PE') =>
    all.find((i) => i.underlying === underlying && i.instrumentType === 'MCX_OPTION' && i.expiry === expiry && i.strike === strike && i.optionType === type) ?? null;
  return { key: strikeKey(underlying, expiry, strike), underlying, expiry, strike, fut, ce: opt('CE'), pe: opt('PE'), atmStrike };
}

/** Step 1: the futures whose LTP is needed to resolve this universe (ATM-relative strikes only). */
export function referenceFutures(u: Universe, all: McxInstrument[], today: string): McxInstrument[] {
  if (u.target.kind !== 'OPTION' || u.target.strikes.mode !== 'ATM_OFFSETS') return [];
  const futures = futuresOf(all, u.underlying, today);
  const refs = new Map<number, McxInstrument>();
  for (const e of pickExpiries(u.target.expiry, optionExpiriesOf(all, u.underlying, today))) {
    const f = futureForOptionExpiry(futures, e);
    if (f) refs.set(f.token, f);
  }
  return [...refs.values()];
}

/** Step 2: resolve the units. `ltp` maps future tokens to their last traded price. */
export function resolveUniverse(u: Universe, all: McxInstrument[], ltp: Map<number, number>, today: string): UniverseResolution {
  const errors: string[] = [];
  const notes: string[] = [];
  const units: McxUnit[] = [];
  const refsUsed = new Map<number, { instrument: McxInstrument; ltp?: number }>();
  const futures = futuresOf(all, u.underlying, today);
  const expiryName = (e: ExpirySelector) => (e.mode === 'SPECIFIC' ? e.date : e.mode.toLowerCase());

  if (u.target.kind === 'FUTURE') {
    const expiries = pickExpiries(u.target.expiry, futures.map((f) => f.expiry!));
    if (!expiries.length) errors.push(`No ${u.underlying} future for the ${expiryName(u.target.expiry)} expiry`);
    for (const e of expiries) units.push(futureUnit(futures.find((f) => f.expiry === e)!));
    return { units, references: [], expiries, errors, notes };
  }

  const t = u.target;
  const optionExpiries = optionExpiriesOf(all, u.underlying, today);
  if (!optionExpiries.length) errors.push(`${u.underlying} has no listed options`);
  const expiries = pickExpiries(t.expiry, optionExpiries);
  if (optionExpiries.length && !expiries.length) errors.push(`No ${u.underlying} option expiry matches ${expiryName(t.expiry)}`);

  for (const e of expiries) {
    const strikes = strikesOf(all, u.underlying, e);
    const fut = futureForOptionExpiry(futures, e);
    if (!fut) notes.push(`No ${u.underlying} future found for the ${e} options — FUT conditions will be unknown`);
    let atm = -1;
    if (t.strikes.mode === 'ATM_OFFSETS') {
      const price = fut ? ltp.get(fut.token) : undefined;
      if (fut) refsUsed.set(fut.token, { instrument: fut, ltp: price });
      if (!fut || price === undefined) {
        errors.push(fut ? `No live price for ${fut.symbol} — ATM for the ${e} expiry can't be computed` : `No ${u.underlying} future to derive ATM for the ${e} expiry`);
        continue;
      }
      atm = nearestStrikeIndex(strikes, price);
    }
    for (const k of selectStrikes(t.strikes, strikes, atm, notes)) units.push(strikeUnit(all, u.underlying, e, k, fut, atm >= 0 ? strikes[atm] : undefined));
  }
  return { units, references: [...refsUsed.values()], expiries, errors, notes: [...new Set(notes)] };
}

/**
 * The unit for an explicit key (replay / explain of one unit): `MCX:<token>` for a
 * future, `<PRODUCT>:<expiry>:<strike>` for a strike.
 */
export function unitForKey(all: McxInstrument[], key: string, today: string): McxUnit | null {
  if (key.startsWith('MCX:')) {
    const f = all.find((i) => i.id === key && i.instrumentType === 'MCX_FUTURE');
    return f ? futureUnit(f) : null;
  }
  const [underlying, expiry, strike] = key.split(':');
  if (!underlying || !expiry || !strike) return null;
  const k = Number(strike);
  if (!strikesOf(all, underlying, expiry).includes(k)) return null;
  return strikeUnit(all, underlying, expiry, k, futureForOptionExpiry(futuresOf(all, underlying, today), expiry));
}
