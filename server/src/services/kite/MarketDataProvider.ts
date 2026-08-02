/**
 * Broker-agnostic market-data contract. The worker depends only on this
 * interface, so swapping the mock feed for live Kite (or another broker later)
 * is a configuration change, not a code change.
 */
import { EventEmitter } from 'node:events';
import type { Instrument, ProviderStatus, Tick } from '@ash/shared';

export interface MarketDataProvider {
  /** Human-readable provider name, e.g. "mock" or "kite". */
  readonly name: string;

  /** Establish the underlying connection (WebSocket, generator, etc.). */
  connect(): Promise<void>;
  /** Tear down the connection. */
  disconnect(): Promise<void>;

  /** Subscribe to live ticks for the given instrument tokens. */
  subscribe(tokens: number[]): void;
  /** Stop receiving ticks for the given tokens. */
  unsubscribe(tokens: number[]): void;

  /** Register a tick handler. */
  onTick(handler: (tick: Tick) => void): void;
  /** Register a connection-status handler. */
  onStatus(handler: (status: ProviderStatus) => void): void;

  /** Load (and cache) the instrument master. */
  getInstruments(): Promise<Instrument[]>;

  /**
   * A reference price for an underlying, used to compute the ATM strike at
   * configuration activation (mock: seeded base price; kite: futures LTP).
   */
  getReferencePrice(underlying: string): Promise<number>;
}

/**
 * Shared EventEmitter-backed base with the tick/status plumbing so concrete
 * providers only implement transport + instrument details.
 */
export abstract class BaseMarketDataProvider extends EventEmitter implements MarketDataProvider {
  abstract readonly name: string;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract subscribe(tokens: number[]): void;
  abstract unsubscribe(tokens: number[]): void;
  abstract getInstruments(): Promise<Instrument[]>;
  abstract getReferencePrice(underlying: string): Promise<number>;

  onTick(handler: (tick: Tick) => void): void {
    this.on('tick', handler);
  }

  onStatus(handler: (status: ProviderStatus) => void): void {
    this.on('status', handler);
  }

  protected emitTick(tick: Tick): void {
    this.emit('tick', tick);
  }

  protected emitStatus(status: ProviderStatus): void {
    this.emit('status', status);
  }
}
