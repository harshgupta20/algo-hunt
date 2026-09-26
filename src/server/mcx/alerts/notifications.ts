/**
 * MCX V2 delivery: Telegram (Bot API) and Email (Resend HTTP API). Channels
 * are configured by env secrets (TELEGRAM_BOT_TOKEN, RESEND_API_KEY) plus MCX
 * settings (chat id override, recipients, sender). Each delivery attempt is
 * recorded; one channel failing never blocks the other.
 */
import type { ConditionTrace, ExprTrace, McxAlert, McxAlertStatus, McxDelivery, McxSettings } from '@/shared/mcx';
import { MCX2_TIMEFRAME, unitText } from '@/shared/mcx';
import { getConfig } from '../../config/index';
import { childLogger } from '../../utils/logger';

const log = childLogger('mcx-v2-notify');

export type ChannelName = McxDelivery['channel'];

export interface McxChannel {
  readonly name: ChannelName;
  send(message: McxMessage): Promise<void>;
}

export interface McxMessage {
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

export function formatAlert(alert: Omit<McxAlert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'>): McxMessage {
  const e = alert.evaluation;
  const u = alert.unit;
  const tf = MCX2_TIMEFRAME[alert.triggerTimeframe].label;
  const candle = `${istDay(alert.candleTime)} ${istClock(alert.candleTime)} IST`;
  const prices = (['FUT', 'CE', 'PE'] as const)
    .filter((l) => e.prices?.[l] !== undefined)
    .map((l) => `${l} ${fmt(e.prices[l])}`)
    .join(' · ');
  const lines = [
    `🔔 MCX · ${alert.strategyName} (v${alert.version})`,
    unitText(u),
    `${tf} candle ${candle}`,
    prices || undefined,
    '',
    ...leaves(e.trace).map(conditionLine),
  ].filter((x): x is string => x !== undefined);
  const text = lines.join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${lines
    .map((l, idx) => (idx === 0 ? `<h3 style="margin:0 0 8px">${esc(l)}</h3>` : l ? `<div>${esc(l)}</div>` : '<br/>'))
    .join('')}</div>`;
  return { subject: `MCX alert · ${alert.strategyName} · ${unitText(u)}`, text, html };
}

export class TelegramMcxChannel implements McxChannel {
  readonly name = 'telegram' as const;
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async send(m: McxMessage): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, text: m.text, disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export class ResendEmailChannel implements McxChannel {
  readonly name = 'email' as const;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly to: string[],
  ) {}

  async send(m: McxMessage): Promise<void> {
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
  status(settings: McxSettings): ChannelStatus;
  channel(name: ChannelName, settings: McxSettings): McxChannel | null;
}

export const envChannelFactory: ChannelFactory = {
  status(settings) {
    const cfg = getConfig();
    const chat = settings.telegramChatId || cfg.telegramChatId;
    return {
      telegram: {
        configured: Boolean(cfg.telegramBotToken && chat),
        detail: !cfg.telegramBotToken ? 'TELEGRAM_BOT_TOKEN is not set' : !chat ? 'No chat id (set one in MCX settings or TELEGRAM_CHAT_ID)' : `Chat ${chat}`,
      },
      email: {
        configured: Boolean(cfg.resendApiKey && settings.emailRecipients.length),
        detail: !cfg.resendApiKey
          ? 'RESEND_API_KEY is not set'
          : !settings.emailRecipients.length
            ? 'No recipients (add them in MCX settings)'
            : `To ${settings.emailRecipients.join(', ')}`,
      },
    };
  },
  channel(name, settings) {
    const cfg = getConfig();
    if (name === 'telegram') {
      const chat = settings.telegramChatId || cfg.telegramChatId;
      return cfg.telegramBotToken && chat ? new TelegramMcxChannel(cfg.telegramBotToken, chat) : null;
    }
    return cfg.resendApiKey && settings.emailRecipients.length ? new ResendEmailChannel(cfg.resendApiKey, settings.emailFrom, settings.emailRecipients) : null;
  },
};

/** Sends one message over the requested channels; returns per-channel delivery records + overall status. */
export async function deliver(
  factory: ChannelFactory,
  settings: McxSettings,
  wanted: { telegram: boolean; email: boolean },
  message: McxMessage,
  now: () => number = Date.now,
): Promise<{ deliveries: McxDelivery[]; status: McxAlertStatus }> {
  const names = (['telegram', 'email'] as const).filter((n) => wanted[n]);
  const deliveries = await Promise.all(
    names.map(async (name): Promise<McxDelivery> => {
      const ch = factory.channel(name, settings);
      if (!ch) return { channel: name, status: 'failed', error: factory.status(settings)[name].detail, sentAt: new Date(now()).toISOString() };
      try {
        await ch.send(message);
        return { channel: name, status: 'sent', sentAt: new Date(now()).toISOString() };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log.error({ channel: name, err: error }, 'mcx v2 delivery failed');
        return { channel: name, status: 'failed', error, sentAt: new Date(now()).toISOString() };
      }
    }),
  );
  const ok = deliveries.filter((d) => d.status === 'sent').length;
  const status: McxAlertStatus = deliveries.length === 0 || ok === deliveries.length ? 'SENT' : ok === 0 ? 'FAILED' : 'PARTIAL';
  return { deliveries, status };
}
