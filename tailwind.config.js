/**
 * Theme colors are CSS variables (RGB channels) defined per theme in
 * src/app/globals.css, so every utility — including opacity modifiers like
 * `border-ink-700/60` — follows the active `data-theme` on <html>.
 */
const themed = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (prefix, steps) => Object.fromEntries(steps.map((s) => [s, themed(`${prefix}-${s}`)]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Surfaces: 950 = page, 900 = cards/sidebar, 850 = inputs, 800 = subtle fills, 700/600 = borders.
        ink: scale('ink', [950, 900, 850, 800, 700, 600]),
        // Text scale; light theme inverts it so `text-slate-200` stays "primary text" in both themes.
        slate: scale('slate', [100, 200, 300, 400, 500, 600, 700, 800, 900]),
        // Strongest foreground (headings): white on dark, near-black on light.
        fg: themed('fg'),
        accent: {
          DEFAULT: themed('accent'),
          soft: themed('accent-soft'),
        },
        // Direction: green = bullish / up, red = bearish / down. Amber = needs attention.
        bull: themed('bull'),
        bear: themed('bear'),
        warn: themed('warn'),
        // Leg identity (Future / Call / Put) — deliberately not green/red.
        leg: {
          fut: themed('leg-fut'),
          ce: themed('leg-ce'),
          pe: themed('leg-pe'),
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
