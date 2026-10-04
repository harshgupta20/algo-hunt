/**
 * Live checks for the setup wizard: each credential is tried for real before the trader moves on — the database
 * answers, the Telegram bot exists (and can message the chat), the Resend key is accepted, Kite knows the API key.
 * Kite's secret can only be proved by logging in: it gets a format check, and the first Kite login confirms it.
 */
import pg from 'pg';

export interface Check {
  ok: boolean;
  /** One line for the wizard. */
  message: string;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function checkDatabase(url: string): Promise<Check> {
  const link = url.trim();
  if (!/^postgres(ql)?:\/\//i.test(link)) return { ok: false, message: 'That isn’t a database link — it starts with postgresql:// (copy it from Neon → Connect).' };
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(link);
  const client = new pg.Client({
    connectionString: link.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, '$1verify-full'),
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    const v = (await client.query('SELECT version() AS v')).rows[0]?.v as string | undefined;
    const tables = Number((await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'v2_strategies'`)).rows[0]?.n ?? 0);
    const name = v?.match(/PostgreSQL [\d.]+/)?.[0] ?? 'PostgreSQL';
    return { ok: true, message: `Connected — ${name}${/neon\.tech/i.test(link) ? ' on Neon' : ''}${tables ? ' · existing Algo Hunt data found' : ' · empty, ready to set up'}` };
  } catch (err) {
    const m = msg(err);
    if (/ENOTFOUND|getaddrinfo/i.test(m)) return { ok: false, message: 'Can’t find that server — check the link (or the internet connection).' };
    if (/password authentication failed/i.test(m)) return { ok: false, message: 'The database refused the password in the link — copy the link again from Neon.' };
    if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(m)) return { ok: false, message: 'No answer from the database — check the internet connection and try again.' };
    if (/does not exist/i.test(m)) return { ok: false, message: `The database in the link doesn’t exist (${m}).` };
    return { ok: false, message: `Couldn’t connect: ${m}` };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function checkKite(key: string, secret: string): Promise<Check> {
  const k = key.trim();
  const s = secret.trim();
  if (!/^[a-z0-9]{6,40}$/i.test(k)) return { ok: false, message: 'The API key is letters and numbers only (from your app on developers.kite.trade).' };
  if (!/^[a-z0-9]{16,64}$/i.test(s)) return { ok: false, message: 'The API secret is a long code of letters and numbers (press “Show API secret” on your Kite app page).' };
  if (k === s) return { ok: false, message: 'The key and the secret are different codes.' };
  // Kite's login page answers an unknown key with HTTP 400 {"message":"Invalid `api_key`."}.
  try {
    const res = await fetch(`https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(k)}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (res.status === 400 && /api_key/i.test(await res.text())) return { ok: false, message: 'Kite doesn’t know this API key — copy it again from your app on developers.kite.trade.' };
    return { ok: true, message: 'Kite knows this API key — the secret is confirmed at your first Kite login.' };
  } catch {
    return { ok: true, message: 'Looks right — Kite confirms them when you log in at the end.' }; // Kite unreachable: format only
  }
}

export async function checkTelegram(token: string, chatId?: string): Promise<Check> {
  const t = token.trim();
  if (!/^\d{5,}:[\w-]{30,}$/.test(t)) return { ok: false, message: 'A bot token looks like 123456789:AA… (from @BotFather, or your admin).' };
  try {
    const me = (await (await fetch(`https://api.telegram.org/bot${t}/getMe`, { signal: AbortSignal.timeout(15_000) })).json()) as { ok: boolean; result?: { username?: string } };
    if (!me.ok) return { ok: false, message: 'Telegram doesn’t know this bot token — check it.' };
    const bot = `@${me.result?.username ?? 'bot'}`;
    if (!chatId?.trim()) return { ok: true, message: `Bot ${bot} found — add the people who get alerts in the app (Settings → Telegram chats).` };
    const sent = (await (
      await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim(), text: '✅ Algo Hunt is connected — alerts will arrive here.' }),
        signal: AbortSignal.timeout(15_000),
      })
    ).json()) as { ok: boolean; description?: string };
    return sent.ok ? { ok: true, message: `Bot ${bot} sent a test message — check Telegram.` } : { ok: false, message: `Bot ${bot} found, but the message failed: ${sent.description ?? 'unknown chat'} (open the bot and press Start first).` };
  } catch (err) {
    return { ok: false, message: `Couldn’t reach Telegram: ${msg(err)}` };
  }
}

export async function checkResend(key: string): Promise<Check> {
  const k = key.trim();
  if (!/^re_[\w-]{10,}$/.test(k)) return { ok: false, message: 'A Resend key starts with re_.' };
  try {
    const res = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Resend refused this key.' };
    return { ok: true, message: 'Resend accepted the key — set who gets emails in the app (Settings).' };
  } catch (err) {
    return { ok: false, message: `Couldn’t reach Resend: ${msg(err)}` };
  }
}
