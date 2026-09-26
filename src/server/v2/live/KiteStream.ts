/**
 * Kite Connect WebSocket client for the live worker.
 *
 * Up to 3 sockets × 3000 contracts (Kite's per-API-key limit), full mode (last
 * trade time, volume, OI, exchange time). Each socket reconnects on its own
 * with backoff (1 s → 30 s, forever), resubscribes, and reports which contracts
 * are observed from when — so gaps in the data are always known. A socket with
 * no message for 10 s (Kite sends a heartbeat every second) is recycled.
 */
import type { LiveSocketStatus } from '@/shared/v2';
import { childLogger } from '../../utils/logger';
import { KITE_SOCKETS, KITE_TOKENS_PER_SOCKET } from './plan';
import { parseTicks, type Tick } from './ticks';

const log = childLogger('v2-live-stream');
const KITE_WS = 'wss://ws.kite.trade';
const READ_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
const SUBSCRIBE_CHUNK = 1000;

export interface StreamCredentials {
  apiKey: string;
  accessToken: string;
}

export interface StreamEvents {
  ticks(ticks: Tick[], receivedAt: number): void;
  /** These contracts are delivered from `at` on (subscribed, or socket reconnected). */
  observing(tokens: number[], at: number): void;
  /** These contracts stopped being delivered at `at` (socket down). */
  lost(tokens: number[], at: number): void;
}

export interface TickStream {
  start(credentials: StreamCredentials, events: StreamEvents): void;
  stop(): void;
  setTokens(tokens: number[]): void;
  status(): LiveSocketStatus[];
}

/** The subset of the WHATWG WebSocket the stream uses (Node ≥ 22 global, or the `ws` package). */
export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;

class KiteSocket {
  readonly tokens = new Set<number>();
  private ws: SocketLike | null = null;
  state: LiveSocketStatus['state'] = 'CLOSED';
  lastMessageAt: number | null = null;
  reconnects = 0;
  error?: string;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    readonly id: number,
    private readonly url: string,
    private readonly factory: SocketFactory,
    private readonly events: StreamEvents,
    private readonly now: () => number,
  ) {}

  connect(): void {
    if (this.stopped || this.ws) return;
    this.state = 'CONNECTING';
    let ws: SocketLike;
    try {
      ws = this.factory(this.url);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.state = 'OPEN';
      this.attempt = 0;
      this.error = undefined;
      this.lastMessageAt = this.now();
      this.subscribe([...this.tokens]);
      this.events.observing([...this.tokens], this.now());
      this.watchdog = setInterval(() => {
        if (this.state === 'OPEN' && this.lastMessageAt !== null && this.now() - this.lastMessageAt > READ_TIMEOUT_MS) {
          this.error = 'No data for 10 s — reconnecting';
          this.ws?.close();
          this.onDown();
        }
      }, 2_000);
    };
    ws.onmessage = (ev) => {
      const at = this.now();
      this.lastMessageAt = at;
      if (ev.data instanceof ArrayBuffer) {
        if (ev.data.byteLength > 2) {
          const ticks = parseTicks(ev.data);
          if (ticks.length) this.events.ticks(ticks, at);
        }
      } else if (typeof ev.data === 'string') {
        try {
          const m = JSON.parse(ev.data) as { type?: string; data?: unknown };
          if (m.type === 'error') {
            this.error = String(m.data);
            log.warn({ socket: this.id, error: m.data }, 'kite stream error');
          }
        } catch {
          /* not JSON */
        }
      }
    };
    ws.onerror = () => {
      this.error ??= 'Connection error';
    };
    ws.onclose = () => this.onDown();
  }

  private onDown(): void {
    if (!this.ws) return;
    const wasOpen = this.state === 'OPEN';
    this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
    this.ws = null;
    this.state = 'CLOSED';
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (wasOpen) this.events.lost([...this.tokens], this.now());
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer || this.tokens.size === 0) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++);
    this.reconnects++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(msg));
  }

  private subscribe(tokens: number[]): void {
    for (let i = 0; i < tokens.length; i += SUBSCRIBE_CHUNK) {
      const chunk = tokens.slice(i, i + SUBSCRIBE_CHUNK);
      this.send({ a: 'subscribe', v: chunk });
      this.send({ a: 'mode', v: ['full', chunk] });
    }
  }

  add(tokens: number[]): void {
    const fresh = tokens.filter((t) => !this.tokens.has(t));
    for (const t of fresh) this.tokens.add(t);
    if (!fresh.length) return;
    if (this.state === 'OPEN') {
      this.subscribe(fresh);
      this.events.observing(fresh, this.now());
    } else this.connect();
  }

  remove(tokens: number[]): void {
    const gone = tokens.filter((t) => this.tokens.delete(t));
    for (let i = 0; i < gone.length; i += SUBSCRIBE_CHUNK) this.send({ a: 'unsubscribe', v: gone.slice(i, i + SUBSCRIBE_CHUNK) });
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }
    this.state = 'CLOSED';
  }

  status(): LiveSocketStatus {
    return {
      id: this.id,
      state: this.state,
      tokens: this.tokens.size,
      lastMessageAt: this.lastMessageAt ? new Date(this.lastMessageAt).toISOString() : null,
      reconnects: this.reconnects,
      error: this.error,
    };
  }
}

export class KiteStream implements TickStream {
  private sockets: KiteSocket[] = [];
  private credentials: StreamCredentials | null = null;
  private events: StreamEvents | null = null;
  private wanted = new Set<number>();
  private seq = 0;

  constructor(
    private readonly factory: SocketFactory = defaultFactory,
    private readonly now: () => number = Date.now,
  ) {}

  start(credentials: StreamCredentials, events: StreamEvents): void {
    this.stop();
    this.credentials = credentials;
    this.events = events;
    this.apply();
  }

  stop(): void {
    for (const s of this.sockets) s.stop();
    this.sockets = [];
    this.credentials = null;
  }

  setTokens(tokens: number[]): void {
    this.wanted = new Set(tokens.slice(0, KITE_SOCKETS * KITE_TOKENS_PER_SOCKET));
    this.apply();
  }

  status(): LiveSocketStatus[] {
    return this.sockets.map((s) => s.status());
  }

  private apply(): void {
    if (!this.credentials || !this.events) return;
    // Remove what's no longer wanted, then place new contracts on sockets with room (existing ones stay put).
    for (const s of this.sockets) s.remove([...s.tokens].filter((t) => !this.wanted.has(t)));
    const placed = new Set(this.sockets.flatMap((s) => [...s.tokens]));
    const fresh = [...this.wanted].filter((t) => !placed.has(t));
    while (fresh.length) {
      let s = this.sockets.find((x) => x.tokens.size < KITE_TOKENS_PER_SOCKET);
      if (!s) {
        if (this.sockets.length >= KITE_SOCKETS) break;
        const { apiKey, accessToken } = this.credentials;
        s = new KiteSocket(++this.seq, `${KITE_WS}?api_key=${encodeURIComponent(apiKey)}&access_token=${encodeURIComponent(accessToken)}`, this.factory, this.events, this.now);
        this.sockets.push(s);
      }
      s.add(fresh.splice(0, KITE_TOKENS_PER_SOCKET - s.tokens.size));
    }
    // Close sockets left empty.
    for (const s of this.sockets.filter((x) => x.tokens.size === 0)) s.stop();
    this.sockets = this.sockets.filter((x) => x.tokens.size > 0);
  }
}

const defaultFactory: SocketFactory = (url) => {
  const WS = (globalThis as unknown as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
  if (!WS) throw new Error('This Node.js has no WebSocket — use Node 22 or newer');
  return new WS(url);
};
