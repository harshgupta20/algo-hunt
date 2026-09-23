/**
 * Chart chrome colors per theme (chart libraries take literal colors, not CSS
 * classes). Series colors (future/call/put, scenarios) are identical in both
 * themes so a line means the same thing everywhere.
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
  },
};

export function useChartPalette(): ChartPalette {
  return PALETTES[useTheme().theme];
}
