/**
 * Theme primitives shared by the root layout (pre-paint script) and the client.
 * The active theme lives in `data-theme` on <html>; colors are CSS variables
 * defined in src/app/globals.css.
 */
export type Theme = 'light' | 'dark';

export const DEFAULT_THEME: Theme = 'light';
export const THEME_STORAGE_KEY = 'theme';

/** Browser-UI tint (mobile address bar) per theme — matches `--ink-950`. */
export const THEME_COLOR: Record<Theme, string> = { light: '#f3f5f9', dark: '#0a0e17' };

/**
 * Runs synchronously in <head> while the HTML is parsed, so a stored dark theme
 * is applied before the first paint (no light flash). Mirrors applyTheme().
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export function readStoredTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    return t === 'dark' || t === 'light' ? t : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode) — the theme still applies for this page */
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}
