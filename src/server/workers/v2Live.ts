/**
 * V2 live worker process — keep it running while you want live alerts:
 *
 *   npm run live             stream Kite ticks, evaluate at every candle close, alert
 *   npm run live -- --check  connect to the Kite stream, print a few NIFTY 50 ticks, exit (no database writes)
 *   npm run live -- --force  take over from another worker that still looks alive
 *
 * Uses the same .env (DATABASE_URL, KITE_*, TELEGRAM_*, RESEND_*) and Kite login as the app:
 * log in once each morning in the app (Settings → Broker Connection) and the worker picks it up.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Same .env loading as scripts/migrate.mjs: .env.local wins over .env, real env vars win over both.
for (const file of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}

const args = new Set(process.argv.slice(2));
const { PgAppStore } = await import('../db/appStore');
const { KiteAuthService } = await import('../services/kite/kiteAuth');
const { KiteHistoricalProvider } = await import('../services/kite/KiteHistoricalProvider');
const { KiteStream, createV2LiveWorker, kiteLiveSession } = await import('../v2');
const { getPool } = await import('../db/pool');

const kiteAuth = new KiteAuthService(new PgAppStore());
const istTime = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(11, 19);

if (args.has('--check')) {
  const creds = await kiteLiveSession(kiteAuth).credentials();
  if (!creds) {
    console.error('✗ Kite is not logged in — log in from the app (Settings → Broker Connection), then run this again.');
    process.exit(1);
  }
  const NIFTY_50 = 256_265;
  const stream = new KiteStream();
  let ticks = 0;
  const finish = (code: number, text: string) => {
    console.log(text);
    stream.stop();
    void getPool().end();
    process.exit(code);
  };
  stream.start(creds, {
    observing: (tokens, at) => console.log(`✓ Connected to the Kite stream at ${istTime(at)} IST, subscribed to ${tokens.length} contract(s)`),
    lost: (_t, at) => console.log(`… connection dropped at ${istTime(at)} IST — retrying`),
    ticks: (list, at) => {
      for (const t of list) console.log(`  NIFTY 50 ${t.price.toFixed(2)}  (exchange ${t.exchangeTime ? istTime(t.exchangeTime) : '—'}, received ${istTime(at)} IST)`);
      if ((ticks += list.length) >= 5) finish(0, '✓ Live ticks are flowing — `npm run live` is ready.');
    },
  });
  stream.setTokens([NIFTY_50]);
  setTimeout(() => {
    const s = stream.status()[0];
    if (ticks > 0) finish(0, `✓ Received ${ticks} tick(s) (markets closed? Kite sends one snapshot outside market hours).`);
    else finish(1, `✗ No ticks in 20 s — socket ${s?.state ?? 'not opened'}${s?.error ? `: ${s.error}` : ''}.`);
  }, 20_000);
} else {
  const worker = createV2LiveWorker({ kiteAuth, historical: new KiteHistoricalProvider(kiteAuth) });
  try {
    await worker.start({ force: args.has('--force') });
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    await getPool().end();
    process.exit(1);
  }
  console.log(`V2 live worker ${worker.id.slice(0, 8)} started — Ctrl+C to stop.`);

  // One status line a minute (and on every state change).
  let last = '';
  const line = () => {
    const s = worker.status();
    const c = s.lastCandles[0];
    const candle = c ? ` · last ${c.market} ${c.timeframe} ${istTime(c.candle * 1000).slice(0, 5)}: ${c.units} unit(s) in ${(c.evaluatedMs / 1000).toFixed(1)} s, ${c.checked} checked on Kite, ${c.alerts} alert(s)` : '';
    return `[${istTime(Date.now())}] ${s.state} — ${s.detail} · ${s.contracts.subscribed} contracts · ${s.ticks.perSecond} ticks/s${candle}`;
  };
  let lastPrintAt = 0;
  setInterval(() => {
    const text = line();
    const state = text.split(' — ')[0]!.split('] ')[1];
    if (state !== last || Date.now() - lastPrintAt >= 60_000) {
      console.log(text);
      last = state ?? '';
      lastPrintAt = Date.now();
    }
  }, 5_000);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping…');
    await worker.stop();
    await getPool().end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('unhandledRejection', (err) => console.error('unhandled:', err));
}
