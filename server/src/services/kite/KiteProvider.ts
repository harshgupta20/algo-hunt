/**
 * Zerodha Kite Connect live provider. Uses the REST client for the instrument
 * master + reference quotes and KiteTicker (WebSocket) for streaming ticks.
 *
 * The access token is mutable: the auth manager can push a fresh token at
 * runtime (setAccessToken) and reconnect() without restarting the process, so
 * the daily/expired-token re-login is seamless.
 */
import type { Instrument, InstrumentType } from '@ash/shared';
import { UNDERLYING_BY_SYMBOL } from '@ash/shared';
import { BaseMarketDataProvider } from './MarketDataProvider.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger('kite-provider');

export interface KiteCredentials {
  apiKey: string;
  accessToken: string;
}

interface KiteInstrumentRow {
  instrument_token: number;
  tradingsymbol: string;
  name: string;
  expiry: string | Date;
  strike: number;
  instrument_type: string;
  exchange: string;
  lot_size?: number;
  tick_size?: number;
}

export class KiteProvider extends BaseMarketDataProvider {
  readonly name = 'kite';

  private kc: any;
  private ticker: any;
  private accessToken: string;
  private instruments: Instrument[] = [];
  private readonly subscribed = new Set<number>();
  private authErrorHandler: ((reason: string) => void) | undefined;

  constructor(private readonly apiKey: string, accessToken: string) {
    super();
    this.accessToken = accessToken;
  }

  /** Register a callback invoked when the live session fails on an auth issue. */
  onAuthError(cb: (reason: string) => void): void {
    this.authErrorHandler = cb;
  }

  /** Push a fresh access token (from a new login). Reconnects if already live. */
  setAccessToken(token: string): void {
    this.accessToken = token;
    this.kc?.setAccessToken(token);
  }

  private async loadSdk(): Promise<any> {
    try {
      return await import('kiteconnect');
    } catch {
      throw new Error("MARKET_PROVIDER=kite requires the 'kiteconnect' package.");
    }
  }

  private async ensureRest(): Promise<any> {
    if (!this.kc) {
      const { KiteConnect } = await this.loadSdk();
      this.kc = new KiteConnect({ api_key: this.apiKey });
    }
    this.kc.setAccessToken(this.accessToken);
    return this.kc;
  }

  async connect(): Promise<void> {
    this.emitStatus('connecting');
    await this.ensureRest();
    const { KiteTicker } = await this.loadSdk();

    this.ticker = new KiteTicker({ api_key: this.apiKey, access_token: this.accessToken });

    this.ticker.on('connect', () => {
      this.emitStatus('connected');
      log.info('kite ticker connected');
      if (this.subscribed.size > 0) this.applySubscription([...this.subscribed]);
    });
    this.ticker.on('reconnect', () => this.emitStatus('reconnecting'));
    this.ticker.on('noreconnect', () => {
      this.emitStatus('disconnected');
      // Gave up reconnecting — most commonly an expired/invalid token.
      this.authErrorHandler?.('Kite live feed disconnected (session may have expired). Please log in again.');
    });
    this.ticker.on('close', () => this.emitStatus('disconnected'));
    this.ticker.on('error', (err: unknown) => {
      log.error({ err }, 'kite ticker error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
    this.ticker.on('ticks', (ticks: Array<{ instrument_token: number; last_price: number }>) => {
      const now = Date.now();
      for (const t of ticks) this.emitTick({ token: t.instrument_token, ltp: t.last_price, timestamp: now });
    });

    this.ticker.connect();
  }

  /** Reconnect the WebSocket with the current token, preserving subscriptions. */
  async reconnect(): Promise<void> {
    try {
      this.ticker?.disconnect();
    } catch {
      /* ignore */
    }
    this.ticker = undefined;
    await this.connect(); // re-subscribes tracked tokens on 'connect'
  }

  async disconnect(): Promise<void> {
    try {
      this.ticker?.disconnect();
    } catch (err) {
      log.warn({ err }, 'error during kite disconnect');
    }
    this.subscribed.clear();
    this.emitStatus('disconnected');
  }

  subscribe(tokens: number[]): void {
    for (const t of tokens) this.subscribed.add(t);
    if (this.ticker) this.applySubscription(tokens);
  }

  unsubscribe(tokens: number[]): void {
    for (const t of tokens) this.subscribed.delete(t);
    this.ticker?.unsubscribe(tokens);
  }

  private applySubscription(tokens: number[]): void {
    this.ticker.subscribe(tokens);
    this.ticker.setMode(this.ticker.modeLTP, tokens);
  }

  async getInstruments(): Promise<Instrument[]> {
    if (this.instruments.length > 0) return this.instruments;
    const kc = await this.ensureRest();
    const supported = new Set(Object.keys(UNDERLYING_BY_SYMBOL));
    const exchanges = ['NFO', 'BFO']; // NSE + BSE F&O
    const rows: KiteInstrumentRow[] = [];
    for (const ex of exchanges) rows.push(...(await kc.getInstruments(ex)));

    this.instruments = rows
      .filter((r) => supported.has(r.name) && ['FUT', 'CE', 'PE'].includes(r.instrument_type))
      .map((r) => ({
        token: r.instrument_token,
        tradingSymbol: r.tradingsymbol,
        underlying: r.name,
        exchange: r.exchange as Instrument['exchange'],
        instrumentType: r.instrument_type as InstrumentType,
        strike: Number(r.strike) || 0,
        expiry: typeof r.expiry === 'string' ? r.expiry.slice(0, 10) : r.expiry.toISOString().slice(0, 10),
        lotSize: r.lot_size,
        tickSize: r.tick_size,
      }));
    log.info({ count: this.instruments.length }, 'kite instrument master loaded');
    return this.instruments;
  }

  async getReferencePrice(underlying: string): Promise<number> {
    const kc = await this.ensureRest();
    const today = new Date().toISOString().slice(0, 10);
    const fut = this.instruments
      .filter((i) => i.underlying === underlying && i.instrumentType === 'FUT' && i.expiry >= today)
      .sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
    if (!fut) throw new Error(`No future found for ${underlying} to derive reference price`);
    const key = `${fut.exchange}:${fut.tradingSymbol}`;
    const ltp = await kc.getLTP([key]);
    const price = ltp?.[key]?.last_price;
    if (typeof price !== 'number') throw new Error(`Could not fetch LTP for ${key}`);
    return price;
  }
}
