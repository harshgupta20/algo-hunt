import type { Alert } from '@ash/shared';

/** An alert prior to persistence (id is assigned by the repository). */
export type NewAlert = Omit<Alert, 'id'>;

export type NotificationChannel = 'browser' | 'telegram' | 'email' | 'firebase';
export type NotificationStatus = 'sent' | 'failed';

export interface NotificationLog {
  id: string;
  alertId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  error?: string;
  sentAt: string;
}

export type NewNotificationLog = Omit<NotificationLog, 'id' | 'sentAt'>;

export type KiteSessionState = 'needs-login' | 'connected' | 'error';

/** Persisted Kite Connect session (token decrypted by the auth service, never here). */
export interface KiteSessionRecord {
  /** Encrypted access token (base64 iv.tag.ciphertext). */
  accessTokenEnc?: string;
  kiteUserId?: string;
  userName?: string;
  loginTime?: string;
  /** Kite tokens are invalidated at ~06:00 IST the next day. */
  expiresAt?: string;
  state: KiteSessionState;
  lastError?: string;
  updatedAt?: string;
}

/** Per-leg RSI reading stored with a monitor snapshot. */
export interface MonitorLegSnapshot {
  /** Provisional RSI including the still-forming candle (for gauges). */
  rsi: number | null;
  /** RSI as of the last CLOSED candle (what strategy decisions use). */
  closedRsi: number | null;
  ltp: number | null;
  level: number;
}

export interface MonitorSnapshot {
  legs: Record<'future' | 'call' | 'put', MonitorLegSnapshot>;
  /** Epoch ms of the last closed candle seen. */
  lastClosedBucket: number | null;
  /** Epoch ms when the evaluator produced this snapshot. */
  evaluatedAt: number;
}

export interface MonitorState {
  configId: string;
  strike: number;
  expiry: string;
  triplet: import('@ash/shared').InstrumentTriplet;
  activatedAt: string;
  /** Epoch ms of the last closed candle evaluated (dedupe across runs). */
  lastBucket: number | null;
  snapshot: MonitorSnapshot | null;
  lastError: string | null;
  updatedAt?: string;
}
