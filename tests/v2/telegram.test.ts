/**
 * Alerts to several Telegram chats: each chat is sent to (and succeeds or fails) on its own, deliveries
 * are recorded per chat, older single-chat settings carry over, and chat ids are validated.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { V2Settings } from '../../src/shared/v2';
import { DEFAULT_V2_SETTINGS, settingsFromStored, settingsSchema } from '../../src/shared/v2';
import { TelegramChannel, deliver, telegramChats, type ChannelFactory } from '../../src/server/v2/alerts/notifications';

const message = { subject: 's', text: 'NIFTY alert', html: '<p>NIFTY alert</p>' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Telegram to several chats', () => {
  it('sends to every chat; one failing chat does not stop the others', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const { chat_id } = JSON.parse(init.body) as { chat_id: string };
        calls.push(chat_id);
        return chat_id === '222'
          ? new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const ch = new TelegramChannel('token', [{ id: '111', name: 'Rahul' }, { id: '222', name: 'Trader' }, { id: '-1001234567890' }]);
    const results = await ch.send(message);
    expect(calls.sort()).toEqual(['-1001234567890', '111', '222']);
    expect(results).toEqual([
      { target: 'Rahul (111)' },
      { target: 'Trader (222)', error: expect.stringMatching(/chat not found — this person must open the bot in Telegram and press Start/) },
      { target: '-1001234567890' },
    ]);
  });

  it('records one delivery per chat and marks a partly delivered alert', async () => {
    const factory: ChannelFactory = {
      status: () => ({ telegram: { configured: true, detail: '' }, email: { configured: false, detail: 'off' } }),
      channel: (name) => (name === 'telegram' ? { name, send: async () => [{ target: 'A' }, { target: 'B', error: 'blocked' }] } : null),
    };
    const out = await deliver(factory, DEFAULT_V2_SETTINGS, { telegram: true, email: false }, message, () => 0);
    expect(out.deliveries.map((d) => [d.target, d.status])).toEqual([
      ['A', 'sent'],
      ['B', 'failed'],
    ]);
    expect(out.status).toBe('PARTIAL');
  });

  it('uses the settings list, else TELEGRAM_CHAT_ID (comma-separated)', () => {
    vi.stubEnv('TELEGRAM_CHAT_ID', '111, 222');
    const fromEnv = telegramChats(DEFAULT_V2_SETTINGS);
    expect(fromEnv).toEqual({ chats: [{ id: '111' }, { id: '222' }], source: 'env' });
    const s: V2Settings = { ...DEFAULT_V2_SETTINGS, telegramChats: [{ id: '333', name: 'Desk' }] };
    expect(telegramChats(s)).toEqual({ chats: [{ id: '333', name: 'Desk' }], source: 'settings' });
  });

  it('carries an older single chat id over and validates chat ids', () => {
    expect(settingsFromStored({ telegramChatId: '555', requestBudget: 200 })).toMatchObject({ telegramChats: [{ id: '555' }], requestBudget: 200 });
    expect(settingsFromStored(undefined).telegramChats).toEqual([]);
    const base = { emailRecipients: [], emailFrom: 'Algo Hunt <a@b.co>', requestBudget: 150 };
    expect(settingsSchema.safeParse({ ...base, telegramChats: [{ id: '123456789' }, { id: '-1001234567890', name: 'Desk' }, { id: '@mychannel' }] }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...base, telegramChats: [{ id: 'not-a-chat' }] }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, telegramChats: [{ id: '111' }, { id: '111' }] }).success).toBe(false);
  });
});
