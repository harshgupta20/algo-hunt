/**
 * Fans a triggered alert out to notification channels and records a log entry
 * per channel. v1 ships the browser channel (live push over WebSocket); the
 * Telegram/Email/Firebase channels are stubs kept behind the same interface so
 * the roadmap items slot in without touching callers.
 */
import type { Alert } from '@ash/shared';
import type { DataStore } from '../../db/index.js';
import type { NotificationChannel as ChannelName } from '../../db/types.js';
import { childLogger } from '../../utils/logger.js';
import type { WsHub } from './wsHub.js';

const log = childLogger('notification');

export interface NotificationChannel {
  readonly name: ChannelName;
  send(alert: Alert): Promise<void>;
}

/** Pushes the alert to connected dashboards over the WebSocket hub. */
export class BrowserChannel implements NotificationChannel {
  readonly name = 'browser' as const;
  constructor(private readonly hub: WsHub) {}
  async send(alert: Alert): Promise<void> {
    this.hub.broadcastAlert(alert);
  }
}

export class NotificationService {
  private readonly channels: NotificationChannel[];

  constructor(
    private readonly store: DataStore,
    channels: NotificationChannel[],
  ) {
    this.channels = channels;
  }

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
