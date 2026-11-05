import { redirect } from 'next/navigation';

/**
 * The Options section was merged into Futures & Options → Backtest (2026-11-05): one backtest that reads NSE / BSE
 * contracts from Upstox and the index / stock from Kite. Old links (and their ?strategy= / Upstox login result)
 * land there.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams({ tab: 'backtest' });
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string' && ['strategy', 'upstox', 'message'].includes(k)) q.set(k, v);
  redirect(`/v2?${q.toString()}`);
}
