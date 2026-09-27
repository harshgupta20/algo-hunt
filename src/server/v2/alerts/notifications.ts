/**
 * V2 delivery: Telegram (Bot API) and Email (Resend HTTP API). Channels are
 * configured by env secrets (TELEGRAM_BOT_TOKEN, RESEND_API_KEY) plus V2
 * settings (chat id override, recipients, sender). Each delivery attempt is
 * recorded; one channel failing never blocks the other.
 */
import type { AlertStatus, ConditionTrace, Delivery, EvaluationSource, ExprTrace, LegDef, TelegramChat, V2Alert, V2Settings } from '@/shared/v2';
import { TIMEFRAME, legName, unitText } from '@/shared/v2';
import { getConfig } from '../../config/index';
import { childLogger } from '../../utils/logger';

const log = childLogger('v2-notify');

export type ChannelName = Delivery['channel'];

/** One recipient's outcome (a channel with several recipients reports each). */
export interface SendResult {
  target?: string;
  error?: string;
}

export interface Channel {
  readonly name: ChannelName;
  /** Resolves with per-recipient results (or nothing when the whole send succeeded); throws when nothing was sent. */
  send(message: Message): Promise<SendResult[] | void>;
}

export interface Message {
  subject: string;
  text: string;
  html: string;
}

export interface ChannelStatus {
  telegram: { configured: boolean; detail: string };
  email: { configured: boolean; detail: string };
}

const fmt = (v: number | undefined) =>
  v === undefined ? '—' : Math.abs(v) >= 1000 ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(Math.round(v * 100) / 100);

const istClock = (sec: number) => new Date(sec * 1000 + 330 * 60_000).toISOString().slice(11, 16);
const istDay = (sec: number) => new Date(sec * 1000 + 330 * 60_000).toISOString().slice(0, 10);

function leaves(t: ExprTrace, out: ConditionTrace[] = []): ConditionTrace[] {
  if (t.condition) out.push(t.condition);
  t.children?.forEach((c) => leaves(c, out));
  return out;
}

function conditionLine(c: ConditionTrace): string {
  const mark = c.result === 'TRUE' ? '✅' : c.result === 'FALSE' ? '❌' : '❔';
  if (c.kind === 'PATTERN') return `${mark} ${c.text}`;
  const l = c.left;
  const r = c.right;
  const cross = c.operator === 'CROSSED_ABOVE' || c.operator === 'CROSSED_BELOW';
  const lv = l ? (cross ? `${fmt(l.prev)} → ${fmt(l.value)}` : fmt(l.value)) : '';
  const rv = r ? (r.label === String(r.value) ? '' : ` vs ${cross ? `${fmt(r.prev)} → ${fmt(r.value)}` : fmt(r.value)}`) : '';
  return `${mark} ${c.text}  (${lv}${rv})`;
}

/** How the candles behind an alert were checked (none for Kite's own historical candles). */
const SOURCE_LINE: Record<EvaluationSource, string | null> = {
  HISTORICAL: null,
  LIVE_VERIFIED: '✓ Verified on Kite candles',
  LIVE_UNVERIFIED: '⚠ Not verified — Kite candles were unavailable; decided on live data',
  LIVE: 'Live (forming candle)',
};

export function formatAlert(
  alert: Omit<V2Alert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'>,
  ctx: { productSymbol: string; productName: string; legs: LegDef[] },
): Message {
  const e = alert.evaluation;
  const tf = TIMEFRAME[alert.triggerTimeframe].label;
  const candle = `${istDay(alert.candleTime)} ${istClock(alert.candleTime)} IST`;
  const legLines = ctx.legs.map((l) => {
    const inst = alert.unit.legs[l.id];
    const price = e.prices?.[l.id];
    return `${legName(l)}: ${inst?.symbol ?? '—'}${price !== undefined ? ` @ ${fmt(price)}` : ''}`;
  });
  const source = SOURCE_LINE[e.source ?? 'HISTORICAL'];
  const lines = [
    `🔔 ${alert.strategyName} (v${alert.version})`,
    `${ctx.productName} · ${unitText(alert.unit, ctx.productSymbol)}`,
    `${tf} candle ${candle}`,
    ...(source ? [source] : []),
    ...legLines,
    '',
    ...leaves(e.trace).map(conditionLine),
  ];
  const text = lines.join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${lines
    .map((l, idx) => (idx === 0 ? `<h3 style="margin:0 0 8px">${esc(l)}</h3>` : l ? `<div>${esc(l)}</div>` : '<br/>'))
    .join('')}</div>`;
  return { subject: `Alert · ${alert.strategyName} · ${ctx.productSymbol}`, text, html };
}

const chatLabel = (c: TelegramChat) => (c.name ? `${c.name} (${c.id})` : c.id);

/** Telegram's error text → what to do about it. */
function telegramHint(status: number, body: string): string {
  const d = (() => {
    try {
      return (JSON.parse(body) as { description?: string }).description ?? body;
    } catch {
      return body;
    }
  })().slice(0, 160);
  if (/chat not found/i.test(d)) return `${d} — this person must open the bot in Telegram and press Start (for a group, add the bot to it)`;
  if (/blocked by the user/i.test(d)) return `${d} — they blocked the bot; they must unblock it`;
  if (/not enough rights|kicked/i.test(d)) return `${d} — add the bot back to the group / channel`;
  return `Telegram API ${status}: ${d}`;
}

/** Sends every message to all configured chats; each chat succeeds or fails on its own. */
export class TelegramChannel implements Channel {
  readonly name = 'telegram' as const;
  constructor(
    private readonly botToken: string,
    private readonly chats: TelegramChat[],
  ) {}

  async send(m: Message): Promise<SendResult[]> {
    return Promise.all(
      this.chats.map(async (c): Promise<SendResult> => {
        try {
          const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: c.id, text: m.text, disable_web_page_preview: true }),
          });
          if (!res.ok) return { target: chatLabel(c), error: telegramHint(res.status, await res.text()) };
          return { target: chatLabel(c) };
        } catch (err) {
          return { target: chatLabel(c), error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
  }
}

/** Chats that recently messaged the bot (or added it to a group) — for picking chat ids. */
export async function recentTelegramChats(botToken: string): Promise<Array<{ id: string; name: string; type: string; username?: string }>> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100&allowed_updates=${encodeURIComponent('["message","channel_post","my_chat_member"]')}`);
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: Array<Record<string, { chat?: Record<string, unknown> } | undefined>> };
  if (!res.ok || !body.ok) throw new Error(`Telegram: ${body.description ?? res.status}${/webhook/i.test(body.description ?? '') ? ' (this bot uses a webhook, so recent chats can’t be listed — enter the chat id by hand)' : ''}`);
  const out = new Map<string, { id: string; name: string; type: string; username?: string }>();
  for (const u of body.result ?? []) {
    for (const k of ['message', 'channel_post', 'my_chat_member', 'edited_message']) {
      const chat = u[k]?.chat as { id?: number; title?: string; first_name?: string; last_name?: string; username?: string; type?: string } | undefined;
      if (!chat?.id) continue;
      const name = chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || (chat.username ? `@${chat.username}` : String(chat.id)));
      out.set(String(chat.id), { id: String(chat.id), name, type: chat.type ?? 'private', username: chat.username });
    }
  }
  return [...out.values()].reverse();
}

