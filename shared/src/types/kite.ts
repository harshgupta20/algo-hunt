/**
 * Kite Connect authentication status, surfaced to the client so it can show a
 * "Connect Kite" login prompt and drive the OAuth-style flow.
 */
export type KiteAuthState = 'disabled' | 'needs-login' | 'connecting' | 'connected' | 'error';

export interface KiteAuthStatus {
  /** True when MARKET_PROVIDER=kite (a broker login is relevant). */
  enabled: boolean;
  state: KiteAuthState;
  /** True when the user must (re)log in to Kite. */
  needsLogin: boolean;
  lastError?: string;
}
