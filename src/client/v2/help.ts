/**
 * Tooltip content for every V2 control, badge and icon (rich tooltips, never native title=).
 */
import type { TooltipContent } from '../components/Tooltip';

export const H = {
  nav: {
    title: 'V2 — Strategy + Product = Alert',
    body: 'Build a strategy once without choosing a product, then connect it to any NSE index, NSE stock or MCX commodity to get alerts. Compare shows which products the strategy fires on.',
    note: 'Runs alongside the existing pages — nothing there changes.',
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
    not: { title: 'NOT', body: 'Inverts the wrapped item. Unknown (not enough data) stays unknown.' },
    addCondition: { title: 'Add condition', body: 'Compare two values — e.g. a leg’s indicator against another leg’s indicator, or a number.' },
    addPattern: { title: 'Add candlestick pattern', body: 'True on the candle that completes the pattern, on the leg / timeframe / candle type you choose.' },
    addGroup: { title: 'Add group', body: 'Add a nested AND / OR group.' },
    moveUp: { title: 'Move up', body: 'Reorder within the group.' },
    moveDown: { title: 'Move down', body: 'Reorder within the group.' },
    remove: { title: 'Remove', body: 'Remove this item.' },
    wrapNot: { title: 'Wrap in NOT', body: 'True only when its content is false.' },
    unwrapNot: { title: 'Remove NOT', body: 'Unwrap this item.' },
    leg: { title: 'Leg', body: 'Which of the strategy’s legs this value reads.' },
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
    constant: { title: 'Number', body: 'A fixed level, e.g. 60.' },
    pattern: { title: 'Pattern', body: 'Candlestick pattern on the chosen leg’s candles.' },
  } satisfies Record<string, TooltipContent>,

  connection: {
    new: { title: 'New connection', body: 'Connect a strategy to one or more products.' },
    strategy: { title: 'Strategy', body: 'The strategy to run. Its legs decide which products it can connect to.' },
    products: { title: 'Products', body: 'Pick one or many. Products that lack a leg the strategy needs (e.g. options) are marked and can’t be chosen.' },
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
    errors: { title: 'Errors', body: 'Problems in this cycle — one failure never stops the rest.' },
  } satisfies Record<string, TooltipContent>,

  settings: {
    telegramChat: { title: 'Telegram chat id', body: 'Where V2 alerts go. Empty = TELEGRAM_CHAT_ID from the environment. The bot token comes from TELEGRAM_BOT_TOKEN.' },
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
