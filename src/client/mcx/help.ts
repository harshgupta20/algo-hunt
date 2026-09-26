/**
 * Tooltip content for every MCX V2 control, badge and icon (rich tooltips,
 * never native title=). Kept apart from the V1 help so the subsystems stay independent.
 */
import type { TooltipContent } from '../components/Tooltip';

export const H = {
  nav: {
    title: 'MCX V2 (beta)',
    body: 'The new, independent MCX alerting system: pick a product, expiry and strikes, then write conditions on the FUT, CE and PE legs — each with its own timeframe and candle type, combined with AND/OR/NOT — and get Telegram + Email alerts with cooldowns and full “why did it (not) fire” explanations.',
    note: 'Runs alongside the current MCX tab — nothing there changes.',
  },
  tabs: {
    dashboard: { title: 'Dashboard', body: 'Market and scanner health, active alerts and every strategy’s instruments at a glance.' },
    strategies: { title: 'Strategies', body: 'Create, edit, enable and test MCX V2 strategies. Every save is a new version; alerts record the version that fired.' },
    alerts: { title: 'Alerts', body: 'Active alerts (acknowledge them), the alert history and every signal — including suppressed ones and why.' },
    scanner: { title: 'Scanner', body: 'Each scanner cycle: what was due, how many candle requests it used, what fired and any errors — per strategy, instrument and data series.' },
    instruments: { title: 'Instruments', body: 'MCX V2’s own contract list (futures + options) synced from Kite, with expiries and strike ladders.' },
    settings: { title: 'Settings', body: 'Alert destinations (Telegram, Email), scanner limits and the MCX holiday / special-session calendar.' },
  } satisfies Record<string, TooltipContent>,

  status: {
    market: { title: 'MCX session', body: 'Open 09:00 IST until 23:30 while the US is on daylight saving time, 23:55 otherwise. Holidays and special sessions come from Settings → Calendar.' },
    kite: { title: 'Kite connection', body: 'Candles and live prices come from Zerodha Kite. Without a session the scanner records a failed cycle and nothing is evaluated.', note: 'Log in from Settings → Broker Connection.' },
    instruments: { title: 'Instrument master', body: 'Contracts MCX V2 can scan. Re-synced automatically when older than 18 hours; you can also sync from the Instruments tab.' },
    strategies: { title: 'Enabled strategies', body: 'Strategies the scanner evaluates every cycle. Disabled strategies keep their history.' },
    lastRun: { title: 'Last scanner cycle', body: 'When the scanner last ran and what it did. It runs every minute from the cron job, and also while this page is open.' },
    scanNow: { title: 'Run a scan now', body: 'Runs one scanner cycle immediately (outside market hours too). Candles that were already evaluated are not re-alerted.', note: 'Skipped if another scan ran within the last 45 seconds.' },
    autoScan: { title: 'Scanning while open', body: 'While this page is open during market hours it asks the server to scan once a minute, so alerts arrive even without an external scheduler.' },
  } satisfies Record<string, TooltipContent>,

  strategy: {
    new: { title: 'New strategy', body: 'Start a strategy from scratch: product → instruments → timeframe → conditions → alert policy.' },
    template: { title: 'Start from an example', body: 'Pre-fills a complete strategy you can adjust — the fastest way to see how the pieces fit.' },
    edit: { title: 'Edit', body: 'Open the strategy in the editor. Saving creates a new version and resets its unit states.' },
    duplicate: { title: 'Duplicate', body: 'Copy this strategy (as a new, disabled strategy) to try a variation.' },
    remove: { title: 'Delete', body: 'Delete the strategy with its versions, signals and alerts. This cannot be undone.' },
    enable: { title: 'Enable', body: 'Start scanning. Candles that closed before now never alert, so enabling never sends old signals.', note: 'Blocked until validation passes and the chosen channels are configured.' },
    disable: { title: 'Disable', body: 'Stop scanning. History is kept; enabling again starts fresh.' },
    version: { title: 'Version', body: 'Strategies are versioned: every save is immutable, and each alert records the version that produced it.' },
    units: { title: 'Strikes / futures being scanned', body: 'One evaluation unit per strike (with its FUT, CE and PE) or per future. Shows each one’s last result and alert state.' },
    explain: { title: 'Explain now', body: 'Evaluates every strike / future right now with live data and shows each condition’s values — why it would or wouldn’t fire. Nothing is saved or sent.' },
    replay: { title: 'Replay', body: 'Steps the strategy through past candles and lists where it would have signalled, with the failing conditions on every other candle.' },
  } satisfies Record<string, TooltipContent>,

  editor: {
    name: { title: 'Strategy name', body: 'Shown in alerts, history and messages.' },
    description: { title: 'Description', body: 'Optional notes for yourself — the idea behind the strategy.' },
    product: { title: 'Product (WHAT)', body: 'The MCX commodity this strategy scans. Only products with synced contracts can be used.' },
    targetKind: {
      title: 'Scan futures or options',
      body: 'Futures: one alert per futures contract; conditions use the FUT leg. Options: one alert per strike; conditions can use three legs — FUT (the future these options expire into), CE and PE at that strike.',
    },
    expiry: {
      title: 'Expiry',
      body: 'Which contract month(s): Current (nearest), Next, Far, every listed one, or a specific date.',
      note: 'MCX option expiries differ from futures expiries (options expire a few days earlier).',
    },
    strikes: {
      title: 'Strikes',
      body: 'Around ATM picks listed strikes relative to the at-the-money strike (from the future’s live price). Specific / Range / All select fixed strikes. Each strike is evaluated on its own, with its CE and PE.',
      note: 'ATM-relative selections are re-resolved every scanner cycle, so they follow the market.',
    },
    atmPreset: {
      title: 'Strikes around ATM',
      body: 'ATM, ATM ± N, or N strikes above / below ATM. Out-of-the-money calls are above ATM; out-of-the-money puts are below.',
    },
    offsets: { title: 'ATM offsets', body: 'Steps along the listed strike ladder: 0 = ATM, −1 = one strike below, +2 = two above. “ATM ± 2” = −2, −1, 0, +1, +2.' },
    resolved: {
      title: 'Selected strikes / futures',
      body: 'Exactly what the strategy scans right now, with the ATM strike and live quotes for each leg. This is what the scanner will evaluate.',
      note: 'Capped per strategy (Settings) to protect Kite’s rate limits.',
    },
    mode: {
      title: 'Evaluation mode',
      body: 'Completed candle (recommended): every condition reads its last CLOSED candle, evaluated once when the trigger candle closes — no repainting. Live candle: reads forming candles, re-evaluated every minute.',
    },
    triggerTf: { title: 'Trigger timeframe (clock)', body: 'When the strategy is evaluated: at every close of this timeframe’s candle. Conditions may use other timeframes — each reads its own last closed candle at that moment.' },
    group: { title: 'Group', body: 'AND: every child must be true. OR: at least one. Groups can be nested for logic like (A AND B) OR C.' },
    conditions: {
      title: 'Conditions',
      body: 'Each condition reads one leg — FUT, CE or PE of the strike — on its own timeframe and candle type. Combine them with AND / OR groups and NOT.',
      example: 'FUT RSI(14) crossed above 60 AND CE RSI(14) crossed above 60 AND PE RSI(14) crossed below 40',
    },
    not: { title: 'NOT', body: 'Inverts the wrapped condition or group. An unknown result (not enough data) stays unknown — it never counts as “not true”.' },
    addCondition: { title: 'Add condition', body: 'Compare two values: an indicator, price field or OI change against a number or another value.' },
    addPattern: { title: 'Add candlestick pattern', body: 'True on the candle that completes the pattern (e.g. Hammer), on the series you choose.' },
    addGroup: { title: 'Add group', body: 'Add a nested AND / OR group.' },
    moveUp: { title: 'Move up', body: 'Reorder this item within its group.' },
    moveDown: { title: 'Move down', body: 'Reorder this item within its group.' },
    remove: { title: 'Remove', body: 'Remove this item from the strategy.' },
    wrapNot: { title: 'Wrap in NOT', body: 'Make this item true only when its content is false.' },
    unwrapNot: { title: 'Remove NOT', body: 'Unwrap this item from its NOT.' },
    leg: {
      title: 'Leg',
      body: 'Which contract of the strike this value reads: FUT = the future these options expire into, CE = the call at this strike, PE = the put at this strike.',
      note: 'Futures strategies only have the FUT leg.',
    },
    timeframe: { title: 'Timeframe', body: 'Candle size for this value. 2h / 4h are built from 1h candles and Weekly from daily ones, aligned to the MCX session.' },
    candle: {
      title: 'Candle type',
      body: 'Normal: exchange candles. Heikin Ashi: smoothed candles (close = OHLC average). Volume: candles that close each time the given volume trades.',
      note: 'Volume candles restart every trading day.',
    },
    volumePerCandle: { title: 'Volume per candle', body: 'A volume candle closes on the base candle that brings its traded volume to at least this many contracts.' },
    operandKind: { title: 'Value', body: 'Indicator (RSI, SMA…), a price field (open/high/low/close/volume/OI), the change in OI over N candles, or a fixed number.' },
    indicator: { title: 'Indicator', body: 'The calculation applied to the series. Same maths as Kite / TradingView (Wilder RSI and ADX).' },
    source: { title: 'Source', body: 'Input the indicator is computed on — e.g. SMA of Volume for a volume-spike filter.' },
    output: { title: 'Output', body: 'Which line of a multi-line indicator (Bollinger upper/middle/lower/%B, DMI +DI/−DI, MACD line/signal/histogram).' },
    multiplier: { title: 'Multiplier', body: 'Scales the value, e.g. 1.5 × SMA(Volume, 20) for “volume 50% above average”.' },
    lookback: { title: 'Lookback', body: 'OI change = OI now − OI this many candles ago.' },
    field: { title: 'Field', body: 'A raw candle value on the chosen series.' },
    operator: {
      title: 'Operator',
      body: 'Greater / less / equal compare the current values. Crossed above = previous left ≤ previous right AND current left > current right (crossed below mirrors it).',
    },
    constant: { title: 'Number', body: 'A fixed level, e.g. 60 for RSI.' },
    pattern: { title: 'Pattern', body: 'Candlestick pattern detected on the chosen series’ candles (Heikin Ashi or volume candles too).' },
    channels: { title: 'Channels', body: 'Where alerts are delivered. Every alert is also listed in Alerts; a failed channel is recorded and never blocks the other.' },
    trigger: {
      title: 'Alert when',
      body: 'Becomes true (recommended): alert on the first candle the strategy turns true after being false. While true: alert on every trigger candle it stays true (subject to cooldown).',
    },
    cooldown: { title: 'Cooldown', body: 'After an alert, further alerts for the same strike (or future) are suppressed for this many minutes (they are still recorded as suppressed signals).' },
    oncePerCandle: { title: 'Once per candle', body: 'At most one alert per strike (or future) per trigger candle. Always on in completed-candle mode; in live mode, turning it off allows one alert per minute.' },
    save: { title: 'Save', body: 'Save as a new version. An enabled strategy stays enabled (its unit states reset).' },
    cancel: { title: 'Close editor', body: 'Discard unsaved changes and return to the list.' },
    preview: { title: 'Preview', body: 'The whole strategy in words — read this before enabling.' },
    validation: { title: 'Validation', body: 'Errors block saving/enabling; warnings are worth a look. Checked against the catalog, the synced instruments and your channel setup.' },
    testNow: { title: 'Test now (unsaved)', body: 'Runs the current editor contents against live data once and explains every condition — nothing is saved or sent.' },
  } satisfies Record<string, TooltipContent>,

  unit: {
    IDLE: { title: 'Idle', body: 'Waiting for the strategy to become true on this strike (or future).' },
    TRIGGERED: { title: 'Triggered', body: 'Alerted on its latest trigger candle.' },
    COOLDOWN: { title: 'Cooldown', body: 'Alerted recently; further alerts are suppressed until the cooldown ends.' },
    ACKNOWLEDGED: { title: 'Acknowledged', body: 'You acknowledged the alert; it stays quiet until the strategy turns false again.' },
    DISABLED: { title: 'Disabled', body: 'The strategy is disabled.' },
  } satisfies Record<string, TooltipContent>,

  tri: {
    TRUE: { title: 'True', body: 'The condition holds on the evaluated candle.' },
    FALSE: { title: 'False', body: 'The condition does not hold.' },
    UNKNOWN: { title: 'Unknown', body: 'Not enough data to decide (warm-up, missing candles or a failed fetch). Unknown never alerts and never counts as false.' },
  } satisfies Record<string, TooltipContent>,

  alerts: {
    acknowledge: { title: 'Acknowledge', body: 'Mark as seen. This strike / future won’t alert again for the strategy until the strategy turns false and then true again.' },
    status: { title: 'Delivery status', body: 'Sent: every chosen channel delivered. Partial: one failed. Failed: none delivered. Hover a channel for its result.' },
    outcome: { title: 'Signal outcome', body: 'Every time a strategy fires, a signal is recorded — delivered, or suppressed with the reason (cooldown, acknowledged, before enable, too late).' },
    why: { title: 'Why did it fire?', body: 'The full evaluation behind this alert: every condition with its leg, values and the candles they came from.' },
    view: { title: 'View', body: 'Choose which records to show.' },
  } satisfies Record<string, TooltipContent>,

  scanner: {
    budget: { title: 'Request budget', body: 'Candle requests allowed per cycle. Instruments shared by several strategies are fetched once. Units beyond the budget are deferred to the next cycle.' },
    errors: { title: 'Errors', body: 'Problems in this cycle, with the strategy, instrument and series involved. One failure never stops the rest of the scan.' },
    hideIdle: { title: 'Hide idle cycles', body: 'Hide cycles where every strategy had already evaluated its latest candle (nothing new to do).' },
  } satisfies Record<string, TooltipContent>,

  instruments: {
    sync: { title: 'Sync instruments', body: 'Download the MCX instrument master from Kite now (needs a live Kite session).' },
    search: { title: 'Search', body: 'Filter contracts by trading symbol, e.g. GOLD26OCT or 75000CE.' },
    type: { title: 'Contract type', body: 'Futures, calls (CE) or puts (PE).' },
  } satisfies Record<string, TooltipContent>,

  settings: {
    telegramChat: { title: 'Telegram chat id', body: 'Where MCX V2 alerts go. Leave empty to use TELEGRAM_CHAT_ID from the environment. The bot token always comes from TELEGRAM_BOT_TOKEN.' },
    emailTo: { title: 'Email recipients', body: 'Comma-separated addresses. Requires RESEND_API_KEY in the environment.' },
    emailFrom: { title: 'Sender', body: 'The From address. Use a domain verified in Resend, or onboarding@resend.dev for testing (delivers only to your Resend account email).' },
    cap: { title: 'Strikes / futures per strategy', body: 'Maximum units (strikes or futures) one strategy may scan. Larger selections are cut and flagged.' },
    budget: { title: 'Requests per cycle', body: 'Maximum candle requests per scanner cycle (Kite allows ~3 per second).' },
    test: { title: 'Send a test', body: 'Sends a test message on this channel right now.' },
    calendar: { title: 'Market calendar', body: 'MCX holidays and special sessions (e.g. Muhurat trading). Weekdays default to 09:00–23:30/23:55; weekends are closed.' },
    addHoliday: { title: 'Add holiday', body: 'No trading that day: no candles are expected and the scanner stays idle.' },
    addSpecial: { title: 'Add special session', body: 'A trading day with custom hours (IST).' },
    save: { title: 'Save', body: 'Save these settings.' },
  } satisfies Record<string, TooltipContent>,
};
