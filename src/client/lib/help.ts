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
    equity: {
      title: 'Equity — stock strategies',
      body: 'Strategies for NSE cash stocks, separate from F&O: a dedicated builder (with your trader’s templates), backtests over years with your money (pyramiding, charges, CAGR, drawdown vs NIFTY 50), a screener for today’s signals, and watchlists.',
    },
    options: {
      title: 'Options — expired contracts',
      body: 'Backtest your V2 strategies on option and futures contracts as they were listed, expired ones included (from Upstox): at every candle the expiry of that day and the strike nearest the index are re-picked, each contract with its own lot size.',
      note: 'Needs an Upstox login (Upstox Plus). NSE and BSE products, about six months back.',
    },
    market: {
      title: 'Market — eagle view',
      body: 'The whole Indian market on one page: indices, breadth, sectors, a map of every Nifty 500 stock, movers, F&O positioning, FII / DII money, the world, news and the results calendar.',
    },
    settings: { title: 'Settings', body: 'Zerodha Kite connection, theme and desktop notifications.' },
    collapse: { title: 'Collapse sidebar', body: 'Shrink the sidebar to icons for more room. Hover an icon to see where it goes; your choice is remembered in this browser.' },
    expand: { title: 'Expand sidebar', body: 'Show the sidebar with its labels again.' },
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
      body: 'The live worker (inside the app) is streaming: switched-on connections are checked seconds after each candle closes, and alerts are verified on Kite’s candles.',
    },
    scanner: {
      title: 'Scanner',
      body: 'The live worker isn’t running, so switched-on connections are checked by the per-minute scanner (alerts can be a few minutes late).',
      note: 'It starts with the app (`npm start`) for instant, verified alerts — see V2 → Dashboard → Live feed.',
    },
    connecting: { title: 'Connecting', body: 'Loading market and Kite status…' },
    savesWaiting: {
      title: 'Not saved yet',
      body: 'The database can’t be reached right now, so the app holds these records (alerts, deliveries, paper trades) and saves them automatically when it’s back — also after a restart. Alerts keep going out meanwhile.',
    },
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
    lookFresh: {
      title: 'New look',
      body: 'Switch to the new look: navigation across the top (more room for tables), white bordered panels, gridded tables with plain-case headings. Same screens, same data.',
      note: 'Settings → Appearance switches between the two. Remembered in this browser; light / dark works in both.',
    },
  },

  alarm: {
    view: { title: 'View alerts', body: 'Stop the alarm and open V2 → Alerts.' },
    stop: { title: 'Stop', body: 'Silence the alarm and close this card. The alerts stay in V2 → Alerts.' },
    play: { title: 'Play sound', body: 'Your browser blocked the sound because the page hasn’t been clicked yet — press to hear the alarm (sound works from now on).' },
  },

  /** Column filters and sorting — the same in every table of the app. */
  table: {
    sort: {
      title: 'Sort by this column',
      body: 'First click: biggest / newest first (A → Z for words). Second click: the other way. Third click: back to the original order.',
    },
    filter: {
      title: 'Filter this column',
      body: 'Pick values, search text, a number range, dates, time of day or weekdays — the table updates as you choose. Filters on several columns combine.',
      note: 'A highlighted funnel means this column is filtering the table.',
    },
    sortUp: { title: 'Sort ascending', body: 'Smallest, oldest or A first. Click again to stop sorting by it.' },
    sortDown: { title: 'Sort descending', body: 'Biggest, newest or Z first. Click again to stop sorting by it.' },
    contains: { title: 'Contains', body: 'Show only rows whose value contains this text (any case). It also narrows the value list below.' },
    find: { title: 'Find a value', body: 'Narrow the list of values below. It doesn’t filter the table by itself — tick values for that.' },
    values: {
      title: 'Pick values',
      body: 'Tick values to show only those rows — or hide them, with “Hide”. Nothing ticked = every value.',
      note: 'The number is how many rows have that value with the other columns’ filters applied.',
    },
    showOnly: { title: 'Show only', body: 'Show only rows with a ticked value.' },
    hide: { title: 'Hide', body: 'Hide rows with a ticked value; everything else stays.' },
    pickAll: { title: 'Tick all listed', body: 'Tick every value in the list (the ones matching your search, if any).' },
    pickNone: { title: 'Untick all', body: 'Untick every value — the column shows every value again.' },
    op: { title: 'Comparison', body: 'How to compare: equal to, not equal to, more than, at least, less than, at most, or between two values (both included).' },
    num: { title: 'Value', body: 'Type a number in the unit the column shows (₹, %, minutes …). Leave it empty for no limit.' },
    above0: { title: 'Above 0', body: 'Only rows with a positive value — e.g. winning trades for a P&L column.' },
    below0: { title: 'Below 0', body: 'Only rows with a negative value — e.g. losing trades for a P&L column.' },
    from: { title: 'From day', body: 'First day to include (IST).' },
    to: { title: 'To day', body: 'Last day to include (IST).' },
    timeFrom: { title: 'From time', body: 'Earliest time of day to include (IST), on every day — e.g. 09:15 for the opening.' },
    timeTo: { title: 'To time', body: 'Latest time of day to include (IST), on every day — e.g. 15:30 for the close.' },
    weekday: { title: 'Weekday', body: 'Only these days of the week (IST) — e.g. expiry days. Nothing ticked = every day.' },
    blanks: { title: 'Blank values', body: 'Rows with no value in this column (shown as —): keep them, hide them, or show only them.' },
    clearColumn: { title: 'Clear this column', body: 'Remove this column’s filters (the sort stays).' },
    done: { title: 'Done', body: 'Close this panel — the filter stays on. Esc or a click outside also closes it.' },
    summary: { title: 'Column filters on', body: 'How many rows the column filters (funnels in the headers) leave. ✕ on a chip removes that filter.' },
    chip: { title: 'Remove this filter', body: 'Take this column filter off.' },
    clearAll: { title: 'Clear column filters', body: 'Remove every column filter of this table. The filter bar above it, if there is one, stays as it is.' },
    partial: {
      title: 'Only loaded rows are searched',
      body: 'This list arrives a page at a time; the column filters search the rows loaded so far. Load more to search older ones.',
      note: 'The filter bar above the list (period, strategy, product …) searches everything on the server.',
    },
    noMatch: { title: 'No rows match', body: 'Every row is hidden by the column filters. Clear them, or open a funnel to loosen one.' },
  },

  settings: {
    connect: { title: 'Connect Kite', body: 'Log in to Zerodha Kite; you’re returned here automatically.' },
    reconnect: { title: 'Reconnect', body: 'Log in again to refresh the session (e.g. after switching Kite accounts).' },
    disconnect: {
      title: 'Disconnect',
      body: 'Revoke the Kite session at Zerodha and remove it from the server.',
      note: 'Scanning and the live worker pause until you connect again.',
    },
    browserNotifications: {
      title: 'Browser notifications',
      body: 'Show a desktop notification for each new V2 alert while the app is open. It stays on screen until you dismiss it; clicking it opens the app and stops the alarm.',
    },
    sound: { title: 'Alert tune', body: 'Play a loud alarm tune the moment a V2 alert arrives, with a flashing alert card and tab title.' },
    soundRepeat: {
      title: 'Repeat until I stop it',
      body: 'Keep ringing every 6 seconds until you press Stop, open the alerts or acknowledge — at most 90 seconds. Off = ring once.',
    },
    darkTheme: { title: 'Dark theme', body: 'Light is the default. The choice is saved to your account.' },
    classicLook: {
      title: 'Classic look',
      body: 'The earlier look: a blue header with the sections in a sidebar on the left. Off = the new look, with the sections across the top and more room for tables.',
      note: 'Remembered in this browser. Light / dark works with both.',
    },
    testNotification: { title: 'Test notification', body: 'Send a sample desktop notification to check permissions.' },
    testSound: { title: 'Test alert', body: 'Ring the alarm exactly as a real alert would (tune, alert card, tab title) so you can check the volume. Press Stop to end it.', note: 'Browsers only allow sound after you have clicked on the page once.' },
    alertChannels: { title: 'Telegram & email', body: 'Where V2 alerts are delivered (chat id, recipients, test messages) — set in V2 → Settings.' },
  },
} as const satisfies Record<string, Record<string, Help | Record<string, Help>>>;
