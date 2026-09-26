/**
 * Tooltips for the app shell (sidebar, top bar, Settings) — what each control
 * and indicator is and does. V2's own tooltips live in src/client/v2/help.ts.
 */
import type { TooltipContent } from '../components/Tooltip';

type Help = TooltipContent;

export const HELP = {
  nav: {
    v2: {
      title: 'V2 — Strategy + Product = Alert',
      body: 'Build a strategy once without choosing a product, then connect it to any NSE index, NSE stock or MCX commodity to get alerts. Compare shows which products the strategy fires on.',
    },
    settings: { title: 'Settings', body: 'Zerodha Kite connection, theme and desktop notifications.' },
  },

  topbar: {
    kiteOffline: { title: 'Kite offline', body: 'No valid Zerodha Kite session, so no market data. Click Connect Kite to log in.' },
    nseMarket: { title: 'NSE/BSE', body: 'Indices, stocks and their F&O (NIFTY, BANKNIFTY, SENSEX, RELIANCE…). Session 09:15–15:30 IST, weekdays.' },
    mcxMarket: {
      title: 'MCX',
      body: 'Commodity F&O (Gold, Silver, Crude Oil…). Session 09:00–23:30 IST (23:55 while the US is on standard time), weekdays.',
    },
    liveWorker: {
      title: 'Live feed',
      body: 'The live worker (`npm run live`) is streaming: switched-on connections are checked seconds after each candle closes, and alerts are verified on Kite’s candles.',
    },
    scanner: {
      title: 'Scanner',
      body: 'The live worker isn’t running, so switched-on connections are checked by the per-minute scanner (alerts can be a few minutes late).',
      note: 'Run `npm run live` on your computer for instant, verified alerts — see V2 → Dashboard → Live feed.',
    },
    connecting: { title: 'Connecting', body: 'Loading market and Kite status…' },
    connectKite: {
      title: 'Connect Kite',
      body: 'Log in to Zerodha Kite. You’ll return here automatically and live data resumes.',
      note: 'Kite resets access tokens every morning (~6:00 AM IST), so this is needed once per trading day.',
    },
    notificationsOn: { title: 'Browser notifications on', body: 'A desktop notification pops up whenever a V2 alert fires (while this app is open).' },
    notificationsOff: { title: 'Enable notifications', body: 'Ask the browser for permission to show a desktop notification for every new V2 alert.' },
    toDark: { title: 'Dark theme', body: 'Switch to the dark theme. Your choice is saved and follows you to other devices.' },
    toLight: { title: 'Light theme', body: 'Switch to the light theme. Your choice is saved and follows you to other devices.' },
    signOut: { title: 'Sign out', body: 'End this browser session. Scanning and the live worker keep running.' },
  },

  settings: {
    connect: { title: 'Connect Kite', body: 'Log in to Zerodha Kite; you’re returned here automatically.' },
    reconnect: { title: 'Reconnect', body: 'Log in again to refresh the session (e.g. after switching Kite accounts).' },
    disconnect: {
      title: 'Disconnect',
      body: 'Revoke the Kite session at Zerodha and remove it from the server.',
      note: 'Scanning and the live worker pause until you connect again.',
    },
    browserNotifications: { title: 'Browser notifications', body: 'Show a desktop notification for each new V2 alert while the app is open.' },
    sound: { title: 'Sound alert', body: 'Play a short chime for each new V2 alert.' },
    darkTheme: { title: 'Dark theme', body: 'Light is the default. The choice is saved to your account.' },
    testNotification: { title: 'Test notification', body: 'Send a sample desktop notification to check permissions.' },
    testSound: { title: 'Test sound', body: 'Play the alert chime.' },
    alertChannels: { title: 'Telegram & email', body: 'Where V2 alerts are delivered (chat id, recipients, test messages) — set in V2 → Settings.' },
  },
} as const satisfies Record<string, Record<string, Help | Record<string, Help>>>;
