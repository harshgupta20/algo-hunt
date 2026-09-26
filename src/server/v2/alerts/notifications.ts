/**
 * V2 delivery: Telegram (Bot API) and Email (Resend HTTP API). Channels are
 * configured by env secrets (TELEGRAM_BOT_TOKEN, RESEND_API_KEY) plus V2
 * settings (chat id override, recipients, sender). Each delivery attempt is
 * recorded; one channel failing never blocks the other.
 */
import type { AlertStatus, ConditionTrace, Delivery, ExprTrace, LegDef, V2Alert, V2Settings } from '@/shared/v2';
import { TIMEFRAME, legName, unitText } from '@/shared/v2';
import { getConfig } from '../../config/index';
import { childLogger } from '../../utils/logger';

const log = childLogger('v2-notify');

export type ChannelName = Delivery['channel'];

export interface Channel {
  readonly name: ChannelName;
  send(message: Message): Promise<void>;
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
  const lines = [
    `🔔 ${alert.strategyName} (v${alert.version})`,
    `${ctx.productName} · ${unitText(alert.unit, ctx.productSymbol)}`,
    `${tf} candle ${candle}`,
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

export class TelegramChannel implements Channel {
  readonly name = 'telegram' as const;
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async send(m: Message): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, text: m.text, disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
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
    const chat = settings.telegramChatId || cfg.telegramChatId;
    return {
      telegram: {
        configured: Boolean(cfg.telegramBotToken && chat),
        detail: !cfg.telegramBotToken ? 'TELEGRAM_BOT_TOKEN is not set' : !chat ? 'No chat id (set one in V2 → Settings or TELEGRAM_CHAT_ID)' : `Chat ${chat}`,
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
      const chat = settings.telegramChatId || cfg.telegramChatId;
      return cfg.telegramBotToken && chat ? new TelegramChannel(cfg.telegramBotToken, chat) : null;
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
    names.map(async (name): Promise<Delivery> => {
      const ch = factory.channel(name, settings);
      if (!ch) return { channel: name, status: 'failed', error: factory.status(settings)[name].detail, sentAt: new Date(now()).toISOString() };
      try {
        await ch.send(message);
        return { channel: name, status: 'sent', sentAt: new Date(now()).toISOString() };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log.error({ channel: name, err: error }, 'v2 delivery failed');
        return { channel: name, status: 'failed', error, sentAt: new Date(now()).toISOString() };
      }
    }),
  );
  const ok = deliveries.filter((d) => d.status === 'sent').length;
  const status: AlertStatus = deliveries.length === 0 || ok === deliveries.length ? 'SENT' : ok === 0 ? 'FAILED' : 'PARTIAL';
  return { deliveries, status };
}
