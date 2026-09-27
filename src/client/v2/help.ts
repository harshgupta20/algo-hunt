/**
 * Tooltip content for every V2 control, badge and icon (rich tooltips, never native title=).
 */
import type { TooltipContent } from '../components/Tooltip';

export const H = {
  nav: {
    title: 'V2 — Strategy + Product = Alert',
    body: 'Build a strategy once without choosing a product, then connect it to any NSE index, NSE stock or MCX commodity to get alerts. Compare shows which products the strategy fires on.',
  },
  tabs: {
    dashboard: { title: 'Dashboard', body: 'Markets, data connection, scanner health and active alerts at a glance.' },
    strategies: { title: 'Strategies', body: 'Your strategies — pure logic with 1–4 legs (Spot, Future, Call, Put) and conditions. No product is chosen here.' },
    connections: { title: 'Connections', body: 'Connect a strategy to products (NIFTY, RELIANCE, GOLD…) with an expiry, strike positions and alert settings. Each connection switches on and off by itself.' },
    compare: { title: 'Compare', body: 'Run one strategy over past candles on many products and see where it would have alerted — to pick the products that suit it.' },
    alerts: { title: 'Alerts', body: 'Active alerts (acknowledge them), the full history and every signal, including suppressed ones.' },
    products: { title: 'Products', body: 'Everything you can connect to: NSE indices, NSE stocks and MCX commodities, with the legs each offers.' },
    scanner: { title: 'Scanner', body: 'Every scanner cycle: what was due, candle requests used, alerts and errors.' },
    settings: { title: 'Settings', body: 'Telegram / Email destinations, the request budget and the NSE / MCX holiday calendars.' },
  } satisfies Record<string, TooltipContent>,

  live: {
    card: {
      title: 'Live feed',
      body: 'The live worker streams Kite ticks for every contract your switched-on connections use and checks each connection the moment its candle closes (seconds, not minutes).',
      note: 'Run it on your computer with `npm run live`. While it streams, the per-minute scanner only backs it up.',
    },
    state: {
      title: 'Worker state',
      body: 'LIVE: streaming and checking at every close. Warming up: loading candle history (results are checked on Kite candles meanwhile). Degraded: stream disconnected, reconnecting — the backup scanner covers. Waiting for login: log in to Kite in Settings.',
    },
    offline: {
      title: 'Worker offline',
      body: 'No heartbeat from the live worker. The per-minute backup scanner checks your connections instead (alerts can be a few minutes late).',
      note: 'Start it with `npm run live` and keep the computer awake during market hours.',
    },
    contracts: {
      title: 'Contracts streamed',
      body: 'Contracts in use (every leg at the current ATM, plus the price that sets ATM) and nearby strikes kept warm (2 either side) so an ATM move switches instantly.',
      note: 'Kite allows 9,000 per login (3 connections × 3,000).',
    },
    stream: { title: 'Kite stream', body: 'Open WebSocket connections to Kite and the ticks per second arriving. Each reconnects by itself; a gap is re-checked on Kite candles.' },
    today: {
      title: 'Accuracy today',
      body: 'Checked: results re-checked on Kite’s official candles before deciding — every alert, near-threshold calls that could matter, and data with gaps. Corrected: Kite’s candles changed the live result. Unverified: Kite’s candles didn’t arrive within 2 minutes, so it was decided on live data.',
    },
    candles: { title: 'Recent candle closes', body: 'Each trigger candle the worker processed: units checked, how fast after the close every unit was decided, and how many were re-checked on Kite candles.' },
    decided: { title: 'Decided in', body: 'Seconds from the candle close until every unit had a result on live candles.' },
    verified: { title: 'Kite check done', body: 'Seconds from the candle close until the last re-check on Kite candles finished (alerts go out as each one is confirmed).' },
    uncovered: { title: 'Not streamed', body: 'These connections don’t fit Kite’s 9,000-contract limit — the backup scanner checks them every minute instead.' },
    errors: { title: 'Recent problems', body: 'The worker keeps going after an error; the latest are listed here.' },
    notRunning: {
      title: 'Live worker not running',
      body: 'Run `npm run live` in the project folder for instant, verified alerts. Until then the per-minute scanner checks your connections.',
    },
  } satisfies Record<string, TooltipContent>,

  status: {
    nse: { title: 'NSE / BSE session', body: 'Weekdays 09:15–15:30 IST. Holidays come from Settings → Calendar.' },
    mcx: { title: 'MCX session', body: 'Weekdays 09:00 until 23:30 (US summer) or 23:55 (US winter) IST. Holidays come from Settings → Calendar.' },
    kite: { title: 'Kite connection', body: 'Candles and prices come from Zerodha Kite. Without a session nothing can be evaluated.', note: 'Log in from Settings → Broker Connection.' },
    products: { title: 'Products', body: 'Products in the catalogue, from the synced instrument list. Refreshed automatically once a day while connections are on.' },
    strategies: { title: 'Strategies', body: 'Product-agnostic strategies you have built.' },
    connections: { title: 'Connections', body: 'Strategy → product links that are switched on (and in total). Only switched-on connections are scanned.' },
    lastRun: { title: 'Last scanner cycle', body: 'When the scanner last ran and what it did. It runs every minute from the cron job, and also while this page is open.' },
    scanNow: { title: 'Run a scan now', body: 'Runs one scanner cycle immediately, even outside market hours. A candle is never alerted twice.' },
    autoScan: { title: 'Scanning while open', body: 'While this page is open during market hours it asks the server to scan once a minute.' },
  } satisfies Record<string, TooltipContent>,

  strategy: {
    new: { title: 'New strategy', body: 'Start from scratch: choose legs, then write conditions between them.' },
    example: { title: 'Start from an example', body: 'Pre-fills a complete strategy you can adjust.' },
    edit: { title: 'Edit', body: 'Open in the editor. Saving creates a new version; connected products keep running on it.' },
    duplicate: { title: 'Duplicate', body: 'Copy this strategy to try a variation (connections are not copied).' },
    remove: { title: 'Delete', body: 'Delete the strategy with its versions, connections and alerts. This cannot be undone.' },
    connect: { title: 'Connect to products', body: 'Go to Connections with this strategy selected.' },
    compare: { title: 'Compare on products', body: 'Go to Compare with this strategy selected.' },
    version: { title: 'Version', body: 'Every save is an immutable version; each alert records the version that produced it.' },
    name: { title: 'Name', body: 'Shown in alerts and messages.' },
    description: { title: 'Description', body: 'Optional notes — the idea behind the strategy.' },
    save: { title: 'Save', body: 'Save as a new version.' },
    close: { title: 'Close', body: 'Discard unsaved changes and go back.' },
    preview: { title: 'Preview', body: 'The whole strategy in words.' },
    validation: { title: 'Validation', body: 'Errors block saving; warnings are worth a look.' },
    tryIt: { title: 'Try on a product', body: 'Evaluate the current editor contents on one product right now with live data, and see every condition’s values. Nothing is saved or sent.' },
  } satisfies Record<string, TooltipContent>,

  legs: {
    section: {
      title: 'Legs (1–4)',
      body: 'The instruments your conditions read — placeholders, not products. When you connect the strategy to a product, each leg becomes that product’s contract.',
      example: 'A · FUT, B · CE ATM, C · PE ATM−1',
    },
    kind: {
      title: 'Leg type',
      body: 'SPOT = index value / stock cash price. FUT = the future (with option legs: the future the options expire into). CE / PE = an option at a strike relative to ATM.',
    },
    offset: { title: 'Strike', body: 'Listed strikes away from ATM: ATM, ATM+1 (one strike above), ATM−2 (two below)… ATM comes from the spot price, or the future when there is no spot (MCX).' },
    label: { title: 'Name (optional)', body: 'Your own name for this leg, e.g. “Hedge put”. Shown in conditions and alerts.' },
    add: { title: 'Add leg', body: 'Add another leg (up to 4).' },
    remove: { title: 'Remove leg', body: 'Remove this leg. Conditions that use it must be changed first.' },
  } satisfies Record<string, TooltipContent>,

  editor: {
    mode: {
      title: 'Evaluation mode',
      body: 'Completed candle (recommended): conditions read the last CLOSED candle, evaluated once when the trigger candle closes — no repainting. Live candle: reads forming candles every minute.',
    },
    triggerTf: { title: 'Trigger timeframe (clock)', body: 'When the strategy is evaluated: at every close of this timeframe’s candle. Each condition can use its own timeframe.' },
    conditions: {
      title: 'Conditions',
      body: 'Compare any leg with any other leg or a number — each value on its own timeframe and candle type. Combine with AND / OR groups and NOT.',
      example: 'A · FUT RSI(14) > B · CE ATM RSI(14) AND B · CE ATM RSI(14) crossed above 60',
    },
    group: { title: 'Group', body: 'AND: every item must be true. OR: at least one. Groups can be nested.' },
    groupLabel: {
      title: 'Group name',
      body: 'Optional label for this group, shown in the preview, explanations and alerts — e.g. “Future conditions” and “Option conditions”.',
      example: 'Future conditions AND Option conditions',
    },
    not: { title: 'NOT', body: 'Inverts the wrapped item. Unknown (not enough data) stays unknown.' },
    addCondition: { title: 'Add condition', body: 'Compare two values — e.g. a leg’s indicator against another leg’s indicator, or a number.' },
    addPattern: { title: 'Add candlestick pattern', body: 'True on the candle that completes the pattern, on the leg / timeframe / candle type you choose.' },
    addGroup: { title: 'Add group', body: 'Add a nested AND / OR group.' },
    moveUp: { title: 'Move up', body: 'Reorder within the group.' },
    moveDown: { title: 'Move down', body: 'Reorder within the group.' },
    remove: { title: 'Remove', body: 'Remove this item.' },
    wrapNot: { title: 'Wrap in NOT', body: 'True only when its content is false.' },
    unwrapNot: { title: 'Remove NOT', body: 'Unwrap this item.' },
    leg: {
      title: 'Leg',
      body: 'Which of the strategy’s legs this value reads. Use “+ Add … leg” at the bottom of the list to add a FUT, CE, PE or SPOT leg without leaving the condition.',
    },
    timeframe: { title: 'Timeframe', body: 'Candle size for this value. 2h / 4h are built from 1h candles and Weekly from daily, aligned to each market’s session.' },
    candle: { title: 'Candle type', body: 'Normal, Heikin Ashi (smoothed), or Volume candles (close each time the given volume trades; restart daily).' },
    volumePerCandle: { title: 'Volume per candle', body: 'A volume candle closes when its traded volume reaches this many units.' },
    operandKind: { title: 'Value', body: 'Indicator (RSI, SMA…), a price field (open/high/low/close/volume/OI), the change in OI, or a number.' },
    indicator: { title: 'Indicator', body: 'Same maths as Kite / TradingView (Wilder RSI and ADX).' },
    source: { title: 'Source', body: 'Input the indicator is computed on — e.g. SMA of Volume.' },
    output: { title: 'Output', body: 'Which line of a multi-line indicator.' },
    multiplier: { title: 'Multiplier', body: 'Scales the value, e.g. 1.5 × SMA(Volume, 20).' },
    lookback: { title: 'Lookback', body: 'OI change = OI now − OI this many candles ago.' },
    field: { title: 'Field', body: 'A raw candle value.' },
    operator: { title: 'Operator', body: 'Greater / less / equal compare current values. Crossed above = previous left ≤ previous right AND current left > current right.' },
    constant: { title: 'Number', body: 'A fixed level, e.g. 60 for RSI or 1 for Bollinger %B. Bands and averages (Bollinger Upper / Middle / Lower, SMA, EMA) are compared with the price instead.' },
    compareWithClose: {
      title: 'Compare Close with it',
      body: 'Rewrites this condition as “Close <operator> <band / average>” on the same leg, timeframe and candles — the usual way to use Bollinger bands and moving averages.',
      example: 'A · FUT Close crossed above A · FUT Bollinger Bands(20,2) Upper',
    },
    pattern: { title: 'Pattern', body: 'Candlestick pattern on the chosen leg’s candles.' },
  } satisfies Record<string, TooltipContent>,

  connection: {
    collapse: { title: 'Minimize', body: 'Collapse this strategy’s list to its header (the products stay listed in one line). Remembered in this browser.' },
    expand: { title: 'Expand', body: 'Show every connection of this strategy again.' },
    collapseAll: { title: 'Collapse all', body: 'Minimize every strategy’s list to its header.' },
    expandAll: { title: 'Expand all', body: 'Show every strategy’s connections.' },
    onCount: { title: 'Switched on', body: 'How many of this strategy’s connections are being scanned, out of all of them.' },
    allOn: {
      title: 'Switch all on',
      body: 'Switch on every connection of this strategy at once. Each is checked like a single switch-on (legs, expiry, alert channels); any that can’t start are listed and stay off.',
      note: 'Candles that closed before now never alert.',
    },
    allOff: { title: 'Switch all off', body: 'Stop scanning every connection of this strategy. Click twice to confirm. History and settings are kept.' },
    new: { title: 'New connection', body: 'Connect a strategy to one or more products.' },
    strategy: { title: 'Strategy', body: 'The strategy to run. Its legs decide which products it can connect to.' },
    products: { title: 'Products', body: 'Pick one or many. Only products offering every leg the strategy needs are listed (e.g. options → F&O stocks, not cash-only ones).' },
    load: {
      title: 'Scanner load',
      body: 'Each product costs one candle request per leg (option legs once per strike position) every trigger candle. Kite allows about 3 requests a second, so the scanner fetches up to “Requests per cycle” (Settings) each minute — products beyond that are checked in the following minutes.',
      note: 'Your other switched-on connections share the same budget.',
    },
    expiry: { title: 'Expiry', body: 'Option expiry when the strategy has CE / PE legs (Current = nearest; NSE indices are weekly), otherwise the futures expiry.' },
    shifts: {
      title: 'Strike positions',
      body: 'Around ATM only: the option legs sit where the strategy says. ATM and ± N: also scan the same legs one, two… strikes lower and higher — each position alerts separately.',
    },
    channels: { title: 'Channels', body: 'Where alerts go. Every alert is also listed in Alerts.' },
    trigger: { title: 'Alert when', body: 'Becomes true (recommended): first candle it turns true after being false. While true: every trigger candle it stays true (limited by cooldown).' },
    cooldown: { title: 'Cooldown', body: 'After an alert, further alerts for the same product / strike are suppressed for this many minutes (still recorded).' },
    oncePerCandle: { title: 'Once per candle', body: 'At most one alert per trigger candle. Always on in completed-candle mode.' },
    preview: { title: 'Contracts now', body: 'The exact contracts each leg resolves to on this product right now, with live prices.' },
    enable: { title: 'Switch on', body: 'Start scanning. Candles that closed before now never alert.', note: 'Blocked until the chosen channels are configured.' },
    disable: { title: 'Switch off', body: 'Stop scanning. History is kept.' },
    explain: { title: 'Explain now', body: 'Evaluate this connection now and show every condition’s values — why it would or wouldn’t alert. Nothing is saved or sent.' },
    edit: { title: 'Edit settings', body: 'Change expiry, strike positions or alert settings.' },
    remove: { title: 'Remove connection', body: 'Disconnect this product from the strategy. Its alerts are deleted too.' },
    units: { title: 'Units', body: 'One unit per strike position (or one for spot / futures strategies). Shows each one’s last result and alert state.' },
    create: { title: 'Connect', body: 'Create one connection per selected product (switched off — switch them on from the list).' },
  } satisfies Record<string, TooltipContent>,

  compare: {
    run: { title: 'Compare', body: 'Evaluate the strategy on every trigger candle of the period for each product and count where it would have alerted.' },
    range: { title: 'Period', body: 'Trading days to evaluate (IST). Longest period depends on the trigger timeframe (e.g. 20 days of 15-minute candles).' },
    strikeShift: { title: 'Strike position', body: 'Where the option legs sit: 0 = as the strategy says (around ATM).' },
    alerts: { title: 'Alerts', body: 'Candles where the strategy would have alerted with this alert rule.' },
    coverage: { title: 'Data coverage', body: 'Candles with enough data to decide. Low coverage = contracts that did not exist yet or indicators still warming up.' },
    connect: { title: 'Connect', body: 'Connect the strategy to this product.' },
  } satisfies Record<string, TooltipContent>,

  unit: {
    IDLE: { title: 'Idle', body: 'Waiting for the strategy to become true.' },
    TRIGGERED: { title: 'Triggered', body: 'Alerted on its latest trigger candle.' },
    COOLDOWN: { title: 'Cooldown', body: 'Alerted recently; further alerts are suppressed until the cooldown ends.' },
    ACKNOWLEDGED: { title: 'Acknowledged', body: 'You acknowledged the alert; quiet until the strategy turns false again.' },
    DISABLED: { title: 'Switched off', body: 'The connection is switched off.' },
  } satisfies Record<string, TooltipContent>,

  tri: {
    TRUE: { title: 'True', body: 'The condition holds on the evaluated candle.' },
    FALSE: { title: 'False', body: 'The condition does not hold.' },
    UNKNOWN: { title: 'Unknown', body: 'Not enough data to decide (warm-up, missing candles, a leg not listed). Unknown never alerts.' },
  } satisfies Record<string, TooltipContent>,

  alerts: {
    sourceVerified: { title: 'Verified', body: 'Decided by the live worker and re-checked on Kite’s official candles before the alert went out.' },
    sourceUnverified: { title: 'Not verified', body: 'Kite’s official candles didn’t arrive within 2 minutes, so the live worker decided on its live-built candles. Usually identical; check the chart if it matters.' },
    sourceLive: { title: 'Live candle', body: 'Live-candle mode: fired on the forming candle as it happened (it can’t be verified until the candle closes).' },
    sourceHistorical: { title: 'Kite candles', body: 'Decided by the per-minute scanner directly on Kite’s official candles.' },
    acknowledge: { title: 'Acknowledge', body: 'Mark as seen. It won’t alert again until the strategy turns false and then true again.' },
    status: { title: 'Delivery status', body: 'Sent: every chosen channel delivered. Partial: one failed. Failed: none delivered.' },
    outcome: { title: 'Signal outcome', body: 'Every time a strategy fires a signal is recorded — delivered, or suppressed with the reason.' },
    why: { title: 'Why did it fire?', body: 'Every condition with its leg, values and candles.' },
  } satisfies Record<string, TooltipContent>,

  products: {
    sync: { title: 'Sync products', body: 'Download the latest instrument lists from Kite (NSE, BSE, NFO, BFO, MCX) now. Takes up to a minute.' },
    search: { title: 'Search', body: 'Find a product by symbol or name, e.g. NIFTY, RELIANCE, GOLD.' },
    kind: { title: 'Type', body: 'Indices, stocks or commodities.' },
    legs: { title: 'Legs available', body: 'Which leg types this product offers: SPOT (index / cash price), FUT, CE / PE (options).' },
  } satisfies Record<string, TooltipContent>,

  scanner: {
    budget: { title: 'Request budget', body: 'Candle requests allowed per cycle. Contracts shared by several connections are fetched once. Units beyond the budget wait for the next cycle.' },
    hideIdle: { title: 'Hide idle cycles', body: 'Hide cycles with nothing new to evaluate.' },
    manual: {
      title: 'Manual scan',
      body: 'Started with “Scan now” (or the cron URL with ?force=1), so it runs even when the market is closed — then each connection is checked on its last closed candle, which never alerts if it closed before the connection was switched on or over 30 minutes ago.',
    },
    deferred: {
      title: 'Carried over',
      body: 'Units that didn’t fit this cycle’s request budget; they’re checked in the next cycles (a minute apart). Not an error.',
      note: 'The live worker (npm run live) streams prices instead, so it has no such wait.',
    },
    errors: { title: 'Errors', body: 'Problems in this cycle — one failure never stops the rest.' },
  } satisfies Record<string, TooltipContent>,

  settings: {
    telegramChats: {
      title: 'Telegram chats',
      body: 'Every V2 alert is sent to all of these — people, groups or channels. Each person must first open your bot in Telegram and press Start; for a group, add the bot to it.',
      note: 'Empty = TELEGRAM_CHAT_ID from the environment (comma-separated allowed). The bot token comes from TELEGRAM_BOT_TOKEN.',
    },
    chatName: { title: 'Name', body: 'Who this is (e.g. “Rahul”, “Trading desk”) — shown in delivery results. Optional.' },
    chatId: { title: 'Chat id', body: 'A number for a person (e.g. 123456789); groups and channels start with -100. A public channel can also be @channelname.' },
    addChat: { title: 'Add chat', body: 'Add another person, group or channel to receive alerts (up to 20).' },
    removeChat: { title: 'Remove', body: 'Stop sending alerts to this chat (after you save).' },
    findChats: {
      title: 'Find chat IDs',
      body: 'List people and groups that recently messaged your bot, so you can add them with one click.',
      note: 'Ask each person to open the bot and press Start (or send it any message) first. Telegram keeps these for about 24 hours.',
    },
    testTelegram: { title: 'Send a test to all', body: 'Send a test message to every saved chat and show who received it.' },
    openBot: { title: 'Open the bot', body: 'Opens our Telegram bot in the Telegram app (or Telegram Web if the app isn’t installed). Press Start there to be able to receive alerts.' },
    openBotWeb: { title: 'Telegram Web', body: 'Open the bot in Telegram Web in the browser instead of the app.' },
    copyBotLink: { title: 'Copy invite link', body: 'Copy the bot’s link to send to teammates — they open it, press Start, then you add them with Find chat IDs.' },
    emailTo: { title: 'Email recipients', body: 'Comma-separated addresses. Requires RESEND_API_KEY in the environment.' },
    emailFrom: { title: 'Sender', body: 'The From address — a domain verified in Resend, or onboarding@resend.dev for testing.' },
    budget: { title: 'Requests per cycle', body: 'Maximum candle requests per scanner cycle (Kite allows ~3 per second).' },
    test: { title: 'Send a test', body: 'Send a test message on this channel now.' },
    calendar: { title: 'Market calendar', body: 'Holidays and special sessions, per market (NSE / BSE and MCX). Weekdays default to each market’s normal hours.' },
    addHoliday: { title: 'Add holiday', body: 'No trading that day in the chosen market.' },
    addSpecial: { title: 'Add special session', body: 'A trading day with custom hours (IST), e.g. Muhurat trading.' },
    save: { title: 'Save', body: 'Save these settings.' },
  } satisfies Record<string, TooltipContent>,
};
