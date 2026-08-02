import type { Alert } from '@ash/shared';

/** An alert prior to persistence (id is assigned by the repository). */
export type NewAlert = Omit<Alert, 'id'>;

export type NotificationChannel = 'browser' | 'telegram' | 'email' | 'firebase';
export type NotificationStatus = 'sent' | 'failed';

export interface NotificationLog {
  id: string;
  alertId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  error?: string;
  sentAt: string;
}

export type NewNotificationLog = Omit<NotificationLog, 'id' | 'sentAt'>;
