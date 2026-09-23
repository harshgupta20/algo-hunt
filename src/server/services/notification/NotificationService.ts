/**
 * Fans a triggered alert out to delivery channels and records a log entry per
 * channel. The dashboard picks alerts up by polling (browser notification +
 * chime happen client-side); server-side channels deliver even when no
 * dashboard is open. Telegram is enabled by TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
 */
import type { Alert } from '@ash/shared';
import { getConfig } from '../../config/index';
import type { DataStore } from '../../db/store';
import type { NotificationChannel as ChannelName } from '../../db/types';
import { childLogger } from '../../utils/logger';

const log = childLogger('notification');

export interface NotificationChannel {
  readonly name: ChannelName;
  send(alert: Alert): Promise<void>;
}

function describe(alert: Alert): string {
  const s = alert.snapshot;
  const lines = [
    `🔔 ${alert.title}`,
    `${alert.underlying} ${alert.strike} · ${alert.timeframe} · exp ${alert.expiry}`,
    alert.scenario ? `Scenario ${alert.scenario}` : alert.variant ? `Variant: ${alert.variant}` : undefined,
    alert.strategy === 'rsi-sync'
      ? `RSI  FUT ${s.futureRsi} · CE ${s.callRsi} · PE ${s.putRsi}`
      : alert.conditions?.map((c) => `• ${c.text}`).join('\n'),
    new Date(alert.triggeredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Sends the alert to a Telegram chat via the Bot API. */
export class TelegramChannel implements NotificationChannel {
  readonly name = 'telegram' as const;
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async send(alert: Alert): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, text: describe(alert), disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Channels enabled by the environment. */
export function channelsFromConfig(): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  const tg = getConfig().telegram;
  if (tg) channels.push(new TelegramChannel(tg.botToken, tg.chatId));
  return channels;
}

export class NotificationService {
  constructor(
    private readonly store: DataStore,
    private readonly channels: NotificationChannel[],
  ) {}

  /** Deliver an alert across all channels, logging each outcome. */
  async notify(alert: Alert): Promise<void> {
    await Promise.all(
      this.channels.map(async (channel) => {
        try {
          await channel.send(alert);
          await this.store.notifications.insert({ alertId: alert.id, channel: channel.name, status: 'sent' });
        } catch (err) {
          log.error({ err, channel: channel.name, alertId: alert.id }, 'notification channel failed');
          await this.store.notifications.insert({
            alertId: alert.id,
            channel: channel.name,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }
}
