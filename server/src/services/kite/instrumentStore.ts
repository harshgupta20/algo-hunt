/**
 * Caches the instrument master and resolves an underlying + expiry + strike
 * selection into the concrete Future/Call/Put triplet the worker subscribes to.
 * Provider-agnostic: works off whatever instruments the provider returns.
 */
import type {
  ExpiryType,
  Instrument,
  InstrumentTriplet,
  StrikeSelection,
} from '@ash/shared';
import { UNDERLYING_BY_SYMBOL } from '@ash/shared';
import type { MarketDataProvider } from './MarketDataProvider.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger('instrument-store');

export interface ExpiryOption {
  type: ExpiryType;
  date: string;
  label: string;
}

const STRIKE_OFFSETS: Record<StrikeSelection, number> = {
  ATM: 0,
  'ATM+1': 1,
  'ATM-1': -1,
  'ATM+2': 2,
  'ATM-2': -2,
  CUSTOM: 0,
};

/** True if `date` is the latest expiry within its calendar month among `all`. */
function isMonthEndExpiry(date: string, all: string[]): boolean {
  const ym = date.slice(0, 7);
  return !all.some((d) => d.slice(0, 7) === ym && d > date);
}

export class InstrumentStore {
  private instruments: Instrument[] = [];
  private loaded = false;

  constructor(private readonly provider: MarketDataProvider) {}

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    this.instruments = await this.provider.getInstruments();
    this.loaded = true;
    log.info({ count: this.instruments.length }, 'instrument master loaded');
  }

  /** Underlyings that actually have instruments in the master. */
  underlyings(): string[] {
    const set = new Set(this.instruments.map((i) => i.underlying));
    return [...set];
  }

  /** Distinct upcoming expiry dates (yyyy-mm-dd) for an underlying, ascending. */
  private upcomingExpiries(underlying: string): string[] {
    const today = new Date().toISOString().slice(0, 10);
    const set = new Set(
      this.instruments
        .filter((i) => i.underlying === underlying && i.expiry >= today)
        .map((i) => i.expiry),
    );
    return [...set].sort();
  }

  /** Expiry options (current weekly / next weekly / monthly) for the dropdown. */
  expiryOptions(underlying: string): ExpiryOption[] {
    const dates = this.upcomingExpiries(underlying);
    const options: ExpiryOption[] = [];
    if (dates[0]) options.push({ type: 'current-weekly', date: dates[0], label: `Current Weekly (${dates[0]})` });
    if (dates[1]) options.push({ type: 'next-weekly', date: dates[1], label: `Next Weekly (${dates[1]})` });
    const monthly = dates.find((d) => isMonthEndExpiry(d, dates));
    if (monthly) options.push({ type: 'monthly', date: monthly, label: `Monthly (${monthly})` });
    return options;
  }

  /** Resolve an ExpiryType into a concrete date for an underlying. */
  resolveExpiryDate(underlying: string, type: ExpiryType): string | undefined {
    return this.expiryOptions(underlying).find((o) => o.type === type)?.date;
  }

  /** Strikes available for an underlying + expiry (from listed options). */
  strikes(underlying: string, expiry: string): number[] {
    const set = new Set(
      this.instruments
        .filter((i) => i.underlying === underlying && i.expiry === expiry && i.instrumentType !== 'FUT')
        .map((i) => i.strike),
    );
    return [...set].sort((a, b) => a - b);
  }

  private find(
    underlying: string,
    expiry: string,
    type: Instrument['instrumentType'],
    strike: number,
  ): Instrument | undefined {
    return this.instruments.find(
      (i) =>
        i.underlying === underlying &&
        i.expiry === expiry &&
        i.instrumentType === type &&
        (type === 'FUT' || i.strike === strike),
    );
  }

  /**
   * Nearest future for an underlying. Futures have MONTHLY expiries only, so we
   * can't match a weekly option expiry — instead pick the front future still
   * trading when the option expires (else the nearest upcoming, else the last).
   */
  private nearestFuture(underlying: string, onOrAfter: string): Instrument | undefined {
    const today = new Date().toISOString().slice(0, 10);
    const futures = this.instruments
      .filter((i) => i.underlying === underlying && i.instrumentType === 'FUT')
      .sort((a, b) => a.expiry.localeCompare(b.expiry));
    return (
      futures.find((f) => f.expiry >= onOrAfter) ??
      futures.find((f) => f.expiry >= today) ??
      futures[futures.length - 1]
    );
  }

  /**
   * Resolve the Future/Call/Put triplet for a configuration. The ATM strike is
   * derived from the provider's reference price and the underlying's strike
   * interval, then shifted by the strike selection.
   */
  async resolveTriplet(params: {
    underlying: string;
    expiry: string;
    strikeSelection: StrikeSelection;
    customStrike?: number;
  }): Promise<InstrumentTriplet> {
    const { underlying, expiry, strikeSelection, customStrike } = params;
    const def = UNDERLYING_BY_SYMBOL[underlying];
    if (!def) throw new Error(`Unknown underlying: ${underlying}`);

    const reference = await this.provider.getReferencePrice(underlying);
    const atm = Math.round(reference / def.strikeInterval) * def.strikeInterval;

    let strike: number;
    if (strikeSelection === 'CUSTOM') {
      if (customStrike === undefined) throw new Error('CUSTOM strike selection requires customStrike');
      strike = customStrike;
    } else {
      strike = atm + STRIKE_OFFSETS[strikeSelection] * def.strikeInterval;
    }

    // Future uses the monthly futures chain (weekly option expiries have no future).
    const future = this.nearestFuture(underlying, expiry);
    const call = this.find(underlying, expiry, 'CE', strike);
    const put = this.find(underlying, expiry, 'PE', strike);

    if (!future || !call || !put) {
      throw new Error(
        `Could not resolve triplet for ${underlying} ${expiry} @ ${strike} ` +
          `(future=${!!future} call=${!!call} put=${!!put})`,
      );
    }

    return { future, call, put, strike };
  }

  get all(): Instrument[] {
    return this.instruments;
  }

  instrument(token: number): Instrument | undefined {
    return this.instruments.find((i) => i.token === token);
  }

  // ---- Helpers for dynamic ATM tracking (strike follows the future price) ----

  strikeInterval(underlying: string): number {
    return UNDERLYING_BY_SYMBOL[underlying]?.strikeInterval ?? 50;
  }

  /** Target strike for a given underlying price + selection (ATM, ATM±n, custom). */
  strikeFromPrice(underlying: string, price: number, selection: StrikeSelection, customStrike?: number): number {
    const interval = this.strikeInterval(underlying);
    const atm = Math.round(price / interval) * interval;
    if (selection === 'CUSTOM') return customStrike ?? atm;
    return atm + STRIKE_OFFSETS[selection] * interval;
  }

  /** The monthly future to use for this option expiry (public wrapper of nearestFuture). */
  resolveFuture(underlying: string, onOrAfter: string): Instrument | undefined {
    return this.nearestFuture(underlying, onOrAfter);
  }

  /** The CE/PE instrument at a specific strike + expiry. */
  option(underlying: string, expiry: string, strike: number, type: 'CE' | 'PE'): Instrument | undefined {
    return this.find(underlying, expiry, type, strike);
  }
}
