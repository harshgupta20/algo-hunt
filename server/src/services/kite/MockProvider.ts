/**
 * Simulated market-data provider. Generates a synthetic instrument master for
 * the supported index underlyings and streams random-walk ticks for subscribed
 * tokens, so the entire platform runs end-to-end without Kite credentials.
 */
import type { Instrument, InstrumentType, Tick } from '@ash/shared';
import { UNDERLYINGS } from '@ash/shared';
import { BaseMarketDataProvider } from './MarketDataProvider.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger('mock-provider');

/** Seeded reference (spot/future) price per underlying. */
export const BASE_PRICE: Record<string, number> = {
  NIFTY: 24000,
  BANKNIFTY: 51000,
  FINNIFTY: 23000,
  SENSEX: 79000,
  BANKEX: 58000,
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function expiryTag(dateIso: string): string {
  const [y, m] = dateIso.split('-');
  return `${y!.slice(2)}${MONTHS[Number(m) - 1]}`;
}

/** The next `count` Thursdays (weekday 4), starting today if today is Thursday. */
function nextThursdays(count: number): Date[] {
  const out: Date[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (out.length < count) {
    if (d.getUTCDay() === 4) out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Last Thursday of the month containing `ref` (or of `monthOffset` months ahead). */
function lastThursdayOfMonth(ref: Date, monthOffset = 0): Date {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + monthOffset + 1, 0));
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

interface TokenState {
  token: number;
  underlying: string;
  type: InstrumentType;
  strike: number;
  price: number;
  volatility: number;
}

export class MockProvider extends BaseMarketDataProvider {
  readonly name = 'mock';

  private instruments: Instrument[] = [];
  private readonly tokenState = new Map<number, TokenState>();
  private readonly active = new Set<number>();
  private timer: NodeJS.Timeout | undefined;
  private nextToken = 100_000;

  constructor(private readonly tickIntervalMs: number) {
    super();
    this.buildInstrumentMaster();
  }

  private buildInstrumentMaster(): void {
    const weeklies = nextThursdays(3).map(toISODate);
    const now = new Date();
    const monthlies = [lastThursdayOfMonth(now, 0), lastThursdayOfMonth(now, 1)].map(toISODate);
    const expiries = [...new Set([...weeklies, ...monthlies])].sort();

    for (const u of UNDERLYINGS) {
      const base = BASE_PRICE[u.symbol] ?? 20000;
      const atm = Math.round(base / u.strikeInterval) * u.strikeInterval;
      for (const expiry of expiries) {
        const tag = expiryTag(expiry);
        // Future
        this.addInstrument({
          underlying: u.symbol,
          exchange: u.derivativeExchange,
          instrumentType: 'FUT',
          strike: 0,
          expiry,
          tradingSymbol: `${u.symbol}${tag}FUT`,
          price: base,
          volatility: 0.0006,
        });
        // Option chain: ATM +/- 20 strikes (wide enough for the future's range
        // so dynamic ATM tracking always resolves a listed strike).
        for (let k = -20; k <= 20; k++) {
          const strike = atm + k * u.strikeInterval;
          const intrinsicCe = Math.max(base - strike, 0);
          const intrinsicPe = Math.max(strike - base, 0);
          const timeValue = base * 0.006;
          this.addInstrument({
            underlying: u.symbol,
            exchange: u.derivativeExchange,
            instrumentType: 'CE',
            strike,
            expiry,
            tradingSymbol: `${u.symbol}${tag}${strike}CE`,
            price: Math.max(intrinsicCe + timeValue, 1),
            volatility: 0.02,
          });
          this.addInstrument({
            underlying: u.symbol,
            exchange: u.derivativeExchange,
            instrumentType: 'PE',
            strike,
            expiry,
            tradingSymbol: `${u.symbol}${tag}${strike}PE`,
            price: Math.max(intrinsicPe + timeValue, 1),
            volatility: 0.02,
          });
        }
      }
    }
    log.info({ instruments: this.instruments.length }, 'synthetic instrument master built');
  }

  private addInstrument(spec: {
    underlying: string;
    exchange: Instrument['exchange'];
    instrumentType: InstrumentType;
    strike: number;
    expiry: string;
    tradingSymbol: string;
    price: number;
    volatility: number;
  }): void {
    const token = this.nextToken++;
    this.instruments.push({
      token,
      tradingSymbol: spec.tradingSymbol,
      underlying: spec.underlying,
      exchange: spec.exchange,
      instrumentType: spec.instrumentType,
      strike: spec.strike,
      expiry: spec.expiry,
      lotSize: 1,
      tickSize: 0.05,
    });
    this.tokenState.set(token, {
      token,
      underlying: spec.underlying,
      type: spec.instrumentType,
      strike: spec.strike,
      price: spec.price,
      volatility: spec.volatility,
    });
  }

  async connect(): Promise<void> {
    this.emitStatus('connecting');
    this.timer = setInterval(() => this.emitBatch(), this.tickIntervalMs);
    // Node timers keep the process alive; that's fine for a long-running worker.
    this.emitStatus('connected');
    log.info({ intervalMs: this.tickIntervalMs }, 'mock provider connected');
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.active.clear();
    this.emitStatus('disconnected');
  }

  subscribe(tokens: number[]): void {
    for (const t of tokens) if (this.tokenState.has(t)) this.active.add(t);
  }

  unsubscribe(tokens: number[]): void {
    for (const t of tokens) this.active.delete(t);
  }

  async getInstruments(): Promise<Instrument[]> {
    return this.instruments;
  }

  async getReferencePrice(underlying: string): Promise<number> {
    return BASE_PRICE[underlying] ?? 20000;
  }

  private emitBatch(): void {
    const now = Date.now();
    for (const token of this.active) {
      const state = this.tokenState.get(token);
      if (!state) continue;
      state.price = this.step(state);
      this.emitTick({ token, ltp: round2(state.price), timestamp: now });
    }
  }

  /** One random-walk step with a small mean-reverting pull toward the base. */
  private step(state: TokenState): number {
    const shock = (Math.random() - 0.5) * 2 * state.volatility * state.price;
    const next = state.price + shock;
    return Math.max(next, 0.5);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
