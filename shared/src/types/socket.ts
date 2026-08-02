/**
 * WebSocket event contracts between the server (socket.io) and the client.
 */
import type { Alert } from './alert.js';
import type { Leg, Timeframe } from './market.js';

/** Live provider connection status. */
export type ProviderStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

/** Per-leg live RSI reading pushed to the dashboard gauges. */
export type LegRsiSnapshot = Record<Leg, { rsi: number | null; level: number }>;

/** Live RSI update for one active configuration. */
export interface RsiUpdatePayload {
  configId: string;
  underlying: string;
  timeframe: Timeframe;
  strike: number;
  bucket: number;
  legs: LegRsiSnapshot;
}

/** Snapshot of one active configuration's runtime (for the dashboard/API). */
export interface ConfigRuntimeSnapshot {
  configId: string;
  underlying: string;
  timeframe: Timeframe;
  strike: number;
  expiry: string;
  legs: LegRsiSnapshot;
}

/** Events emitted by the server to clients. */
export interface ServerToClientEvents {
  'alert:new': (alert: Alert) => void;
  'rsi:update': (payload: RsiUpdatePayload) => void;
  'status:provider': (status: ProviderStatus) => void;
}

/** Events emitted by clients to the server. */
export interface ClientToServerEvents {
  'subscribe:config': (configId: string) => void;
  'unsubscribe:config': (configId: string) => void;
}

export const SOCKET_NAMESPACE = '/live';
