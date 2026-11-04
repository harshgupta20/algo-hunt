/**
 * The app's look, separate from light / dark: `fresh` (the default since 2026-11-05 — a white top navigation, flat
 * bordered panels, gridded tables: a clean trading-terminal style) or `classic` (the earlier brand-blue header with
 * the sidebar, kept as an option in Settings → Appearance). It lives in `data-look` on <html>;
 * src/app/fresh-look.css restyles the app under `[data-look='fresh']`, and the shell renders both layouts, hiding the
 * other one with `.look-classic` / `.look-fresh` — so switching is instant and never re-mounts a page.
 * Remembered in this browser.
 */
export type Look = 'classic' | 'fresh';

export const DEFAULT_LOOK: Look = 'fresh';
export const LOOK_STORAGE_KEY = 'algo-hunt.look';

/** Runs in <head> before the first paint (like the theme script), so a stored look never flashes the other one. */
export const LOOK_INIT_SCRIPT = `(function(){try{var l=localStorage.getItem(${JSON.stringify(LOOK_STORAGE_KEY)});if(l==="fresh"||l==="classic")document.documentElement.setAttribute("data-look",l)}catch(e){}})()`;

export function setLook(look: Look): void {
  document.documentElement.setAttribute('data-look', look);
  try {
    localStorage.setItem(LOOK_STORAGE_KEY, look);
  } catch {
    /* storage unavailable (private mode) — the look still applies on this page */
  }
}

export function readStoredLook(): Look {
  try {
    const l = localStorage.getItem(LOOK_STORAGE_KEY);
    return l === 'fresh' || l === 'classic' ? l : DEFAULT_LOOK;
  } catch {
    return DEFAULT_LOOK;
  }
}
