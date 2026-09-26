import type { LegKind, SignalOutcome, Timeframe, TriState } from '@/shared/v2';
import { TIMEFRAME } from '@/shared/v2';

const IST = 330 * 60_000;

export const istClock = (sec: number) => new Date(sec * 1000 + IST).toISOString().slice(11, 16);
export function istStamp(sec: number): string {
  const d = new Date(sec * 1000 + IST);
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${String(d.getUTCDate()).padStart(2, '0')} ${mon} ${d.toISOString().slice(11, 16)}`;
}
export const istStampMs = (ms: number) => istStamp(ms / 1000);
export const istStampIso = (iso: string) => istStamp(Date.parse(iso) / 1000);
export const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() + IST - n * 86_400_000).toISOString().slice(0, 10);
export const minutesToClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const shortDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '';

export function fmtNum(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: digits });
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

export const tfLabel = (tf: Timeframe) => TIMEFRAME[tf].label;

export function candleRange(sec: number, tf: Timeframe): string {
  const m = TIMEFRAME[tf].minutes;
  if (!m) return istStamp(sec).slice(0, 6);
  return `${istStamp(sec)}–${istClock(sec + m * 60)}`;
}

/** Leg colours: FUT sky, CE violet, PE pink (never green / red — those mean direction); SPOT neutral. */
export const LEG_KIND_TEXT: Record<LegKind, string> = { SPOT: 'text-fg', FUT: 'text-leg-fut', CE: 'text-leg-ce', PE: 'text-leg-pe' };

export const TRI_CLASS: Record<TriState, string> = { TRUE: 'text-bull', FALSE: 'text-slate-500', UNKNOWN: 'text-warn' };

export const OUTCOME_LABEL: Record<SignalOutcome, string> = {
  ALERTED: 'Alerted',
  NO_CHANNEL: 'Recorded (no channel)',
  SUPPRESSED_COOLDOWN: 'Suppressed · cooldown',
  SUPPRESSED_ACKNOWLEDGED: 'Suppressed · acknowledged',
  SUPPRESSED_STALE: 'Suppressed · too late',
  SUPPRESSED_BEFORE_ENABLE: 'Suppressed · before switch-on',
};
