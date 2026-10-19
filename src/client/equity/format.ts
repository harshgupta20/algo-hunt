/** Formatting for the Equity screens (Indian digit grouping, IST dates). */
export const inr = (n: number | null | undefined, digits = 2) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `₹${Math.abs(n) < 1e-9 ? '0' : n.toLocaleString('en-IN', { maximumFractionDigits: digits })}`.replace('₹-', '−₹');
};
export const signedInr = (n: number, digits = 0) => (n > 0 ? `+${inr(n, digits)}` : n < 0 ? `−${inr(-n, digits)}` : '₹0');
/** Profit up (green) / loss down (red) / flat. */
export const pnlClass = (n: number | null | undefined) => (n === null || n === undefined || Math.abs(n) < 0.005 ? 'text-slate-400' : n > 0 ? 'text-bull' : 'text-bear');
export const pct = (n: number | null | undefined, digits = 1) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const text = Math.abs(n).toFixed(digits);
  // No sign on values that round to zero (never "−0.0%").
  return Number(text) === 0 ? `${text}%` : `${n > 0 ? '+' : '−'}${text}%`;
};
export const num = (n: number | null | undefined, digits = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: digits }));

const IST_MS = 5.5 * 3600_000;
export const istToday = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
export const yearsAgo = (n: number) => {
  const d = new Date(Date.now() + IST_MS);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
};
/** "12 Mar 2025" from yyyy-mm-dd. */
export const shortDate = (date: string | null | undefined) => (date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};
export const duration = (seconds: number) => {
  const m = Math.round(seconds / 60);
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
export const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n${Math.random().toString(36).slice(2)}`);

/** CSV download of rows. */
export function downloadCsv(name: string, head: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [head, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