/** Telegram chats in effect: the V2 settings list, else TELEGRAM_CHAT_ID (comma-separated allowed). */
export function telegramChats(settings: V2Settings): { chats: TelegramChat[]; source: 'settings' | 'env' | 'none' } {
  if (settings.telegramChats.length) return { chats: settings.telegramChats, source: 'settings' };
  const env = (getConfig().telegramChatId ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((id) => ({ id }));
  return { chats: env, source: env.length ? 'env' : 'none' };
}

export class ResendEmailChannel implements Channel {
  readonly name = 'email' as const;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly to: string[],
  ) {}

  async send(m: Message): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ from: this.from, to: this.to, subject: m.subject, text: m.text, html: m.html }),
    });
    if (!res.ok) throw new Error(`Resend API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Builds channels from env secrets + MCX settings. */
export interface ChannelFactory {
  status(settings: V2Settings): ChannelStatus;
  channel(name: ChannelName, settings: V2Settings): Channel | null;
}

export const envChannelFactory: ChannelFactory = {
  status(settings) {
    const cfg = getConfig();
    const { chats, source } = telegramChats(settings);
    return {
      telegram: {
        configured: Boolean(cfg.telegramBotToken && chats.length),
        detail: !cfg.telegramBotToken
          ? 'TELEGRAM_BOT_TOKEN is not set'
          : !chats.length
            ? 'No chat yet — add one in V2 → Settings (or TELEGRAM_CHAT_ID)'
            : `${chats.length} chat${chats.length === 1 ? '' : 's'}${source === 'env' ? ' from TELEGRAM_CHAT_ID' : ''}: ${chats.map((c) => c.name ?? c.id).join(', ')}`,
      },
      email: {
        configured: Boolean(cfg.resendApiKey && settings.emailRecipients.length),
        detail: !cfg.resendApiKey
          ? 'RESEND_API_KEY is not set'
          : !settings.emailRecipients.length
            ? 'No recipients (add them in V2 → Settings)'
            : `To ${settings.emailRecipients.join(', ')}`,
      },
    };
  },
  channel(name, settings) {
    const cfg = getConfig();
    if (name === 'telegram') {
      const { chats } = telegramChats(settings);
      return cfg.telegramBotToken && chats.length ? new TelegramChannel(cfg.telegramBotToken, chats) : null;
    }
    return cfg.resendApiKey && settings.emailRecipients.length ? new ResendEmailChannel(cfg.resendApiKey, settings.emailFrom, settings.emailRecipients) : null;
  },
};

/** Sends one message over the requested channels; returns per-channel delivery records + overall status. */
export async function deliver(
  factory: ChannelFactory,
  settings: V2Settings,
  wanted: { telegram: boolean; email: boolean },
  message: Message,
  now: () => number = Date.now,
): Promise<{ deliveries: Delivery[]; status: AlertStatus }> {
  const names = (['telegram', 'email'] as const).filter((n) => wanted[n]);
  const deliveries = await Promise.all(
    names.map(async (name): Promise<Delivery | Delivery[]> => {
      const ch = factory.channel(name, settings);
      if (!ch) return { channel: name, status: 'failed', error: factory.status(settings)[name].detail, sentAt: new Date(now()).toISOString() };
      try {
        const results = (await ch.send(message)) ?? [{}];
        return results.map((r): Delivery => {
          if (r.error) log.error({ channel: name, target: r.target, err: r.error }, 'v2 delivery failed');
          return { channel: name, target: r.target, status: r.error ? 'failed' : 'sent', error: r.error, sentAt: new Date(now()).toISOString() };
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log.error({ channel: name, err: error }, 'v2 delivery failed');
        return { channel: name, status: 'failed', error, sentAt: new Date(now()).toISOString() };
      }
    }),
  ).then((l) => l.flat());
  const ok = deliveries.filter((d) => d.status === 'sent').length;
  const status: AlertStatus = deliveries.length === 0 || ok === deliveries.length ? 'SENT' : ok === 0 ? 'FAILED' : 'PARTIAL';
  return { deliveries, status };
}
