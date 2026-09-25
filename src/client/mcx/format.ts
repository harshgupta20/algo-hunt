import type { McxInstrument, McxTimeframe, SignalOutcome, TriState } from '@/shared/mcx';
import { MCX2_TIMEFRAME } from '@/shared/mcx';

const IST = 330 * 60_000;

/** "10:45" IST from epoch seconds. */
export const istClock = (sec: number) => new Date(sec * 1000 + IST).toISOString().slice(11, 16);
/** "07 Oct 10:45" IST from epoch seconds. */
export function istStamp(sec: number): string {
  const d = new Date(sec * 1000 + IST);
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${String(d.getUTCDate()).padStart(2, '0')} ${mon} ${d.toISOString().slice(11, 16)}`;
}
export const istStampMs = (ms: number) => istStamp(ms / 1000);
export const istStampIso = (iso: string) => istStamp(Date.parse(iso) / 1000);
export const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
export const minutesToClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function fmtNum(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: digits });
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

export const tfLabel = (tf: McxTimeframe) => MCX2_TIMEFRAME[tf].label;

export function candleRange(sec: number, tf: McxTimeframe): string {
  const m = MCX2_TIMEFRAME[tf].minutes;
  if (!m) return istStamp(sec).slice(0, 6);
  return `${istStamp(sec)}–${istClock(sec + m * 60)}`;
}

/** Leg identity color (never green/red): FUT sky, CE violet, PE pink. */
export function legClass(i: Pick<McxInstrument, 'instrumentType' | 'optionType'>): string {
  if (i.instrumentType === 'MCX_FUTURE') return 'text-leg-fut';
  return i.optionType === 'CE' ? 'text-leg-ce' : 'text-leg-pe';
}
export function legShort(i: Pick<McxInstrument, 'instrumentType' | 'optionType'>): string {
  return i.instrumentType === 'MCX_FUTURE' ? 'FUT' : (i.optionType ?? 'OPT');
}

/** "GOLD 26 Oct 75100 CE" */
export function instrumentLabel(i: McxInstrument): string {
  const exp = i.expiry ? new Date(`${i.expiry}T00:00:00Z`).toLocaleString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '';
  return i.instrumentType === 'MCX_FUTURE' ? `${i.underlying} ${exp} FUT` : `${i.underlying} ${exp} ${i.strike} ${i.optionType}`;
}

export const TRI_CLASS: Record<TriState, string> = { TRUE: 'text-bull', FALSE: 'text-slate-500', UNKNOWN: 'text-warn' };
export const TRI_LABEL: Record<TriState, string> = { TRUE: 'True', FALSE: 'False', UNKNOWN: 'Unknown' };

export const OUTCOME_LABEL: Record<SignalOutcome, string> = {
  ALERTED: 'Alerted',
  NO_CHANNEL: 'Recorded (no channel)',
  SUPPRESSED_COOLDOWN: 'Suppressed · cooldown',
  SUPPRESSED_ACKNOWLEDGED: 'Suppressed · acknowledged',
  SUPPRESSED_STALE: 'Suppressed · too late',
  SUPPRESSED_BEFORE_ENABLE: 'Suppressed · before enable',
};
