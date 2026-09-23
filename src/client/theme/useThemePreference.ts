'use client';

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from '@ash/shared';
import { api } from '../lib/api';
import { useTheme } from './ThemeProvider';
import type { Theme } from './theme';

/**
 * Theme control for signed-in pages: applies instantly (and on this device via
 * localStorage) and saves to the user's preferences so it follows them across devices.
 */
export function useThemePreference(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const { theme, setTheme: apply } = useTheme();
  const qc = useQueryClient();

  const setTheme = useCallback(
    (next: Theme) => {
      apply(next);
      void (async () => {
        try {
          const base =
            qc.getQueryData<UserPreferences>(['preferences']) ??
            (await qc.fetchQuery({ queryKey: ['preferences'], queryFn: api.getPreferences }));
          qc.setQueryData(['preferences'], await api.savePreferences({ ...DEFAULT_USER_PREFERENCES, ...base, theme: next }));
        } catch {
          /* keep the local choice; the server copy updates on the next change */
        }
      })();
    },
    [apply, qc],
  );

  return { theme, setTheme };
}

/** Adopts the server-saved theme on load (cross-device), unless the user already chose this session. */
export function ThemePreferenceSync(): null {
  const { adoptSaved } = useTheme();
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: api.getPreferences });
  const saved = prefs.data?.theme;
  useEffect(() => {
    if (saved) adoptSaved(saved);
  }, [saved, adoptSaved]);
  return null;
}
