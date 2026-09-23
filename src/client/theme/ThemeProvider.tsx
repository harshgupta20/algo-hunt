'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, applyTheme, readStoredTheme, storeTheme, type Theme } from './theme';

interface ThemeValue {
  theme: Theme;
  /** Apply a theme the user picked and remember it on this device. */
  setTheme: (theme: Theme) => void;
  /** Apply a saved preference (e.g. from the server) unless the user already picked one this session. */
  adoptSaved: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The server render and the first client render both use the default, so
  // hydration matches; the layout effect switches to the stored theme before paint.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const userChose = useRef(false);

  useLayoutEffect(() => {
    const stored = readStoredTheme() ?? DEFAULT_THEME;
    // Also restores the attribute after React's dev-only StrictMode remount resets <html>.
    applyTheme(stored);
    setThemeState(stored);
  }, []);

  const commit = useCallback((next: Theme) => {
    applyTheme(next);
    storeTheme(next);
    setThemeState(next);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      userChose.current = true;
      commit(next);
    },
    [commit],
  );

  const adoptSaved = useCallback(
    (saved: Theme) => {
      if (!userChose.current) commit(saved);
    },
    [commit],
  );

  const value = useMemo(() => ({ theme, setTheme, adoptSaved }), [theme, setTheme, adoptSaved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used within ThemeProvider');
  return v;
}
