/**
 * Optional: daily candles straight from Kite (the app's real source) for the "kite" verification profile.
 *   npx tsx scripts/equity-verify/kite-fetch.ts [SYMBOL ...]
 * Uses the app's stored Kite session (log in to Kite in the app first) and its .env; READ-ONLY, ~2 requests a
 * second, full history (Kite serves ~1,900 days a request). Writes $EQUITY_VERIFY_DIR/kdata/<SYMBOL>.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_END, fileOf } from './cases';

for (const file of ['.env.local', '.env']) if (fs.existsSync(file)) process.loadEnvFile(file);

// Large caps, heavily split / bonus-adjusted stocks (rounded history), recent listings and illiquid small caps
// (zero-volume days, circuit locks, bad ticks).
const DEFAULT = ['BAJFINANCE', 'TATASTEEL', 'ADANIENT', 'MARUTI', 'HDFCBANK', 'INFY', 'RELIANCE', 'ITC', 'LTF', 'IDEA', 'M&M', 'BAJAJ-AUTO', 'VIVIDHA', 'GILLANDERS', 'SOMATEX', 'WORTHPERI'];
const DAY = 86_400_000;

async function main() {
  const { getPool } = await import('../../src/server/db/pool');
  const { requireKiteCredentials } = await import('../../src/server/config/index');
  const { decryptToken } = await import('../../src/server/services/kite/tokenCrypto');
  const symbols = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
  const out = path.join(process.env.EQUITY_VERIFY_DIR || path.join(os.homedir(), '.cache', 'algo-hunt-verify'), 'kdata');
  fs.mkdirSync(out, { recursive: true });
  const { apiKey, apiSecret } = requireKiteCredentials();
  const pool = getPool();
  const row = (await pool.query<{ access_token: string | null; state: string }>('SELECT access_token, state FROM kite_session WHERE id = 1')).rows[0];
  await pool.end();
  const token = row?.access_token && row.state === 'connected' ? decryptToken(row.access_token, apiSecret) : undefined;
  if (!token) throw new Error('Kite isn’t logged in — log in to Kite in the app, then run this again.');
  const instruments = JSON.parse(fs.readFileSync('data/equity-instruments.json', 'utf8')) as { stocks: Array<{ symbol: string; token: number }> };
  for (const symbol of symbols) {
    const instrument = instruments.stocks.find((s) => s.symbol === symbol);
    if (!instrument) {
      console.error(`  ${symbol}: not in Kite's NSE stock list`);
      continue;
    }
    const rows = new Map<string, [number, number, number, number, number]>();
    for (let start = Date.parse('2000-01-01'); start <= Date.parse(DATA_END); start += 1900 * DAY) {
      const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const url = `https://api.kite.trade/instruments/historical/${instrument.token}/day?from=${iso(start)}+00:00:00&to=${iso(Math.min(start + 1899 * DAY, Date.parse(DATA_END)))}+23:59:59`;
      const res = await fetch(url, { headers: { 'X-Kite-Version': '3', Authorization: `token ${apiKey}:${token}` } });
      const j = (await res.json()) as { status: string; message?: string; data?: { candles: Array<[string, number, number, number, number, number]> } };
      if (j.status !== 'success') throw new Error(`${symbol}: Kite says ${j.message ?? res.status}`);
      for (const [d, o, h, l, c, v] of j.data!.candles) rows.set(d.slice(0, 10), [o, h, l, c, v]);
      await new Promise((r) => setTimeout(r, 550));
    }
    const dates = [...rows.keys()].filter((d) => d <= DATA_END).sort();
    const col = (k: number) => dates.map((d) => rows.get(d)![k]!);
    fs.writeFileSync(fileOf(out, symbol), JSON.stringify({ symbol, date: dates, open: col(0), high: col(1), low: col(2), close: col(3), volume: col(4) }));
    console.log(`  ${symbol}: ${dates.length} candles ${dates[0] ?? ''} → ${dates.at(-1) ?? ''}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
