/** Per-user UI preferences (stored server-side so they follow you across devices). */
export interface UserPreferences {
  theme: 'dark' | 'light';
  soundEnabled: boolean;
  browserNotifications: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'light',
  soundEnabled: true,
  browserNotifications: true,
};
