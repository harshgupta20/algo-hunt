/**
 * Universe resolution: turns a strategy's explicit universe (product, expiry
 * selector, CE/PE, strike selector, reference future) into the concrete target
 * instruments to evaluate — one evaluation unit each.
 *
 * Two steps, because ATM needs live prices:
 *   1. referenceFutures() → the futures whose LTP is needed.
 *   2. resolveUniverse(…, ltp) → units (target + reference + ATM strike).
 * Dynamic selections (ATM ± N, ITM/OTM) are re-resolved every cycle and never stored.
 */
import type {
  ExpirySelector,
  McxInstrument,
  OptionType,
  ReferenceSelector,
  ResolvedUnit,
  StrikeSelector,
  Universe,
  UniverseResolution,
} from '@/shared/mcx';

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

/** The future acting as UNDERLYING for a target (options: the future the option devolves into). */
function referenceFor(sel: ReferenceSelector, futures: McxInstrument[], target: McxInstrument): McxInstrument | null {
  if (sel.mode === 'MATCH_TARGET') {
    if (target.instrumentType === 'MCX_FUTURE') return target;
    return futures.find((f) => (f.expiry ?? '') >= (target.expiry ?? '')) ?? futures[futures.length - 1] ?? null;
  }
  const picked = pickExpiries(sel.mode === 'ALL' ? { mode: 'CURRENT' } : sel, futures.map((f) => f.expiry!));
  return futures.find((f) => f.expiry === picked[0]) ?? null;
}

const needsAtm = (s: StrikeSelector) => s.mode === 'ATM_OFFSETS' || s.mode === 'ITM' || s.mode === 'OTM';

/** Index of the listed strike nearest to `price`. */
export function nearestStrikeIndex(strikes: number[], price: number): number {
  let best = 0;
  for (let i = 1; i < strikes.length; i++) if (Math.abs(strikes[i]! - price) < Math.abs(strikes[best]! - price)) best = i;
  return best;
}

/** Strikes selected for one option type, given the listed strikes and the ATM index. */
export function selectStrikes(sel: StrikeSelector, strikes: number[], atm: number, type: OptionType, notes: string[]): number[] {
  const at = (i: number) => {
    if (i < 0 || i >= strikes.length) {
      notes.push(`Strike offset ${i - atm >= 0 ? '+' : ''}${i - atm} from ATM is outside the listed strikes — skipped`);
      return undefined;
    }
    return strikes[i];
  };
  const run = (dir: 1 | -1, count: number) => Array.from({ length: count }, (_, k) => at(atm + dir * (k + 1)));
  let picked: Array<number | undefined>;
  switch (sel.mode) {
    case 'ATM_OFFSETS':
      picked = [...new Set(sel.offsets)].sort((a, b) => a - b).map((o) => at(atm + o));
      break;
    case 'ITM':
      picked = run(type === 'CE' ? -1 : 1, sel.count);
      break;
    case 'OTM':
      picked = run(type === 'CE' ? 1 : -1, sel.count);
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
  return [...new Set(picked.filter((k): k is number => k !== undefined))].sort((a, b) => a - b);
}

/** Step 1: the reference futures whose LTP is needed to resolve this universe. */
export function referenceFutures(u: Universe, all: McxInstrument[], today: string): McxInstrument[] {
  const futures = futuresOf(all, u.underlying, today);
  if (u.target.kind === 'FUTURE') return [];
  if (!needsAtm(u.target.strikes)) return [];
  const expiries = pickExpiries(u.target.expiry, optionExpiriesOf(all, u.underlying, today));
  const refs = new Map<number, McxInstrument>();
  for (const e of expiries) {
    const probe = { instrumentType: 'MCX_OPTION', expiry: e } as McxInstrument;
    const r = referenceFor(u.reference.expiry, futures, probe);
    if (r) refs.set(r.token, r);
  }
  return [...refs.values()];
}

/** Step 2: resolve the units. `ltp` maps reference-future tokens to their last traded price. */
export function resolveUniverse(u: Universe, all: McxInstrument[], ltp: Map<number, number>, today: string): UniverseResolution {
  const errors: string[] = [];
  const notes: string[] = [];
  const units: ResolvedUnit[] = [];
  const refsUsed = new Map<number, { instrument: McxInstrument; ltp?: number }>();
  const futures = futuresOf(all, u.underlying, today);

  if (u.target.kind === 'FUTURE') {
    const expiries = pickExpiries(u.target.expiry, futures.map((f) => f.expiry!));
    if (!expiries.length) errors.push(`No ${u.underlying} futures for ${u.target.expiry.mode === 'SPECIFIC' ? u.target.expiry.date : u.target.expiry.mode.toLowerCase()} expiry`);
    for (const e of expiries) {
      const target = futures.find((f) => f.expiry === e)!;
      const reference = referenceFor(u.reference.expiry, futures, target);
      if (reference) refsUsed.set(reference.token, { instrument: reference, ltp: ltp.get(reference.token) });
      units.push({ target, reference });
    }
    return { units, references: [...refsUsed.values()], expiries, errors, notes };
  }

  const target = u.target;
  const optionExpiries = optionExpiriesOf(all, u.underlying, today);
  if (!optionExpiries.length) errors.push(`${u.underlying} has no listed options`);
  const expiries = pickExpiries(target.expiry, optionExpiries);
  if (optionExpiries.length && !expiries.length) errors.push(`No ${u.underlying} option expiry matches ${target.expiry.mode === 'SPECIFIC' ? target.expiry.date : target.expiry.mode.toLowerCase()}`);

  for (const e of expiries) {
    const strikes = strikesOf(all, u.underlying, e);
    const reference = referenceFor(u.reference.expiry, futures, { instrumentType: 'MCX_OPTION', expiry: e } as McxInstrument);
    if (reference) refsUsed.set(reference.token, { instrument: reference, ltp: ltp.get(reference.token) });
    let atm = -1;
    if (needsAtm(target.strikes)) {
      const price = reference ? ltp.get(reference.token) : undefined;
      if (!reference) {
        errors.push(`No ${u.underlying} future to derive ATM for the ${e} expiry`);
        continue;
      }
      if (price === undefined) {
        errors.push(`No live price for ${reference.symbol} — ATM for the ${e} expiry can't be computed`);
        continue;
      }
      atm = nearestStrikeIndex(strikes, price);
    }
    for (const type of [...target.optionTypes].sort()) {
      for (const k of selectStrikes(target.strikes, strikes, atm, type, notes)) {
        const contract = all.find((i) => i.underlying === u.underlying && i.instrumentType === 'MCX_OPTION' && i.expiry === e && i.optionType === type && i.strike === k);
        if (!contract) {
          notes.push(`${u.underlying} ${e} ${k} ${type} is not listed — skipped`);
          continue;
        }
        units.push({ target: contract, reference, atmStrike: atm >= 0 ? strikes[atm] : undefined });
      }
    }
  }
  const seen = new Set<string>();
  const unique = units.filter((x) => (seen.has(x.target.id) ? false : (seen.add(x.target.id), true)));
  return { units: unique, references: [...refsUsed.values()], expiries, errors, notes: [...new Set(notes)] };
}

/** A unit for an explicitly chosen target (replay / explain of one contract), with its reference future. */
export function unitForTarget(u: Universe, all: McxInstrument[], target: McxInstrument, today: string): ResolvedUnit {
  return { target, reference: referenceFor(u.reference.expiry, futuresOf(all, u.underlying, today), target) };
}
