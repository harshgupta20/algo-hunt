/**
 * Zerodha Kite Connect authentication status, surfaced to the client so it can
 * show a "Connect Kite" login prompt and drive the OAuth-style flow.
 */
export type KiteAuthState = 'disabled' | 'needs-login' | 'connecting' | 'connected' | 'error';

export interface KiteAuthStatus {
  /** False when KITE_API_KEY / KITE_API_SECRET are not configured on the server. */
  enabled: boolean;
  state: KiteAuthState;
  /** True when the user must (re)log in to Kite. */
  needsLogin: boolean;
  lastError?: string;
  /** Kite account of the active session. */
  userId?: string;
  userName?: string;
  loginTime?: string;
  /** When the daily access token stops working (~06:00 IST next day). */
  expiresAt?: string;
}
