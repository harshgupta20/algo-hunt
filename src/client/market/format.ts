/** Number and time formatting for the market view (Indian grouping, ₹ crore, signed %, IST). */

const MINUS = '−';

export function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 1,23,456 (no decimals). */
export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-IN');
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = Math.abs(v).toFixed(digits);
  return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${s}%`;
}

export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** ₹ value → "₹1,234 Cr" / "₹56 L". */
export function fmtRupees(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toLocaleString('en-IN', { maximumFractionDigits: a >= 1e9 ? 0 : 1 })} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`;
  return `${sign}₹${a.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** Already in crore → "₹5,285 Cr" with sign. */
export function fmtCrore(v: number | null | undefined, signed = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = signed ? (v > 0 ? '+' : v < 0 ? MINUS : '') : v < 0 ? MINUS : '';
  return `${sign}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
}

/** Contracts / shares → 1.2 Cr, 34.5 L, 12.3K. */
export function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : '';
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(a)}`;
}

const IST = 330 * 60_000;

export function istTime(ms: number, seconds = false): string {
  return new Date(ms + IST).toISOString().slice(11, seconds ? 19 : 16);
}

export function istToday(): string {
  return new Date(Date.now() + IST).toISOString().slice(0, 10);
}

/** "12 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "2026-10-17" → "Fri 17 Oct" (or Today / Tomorrow). */
export function dayLabel(date: string, today = istToday()): string {
  if (date === today) return 'Today';
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (date === tomorrow) return 'Tomorrow';
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const shortDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Direction class for a signed number (green up / red down — direction only). */
export const dirClass = (v: number | null | undefined) => (!v ? 'text-slate-400' : v > 0 ? 'text-bull' : 'text-bear');
export const arrow = (v: number | null | undefined) => (!v ? '•' : v > 0 ? '▲' : '▼');
