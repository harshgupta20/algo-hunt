/** Per-user UI preferences (stored server-side so they follow you across devices). */
export interface UserPreferences {
  theme: 'dark' | 'light';
  soundEnabled: boolean;
  /** Keep ringing the alert tune until it's stopped (up to 90 s). */
  soundRepeat: boolean;
  browserNotifications: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'light',
  soundEnabled: true,
  soundRepeat: true,
  browserNotifications: true,
};
