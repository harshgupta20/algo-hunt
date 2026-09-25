/**
 * Chart colors per theme (chart libraries take literal colors, not CSS
 * classes). Mirrors the CSS variables in globals.css and the color language in
 * lib/signals.ts: bull/bear for direction, legs for Future/Call/Put identity.
 */
import { useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/theme';

export interface ChartPalette {
  /** Canvas background (matches the card surface). */
  background: string;
  text: string;
  axis: string;
  axisLine: string;
  grid: string;
  border: string;
  tooltip: { background: string; border: string; borderRadius: number; color: string };
  /** Hover band behind a bar. */
  cursor: string;
  bull: string;
  bear: string;
  /** Non-directional series (counts, volumes of activity). */
  series: string;
  seriesSoft: string;
  legs: { future: string; call: string; put: string };
}

const PALETTES: Record<Theme, ChartPalette> = {
  light: {
    background: '#ffffff',
    text: '#475569',
    axis: '#64748b',
    axisLine: '#cbd5e1',
    grid: '#eef2f7',
    border: '#e2e8f0',
    tooltip: { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#0f172a' },
    cursor: '#e2e8f080',
    bull: '#16a34a',
    bear: '#dc2626',
    series: '#2563eb',
    seriesSoft: '#93c5fd',
    legs: { future: '#0284c7', call: '#7c3aed', put: '#db2777' },
  },
  dark: {
    background: '#0e1420',
    text: '#94a3b8',
    axis: '#64748b',
    axisLine: '#2e3a52',
    grid: '#1a2233',
    border: '#222c40',
    tooltip: { background: '#131a28', border: '1px solid #2e3a52', borderRadius: 8, color: '#e2e8f0' },
    cursor: '#1a223333',
    bull: '#22c55e',
    bear: '#ef4444',
    series: '#3b82f6',
    seriesSoft: '#60a5fa',
    legs: { future: '#38bdf8', call: '#a78bfa', put: '#f472b6' },
  },
};

export function useChartPalette(): ChartPalette {
  return PALETTES[useTheme().theme];
}
