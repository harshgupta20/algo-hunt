/** Rupee formatting for paper trading (Indian digit grouping). */
export const inr = (n: number, digits = 2) => `₹${Math.abs(n) < 1e-9 ? '0' : n.toLocaleString('en-IN', { maximumFractionDigits: digits })}`.replace('₹-', '−₹');
export const signedInr = (n: number) => (n > 0 ? `+${inr(n)}` : n < 0 ? `−${inr(-n)}` : '₹0');
/** Profit up (green) / loss down (red) / flat. */
export const pnlClass = (n: number | null | undefined) => (n === null || n === undefined || Math.abs(n) < 0.005 ? 'text-slate-400' : n > 0 ? 'text-bull' : 'text-bear');
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`);
