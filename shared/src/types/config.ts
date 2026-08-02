/**
 * Alert configuration types — what the user sets up in the Configuration panel.
 */
import type { Timeframe } from './market.js';
import type { RsiSyncParams, StrategyKey } from './strategy.js';

/** Expiry selection modes offered in the UI. */
export type ExpiryType = 'current-weekly' | 'next-weekly' | 'monthly';

/**
 * Strike selection relative to ATM. ATM is the default and the only mode
 * fully exercised in v1; the offsets and custom strike are wired for later.
 */
export type StrikeSelection =
  | 'ATM'
  | 'ATM+1'
  | 'ATM-1'
  | 'ATM+2'
  | 'ATM-2'
  | 'CUSTOM';

/** A saved, possibly-active monitoring configuration. */
export interface AlertConfiguration {
  id: string;
  underlying: string;
  expiryType: ExpiryType;
  /** Concrete resolved expiry date (yyyy-mm-dd), filled on activation. */
  expiryDate?: string;
  strikeSelection: StrikeSelection;
  /** Explicit strike when strikeSelection is CUSTOM. */
  customStrike?: number;
  timeframe: Timeframe;
  /** Built-in strategy key ('rsi-sync') or a custom strategy id. */
  strategy: StrategyKey | string;
  params: RsiSyncParams;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload accepted when creating/updating a configuration. */
export interface AlertConfigurationInput {
  underlying: string;
  expiryType: ExpiryType;
  strikeSelection: StrikeSelection;
  customStrike?: number;
  timeframe: Timeframe;
  strategy: StrategyKey | string;
  params?: Partial<RsiSyncParams>;
}

/** User-level UI/notification preferences. */
export interface UserPreferences {
  theme: 'dark' | 'light';
  soundEnabled: boolean;
  browserNotifications: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'dark',
  soundEnabled: true,
  browserNotifications: true,
};
