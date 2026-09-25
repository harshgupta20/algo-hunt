/**
 * Every tooltip in the app, in one place — what each feature, control and icon
 * is and what it does. Rule of thumb: nothing ships without an entry here.
 * Builder indicator/operator/instrument help comes from the server catalog.
 */
import type { TooltipContent } from '../components/Tooltip';

type Help = TooltipContent;

const field = {
  underlying: {
    title: 'Underlying',
    body: 'The index whose Future, ATM Call and ATM Put are watched.',
    note: 'Only underlyings present in the synced Kite instrument master are listed. MCX commodities live in the MCX tab.',
  },
  expiry: {
    title: 'Expiry',
    body: 'Which option expiry to use. Current Weekly = nearest expiry, Next Weekly = the one after, Monthly = last expiry of the month.',
    note: 'The future always uses the front-month contract, since futures only have monthly expiries. On MCX (monthly only) weekly choices map to Near / Next month.',
  },
  strike: {
    title: 'Strike',
    body: 'ATM = the strike nearest the future price. ATM+1 / ATM−1 move one strike interval up / down (e.g. 50 points on NIFTY). CUSTOM = a fixed strike.',
    note: 'Live monitors lock the strike when activated. Backtests of the built-in strategy re-pick ATM on every candle.',
  },
  timeframe: {
    title: 'Timeframe',
    body: 'Candle size. Rules are evaluated once, when each candle of this size closes — never on a half-formed candle.',
    example: '15m → checks at 09:30, 09:45, 10:00 …',
    note: 'Daily fires once at the session close; Weekly at Friday’s close.',
  },
  strategy: {
    title: 'Strategy',
    body: 'The rules to run: the built-in RSI Multi Confirmation or one of your published strategies.',
  },
} satisfies Record<string, Help>;

export const HELP = {
  field,

  nav: {
    dashboard: {
      title: 'Dashboard',
      body: 'Your trading overview: headline numbers, live RSI gauges for every active monitor, the latest alerts and performance analytics.',
    },
    alerts: {
      title: 'Alerts',
      body: 'Every alert — the live feed and the full history in one place. Filter by underlying, strategy, scenario or date; switch between cards and a table; export CSV.',
    },
    strategies: {
      title: 'Strategies',
      body: 'Library, Builder and Backtest in one place: browse strategies, create or edit rules, and replay them on history.',
    },
    configuration: { title: 'Configuration', body: 'Create NSE/BSE index monitors (what to watch, which strategy) and switch them on or off.' },
    mcx: {
      title: 'MCX Commodities',
      body: 'Gold, Silver, Crude Oil, Natural Gas and base metals on MCX: product list, commodity monitors and backtests, in their own session (09:00–23:30/23:55 IST).',
      note: 'Uses the same strategies, indicators and alerts as NSE — only the market is different.',
    },
    settings: { title: 'Settings', body: 'Zerodha Kite connection, notifications, theme and evaluator status.' },
  },

  topbar: {
    live: { title: 'Live', body: 'Kite is connected, the market is open and the evaluator ran within the last few minutes.' },
    stale: {
      title: 'Scheduler idle',
      body: 'The market is open but no evaluation ran recently.',
      note: 'Check the per-minute scheduler calling /api/cron/tick. Keeping this dashboard open also triggers evaluations.',
    },
    marketClosed: {
      title: 'Market closed',
      body: 'Both markets are closed: NSE/BSE trades 09:15–15:30 IST, MCX 09:00–23:30 IST (23:55 while the US is on standard time), weekdays only.',
      note: 'Nothing is evaluated until the next session opens.',
    },
    kiteOffline: { title: 'Kite offline', body: 'No valid Zerodha Kite session, so no market data. Click Connect Kite to log in.' },
    nseMarket: { title: 'NSE/BSE', body: 'Index F&O (NIFTY, BANKNIFTY, SENSEX…). Session 09:15–15:30 IST, weekdays.' },
    mcxMarket: {
      title: 'MCX',
      body: 'Commodity F&O (Gold, Silver, Crude Oil…). Session 09:00–23:30 IST (23:55 while the US is on standard time), weekdays.',
    },
    marketState: {
      live: 'Open, and your monitors on this market are evaluated on every closed candle.',
      stale: 'Open with active monitors, but no evaluation ran in the last few minutes. Check the per-minute scheduler calling /api/cron/tick — keeping this dashboard open also triggers evaluations.',
      paused: 'Open with active monitors, but Kite is offline so they can’t be evaluated. Connect Kite to resume.',
      unused: 'Open, but no active monitor runs on this market.',
      closed: 'Outside the session. Monitors on this market wait for the next session.',
    },
    lastRun: { title: 'Last evaluator run', body: 'When monitors were last evaluated (across both markets).' },
    connecting: { title: 'Connecting', body: 'Loading the evaluator status…' },
    connectKite: {
      title: 'Connect Kite',
      body: 'Log in to Zerodha Kite. You’ll return here automatically and live data resumes.',
      note: 'Kite resets access tokens every morning (~6:00 AM IST), so this is needed once per trading day.',
    },
    notificationsOn: { title: 'Browser notifications on', body: 'A desktop notification pops up whenever an alert fires (while this app is open).' },
    notificationsOff: {
      title: 'Enable notifications',
      body: 'Ask the browser for permission to show a desktop notification for every new alert.',
    },
    toDark: { title: 'Dark theme', body: 'Switch to the dark theme. Your choice is saved and follows you to other devices.' },
    toLight: { title: 'Light theme', body: 'Switch to the light theme. Your choice is saved and follows you to other devices.' },
    signOut: { title: 'Sign out', body: 'End this dashboard session. Monitors keep running on the server.' },
  },

  legs: {
    future: { title: 'FUT — Future', body: 'The underlying’s front-month future. Its price also sets the ATM strike.' },
    call: { title: 'CE — Call option', body: 'The ATM call at the monitor’s strike. Rising CE RSI = bullish pressure.' },
    put: { title: 'PE — Put option', body: 'The ATM put at the same strike. Falling PE RSI = puts losing strength (bullish for the index).' },
  },

  zones: {
    bull: { title: 'Bullish zone (green)', body: 'RSI at or above 60 — strong upward momentum.' },
    bear: { title: 'Bearish zone (red)', body: 'RSI at or below 40 — weak / downward momentum.' },
    neutral: { title: 'Neutral (grey)', body: 'RSI between 40 and 60 — no directional signal.' },
    legend: {
      title: 'Color key',
      body: 'Green = bullish / up, red = bearish / down, grey = neutral. FUT, CE and PE have their own colors so a line or column is easy to match to its leg.',
    },
  },

  scenario: {
    1: {
      title: 'Scenario 1 — All three crossing (bullish)',
      body: 'On the same closed candle: Future RSI crosses above 60, Call RSI crosses above 60 and Put RSI crosses below 40.',
      example: 'FUT 59.8→60.4 · CE 58.9→61.2 · PE 41.0→39.5',
    },
    2: {
      title: 'Scenario 2 — Future already above (bullish)',
      body: 'The Future RSI is already above 60 (trend in place) while Call RSI crosses above 60 and Put RSI crosses below 40 on the same candle.',
      note: 'Outlined badge. At most one scenario fires per candle.',
    },
    custom: { title: 'Custom rule', body: 'Name of the rule group in your custom strategy that turned true on this candle.' },
  },

  strategyStatus: {
    active: { title: 'Published', body: 'Live-ready: monitors can run this strategy.' },
    draft: { title: 'Draft', body: 'Saved but not usable by monitors yet. Publish it when the rules are final.' },
    disabled: { title: 'Disabled', body: 'Switched off — monitors using it stop evaluating. Publish to re-enable.' },
  },

  monitor: {
    live: { title: 'Live', body: 'This monitor is active and evaluated every closed candle.' },
    error: { title: 'Error', body: 'The last evaluation failed (reason shown below). It retries automatically on the next run.' },
    idle: { title: 'Idle', body: 'Saved but not running. Click Activate to start monitoring.' },
    waiting: { title: 'Awaiting first evaluation', body: 'Activated; the first reading appears after the next evaluator run.' },
    metCount: {
      title: 'Legs meeting their condition',
      body: 'How many of FUT ≥ 60, CE ≥ 60 and PE ≤ 40 hold right now (on the live, still-forming candle). 3/3 means an alert is likely when the candle closes.',
      note: 'Alerts still need the crossing to happen on a closed candle.',
    },
    met: { title: 'Condition met', body: 'This leg is on the right side of its level right now.' },
    level: { title: 'Level', body: 'The level this leg must cross. The tick on the bar marks it; the faint red / green bands are the ≤ 40 and ≥ 60 zones.' },
    ltp: { title: 'Future LTP', body: 'Last traded price of the future at the latest evaluation.' },
  },

  stats: {
    activeMonitors: { title: 'Active monitors', body: 'Monitors currently switched on and evaluated every closed candle.' },
    totalAlerts: { title: 'Total alerts', body: 'All alerts stored so far, across every monitor and strategy.' },
    scenario1: { title: 'Scenario 1 alerts', body: 'Alerts where all three legs crossed on the same candle.' },
    scenario2: { title: 'Scenario 2 alerts', body: 'Alerts where the future was already above 60 while CE and PE crossed.' },
    activeSymbols: { title: 'Active symbols', body: 'Distinct underlying + strike combinations that produced alerts.' },
    alertsToday: { title: 'Alerts today', body: 'Alerts fired on today’s IST trading day, across every monitor and strategy. Green when there is at least one.' },
    alertsThisWeek: { title: 'This week', body: 'Alerts fired this ISO week (Monday–Sunday, IST).' },
    btTotal: { title: 'Signals in range', body: 'How many times the strategy fired over the selected period.' },
    avgDay: { title: 'Average per day', body: 'Signals ÷ trading days in the range (weekdays).' },
    maxDay: { title: 'Busiest day', body: 'Most signals on a single day.' },
    minDay: { title: 'Quietest day', body: 'Fewest signals on a day that had at least one.' },
    avgWeek: { title: 'Average per week', body: 'Signals ÷ weeks in the range.' },
  },

  strategies: {
    library: { title: 'Library', body: 'All strategies: the built-in one plus yours, with Backtest, Edit and Publish actions.' },
    builder: { title: 'Builder', body: 'Create or edit a strategy from rules — no code. Rules are stored as JSON and versioned on every save.' },
    backtest: { title: 'Backtest', body: 'Replay a strategy on Kite historical candles with the exact engine used for live alerts.' },
    builtin: { title: 'Built-in strategy', body: 'Ships with the platform and can’t be edited. Use “Customize a copy” to change its rules.' },
    runBacktest: {
      title: 'Backtest',
      body: 'Open the Backtest tab with this strategy selected. A specific strategy runs on the last week right away; a universal one asks for its open fields first.',
    },
    customize: {
      title: 'Customize a copy',
      body: 'Open the Builder with these rules as a starting point. Saving creates your own strategy; the built-in one stays unchanged.',
    },
    newStrategy: { title: 'New strategy', body: 'Start a blank strategy in the Builder.' },
    edit: { title: 'Edit', body: 'Change this strategy’s rules and settings. Saving creates a new version.' },
    duplicate: { title: 'Duplicate', body: 'Make a draft copy — handy for experimenting without touching the original.' },
    publish: { title: 'Publish', body: 'Make this strategy available to monitors.' },
    disable: { title: 'Disable', body: 'Stop monitors from using this strategy. You can publish it again later.' },
    delete: { title: 'Delete', body: 'Permanently remove this strategy and its version history.', note: 'Monitors using it stop evaluating.' },
    runsOn: {
      title: 'Applies to',
      body: 'Specific = runs exactly on the listed setup. Universal = the listed parts are fixed and the rest is chosen per run.',
    },
  },

  market: {
    appliesTo: {
      title: 'Applies to',
      body: 'Where this strategy runs. Fix a field to a value, or leave it on “Any” to choose it each time you backtest or create a monitor.',
      note: 'Fixed values always win — backtests and monitors can’t override them.',
    },
    specific: {
      title: 'Specific strategy',
      body: 'Everything is fixed (underlying, expiry, strike, timeframe), so it runs exactly as defined. A backtest only asks for the date range; a monitor is one click.',
    },
    universal: {
      title: 'Universal strategy',
      body: 'Some fields are left open, so the same rules can run on different markets. Backtests and monitors ask only for the open fields.',
    },
    underlyings: {
      title: 'Underlyings',
      body: 'All — the strategy works on any underlying (chosen per run). Or pick one (single-instrument strategy) or several (a basket: backtests cover every member, monitors are created for each).',
    },
    any: {
      title: 'Any',
      body: 'Not fixed by the strategy — you choose it when backtesting or creating a monitor.',
    },
    locked: {
      title: 'Set by the strategy',
      body: 'This value is fixed in the strategy’s “Applies to” section, so it can’t be changed here.',
      note: 'Edit the strategy in the Builder to change it.',
    },
    basket: {
      title: 'Basket',
      body: 'The strategy runs on each of these underlyings. A backtest merges all of them; creating a monitor adds one per underlying.',
    },
    mcxProducts: {
      title: 'MCX products',
      body: 'Fix the strategy to commodity products instead of indices. A strategy is either NSE/BSE or MCX — a basket can’t mix the two (different sessions and expiry cycles).',
    },
    mcxPinned: {
      title: 'MCX strategy',
      body: 'Fixed to MCX commodity products (or an MCX month expiry), so it runs from the MCX tab only.',
    },
    nsePinned: {
      title: 'NSE/BSE strategy',
      body: 'Fixed to NSE/BSE index underlyings, so it runs from Configuration only — not in the MCX tab.',
    },
    mappedExpiry: {
      title: 'Expiry on MCX',
      body: 'MCX lists monthly contracts only, so this strategy’s weekly expiry runs as the matching month: Current weekly / Monthly → Near month, Next weekly → Next month.',
    },
    customStrike: {
      title: 'Strike price',
      body: 'The exact strike to watch when Strike is CUSTOM. Listed strikes come from the Kite instrument master for this expiry.',
    },
  },

  builder: {
    conditionTimeframe: {
      title: 'Timeframe',
      body: 'Candle size this condition reads. “Run timeframe” = the monitor / backtest timeframe. Pick Daily, Weekly, 1h… to mix timeframes, Chartink-style — all conditions in an AND group must hold on the same evaluated candle.',
      example: '15m run: Future RSI(14) cross above 60 AND Future Daily RSI(14) > 50',
      note: 'A larger timeframe uses its still-forming candle as of each evaluated candle’s close (today’s Daily RSI at 11:15) — never a future value. Option legs only trade for weeks, so long Daily / Weekly indicators may lack history there; futures use continuous data.',
    },
    candle: {
      title: 'Candles',
      body: 'Normal = OHLC candles as Kite reports them. Heikin Ashi = smoothed candles (close = average of O/H/L/C, open = midpoint of the previous HA candle) — trends show as long runs of one color. The indicator (and the comparison, if any) reads these candles.',
    },
    compareTimeframe: {
      title: 'Compare timeframe',
      body: 'Candle size of the comparison indicator. “Same” uses this condition’s timeframe; pick another to compare across timeframes.',
      example: 'Future Close cross above Future Daily SMA(20)',
    },
    pattern: {
      title: 'Candle pattern',
      body: 'Which candlestick pattern to look for. The condition is true on the closed candle that completes it.',
      note: 'Hammer / Hanging Man and Inverted Hammer / Shooting Star share a shape; the trend over the previous 5 candles decides which it is.',
    },
    back: { title: 'Back to Library', body: 'Leave the builder. Unsaved changes are discarded.' },
    template: {
      title: 'RSI template',
      body: 'Replace the current rules with the built-in RSI Multi Confirmation rules (both scenarios) as a starting point.',
    },
    saveDraft: { title: 'Save draft', body: 'Save without making it available to monitors. You can keep editing and backtesting.' },
    publish: { title: 'Publish', body: 'Save and make it available to monitors on the Configuration page.' },
    name: { title: 'Name', body: 'Shown in the Library, monitors, alerts and Telegram messages.' },
    category: { title: 'Category', body: 'Free-text tag to organise your strategies (e.g. Momentum, Scalping).' },
    description: { title: 'Description', body: 'One line about the idea behind the strategy.' },
    conditions: {
      title: 'Conditions',
      body: 'Build the rule tree from conditions and groups. The strategy alerts once, when the whole tree turns true on a closed candle — not on every candle it stays true.',
    },
    logic: {
      title: 'AND / OR',
      body: 'AND — every condition in this group must be true on the same candle. OR — any one is enough.',
      example: '(A AND B AND C) OR (D AND E)',
    },
    addCondition: { title: 'Add condition', body: 'Add a new rule to this group (defaults to Future RSI(14) cross above 60).' },
    addGroup: { title: 'Add group', body: 'Add a nested group with its own AND / OR — for rules like “A and (B or C)”.' },
    removeGroup: { title: 'Remove group', body: 'Delete this group and every condition inside it.' },
    removeCondition: { title: 'Remove condition', body: 'Delete this rule from the group.' },
    instrument: {
      title: 'Instrument',
      body: 'Which leg the indicator is calculated on: Future, ATM Call or ATM Put.',
      note: 'MCX products without listed options (e.g. Aluminium, Nickel, the minis) can only run strategies that read the Future.',
    },
    indicator: { title: 'Indicator', body: 'What to measure on that instrument’s candles.' },
    field: { title: 'Output', body: 'Which line of a multi-line indicator to use (e.g. MACD Histogram, Bollinger Upper).' },
    operator: { title: 'Condition', body: 'How the value is tested.' },
    value: {
      title: 'Value',
      body: 'The fixed number to compare with.',
      note: 'For price-type indicators (Bollinger Upper/Middle/Lower, EMA, SMA, VWAP, Price) the number is a price level. To compare with a band or an average, choose Compare to → Indicator.',
    },
    range: { title: 'Range', body: 'Low and high ends of the range (both included).' },
    percent: { title: 'Percent', body: 'Minimum percentage change versus “Lookback” candles ago.' },
    lookback: {
      title: 'Lookback (bars)',
      body: 'How many candles back to compare with. 1 = the previous candle.',
      example: 'EMA(20) rising over 3 bars → EMA now > EMA 3 candles ago',
    },
    compareMode: {
      title: 'Compare to',
      body: 'Number — test against a fixed level such as 60. Indicator — test against another indicator’s live value, for crossovers like EMA(20) crossing EMA(50) or Close above VWAP.',
      example: 'Future EMA(20) cross above Future EMA(50)',
      note: 'Available for single-value conditions (>, <, ≥, ≤, =, ≠, cross, above, below).',
    },
    compareInstrument: {
      title: 'Compare instrument',
      body: 'Leg the comparison indicator is calculated on. Usually the same leg; a different one lets you compare legs (e.g. Call RSI vs Put RSI).',
    },
    compareIndicator: { title: 'Compare indicator', body: 'The indicator whose value replaces the fixed number on the right-hand side.' },
    preview: { title: 'Preview', body: 'Your rules in plain language, exactly as the engine will read them.' },
  },

  backtest: {
    dateRange: {
      title: 'Date range',
      body: 'Period of historical candles to replay. Longer ranges fetch more data from Kite and take longer.',
      note: 'Kite limits historical requests (~3 per second), so a year of 15-minute data across many strikes can take a minute or more.',
    },
    underlyingGroup: {
      title: 'Underlying / Group',
      body: 'Run on one underlying, or on every member of a group and merge the results.',
    },
    from: { title: 'From', body: 'First day of the custom range (inclusive).' },
    to: { title: 'To', body: 'Last day of the custom range (inclusive).' },
    analyze: {
      title: 'Analyze',
      body: 'Fetch historical candles from Kite and replay the strategy. Results aren’t saved and never mix with live alerts.',
    },
    csv: { title: 'Export CSV', body: 'Download the signals as a CSV file (opens in Excel / Sheets).' },
    json: { title: 'Export JSON', body: 'Download the full result — signals, readings and stats — as JSON.' },
    xlsx: { title: 'Export Excel', body: 'Download an .xlsx workbook with the signals and summary stats.' },
    rsiPane: { title: 'RSI pane', body: 'Show or hide the FUT / CE / PE RSI lines with the 60 / 40 levels under the price chart.' },
    volume: { title: 'Volume', body: 'Show or hide volume bars (green = up candle, red = down candle).' },
    chart: {
      title: 'Chart',
      body: 'Future candles around the selected signal. Green ▲ under a candle = a bullish signal fired on that close.',
      note: 'Scroll to zoom, drag to pan. Price and RSI panes stay in sync.',
    },
    table: { title: 'Signals table', body: 'Every signal in the range. Click a row to jump the chart there and see why it fired. Click headers to sort.' },
    timeline: { title: 'Timeline', body: 'Signals in time order. Solid green dot = Scenario 1, green ring = Scenario 2, blue = custom rule.' },
    weekday: { title: 'Alerts by weekday', body: 'Which days the strategy fires on most. Darker = more signals.' },
    hour: { title: 'Alerts by trading hour', body: 'Which hours of the session the strategy fires in (IST). Darker = more signals.' },
    editRules: { title: 'Edit rules', body: 'Open this strategy in the Builder.' },
    liveStats: { title: 'Live stats', body: 'Real alerts this strategy has produced from your monitors (not from this backtest).' },
  },

  dashboard: {
    viewAll: { title: 'All alerts', body: 'Open the Alerts page: the live feed plus the full searchable history.' },
    goConfigure: { title: 'Configuration', body: 'Create a monitor (what to watch and which strategy) and activate it.' },
    performance: {
      title: 'Performance',
      body: 'How often your strategies fire — by day, underlying and week — the Scenario 1 / 2 split, and the most active contracts. Based on stored live alerts.',
      note: 'For a strategy’s historical behaviour, run a Backtest from Strategies.',
    },
  },

  alertsPage: {
    feed: { title: 'Feed', body: 'Alert cards with each leg’s RSI move — best while trading. New alerts appear automatically.' },
    table: { title: 'Table', body: 'Compact rows — best for reviewing and comparing many alerts.' },
    fresh: { title: 'New', body: 'Fired in the last 10 minutes.' },
    strategy: { title: 'Strategy', body: 'Show alerts from one strategy only — the built-in RSI Multi Confirmation or one of yours.' },
    market: {
      title: 'Market',
      body: 'Show alerts from one market: NSE/BSE index F&O or MCX commodities.',
    },
    noStrike: { title: 'No strike', body: 'A futures-only monitor (MCX product without listed options) — alerts carry no option strike.' },
    count: { title: 'Matching alerts', body: 'Alerts matching the filters (newest first, up to 500 shown). Narrow the dates to see older ones.' },
  },

  analytics: {
    perDay: { title: 'Alerts per day', body: 'Number of alerts on each day. Spikes show the days the setup appeared most.' },
    perWeek: { title: 'Alerts per week', body: 'Number of alerts in each ISO week (Mon–Sun).' },
    perUnderlying: { title: 'Alerts per underlying', body: 'Which indices produced the most alerts.' },
    byScenario: { title: 'Alerts by scenario', body: 'Split between Scenario 1 (all crossing) and Scenario 2 (future already above).' },
    byTimeframe: { title: 'Alerts by timeframe', body: 'Signals grouped by candle size.' },
    scenarioSplit: { title: 'Scenario split', body: 'Share of Scenario 1 (solid green) vs Scenario 2 (light green) alerts.' },
    mostActive: { title: 'Most active symbols', body: 'Underlying + strike combinations with the most alerts.' },
    close: { title: 'Close', body: 'Close this panel (or press Esc).' },
  },

  history: {
    scenario: { title: 'Scenario', body: 'Show only Scenario 1 (all crossing) or Scenario 2 (future already above) alerts.' },
    from: { title: 'From', body: 'Show alerts on or after this date.' },
    to: { title: 'To', body: 'Show alerts on or before this date.' },
    reset: { title: 'Reset filters', body: 'Clear every filter and show all alerts.' },
    exportCsv: { title: 'Export CSV', body: 'Download the alerts matching the current filters as a CSV file.' },
  },

  config: {
    mode: {
      title: 'Single or group',
      body: 'Single — one monitor for one underlying. Group — one monitor per member of an underlying group, created and switched together.',
    },
    group: { title: 'Group', body: 'A saved set of underlyings (e.g. all indices). Manage groups in the card below.' },
    rsiLevels: {
      title: 'RSI levels',
      body: 'Levels for the built-in strategy. Period = candles in the RSI; Future and Call must reach their level, Put must drop to its level.',
    },
    period: { title: 'RSI period', body: 'Candles in the RSI calculation. 14 is standard.' },
    futureLevel: { title: 'Future level', body: 'Future RSI must cross above (S1) or already be above (S2) this level.' },
    callLevel: { title: 'Call level', body: 'Call RSI must cross above this level.' },
    putLevel: { title: 'Put level', body: 'Put RSI must cross below this level.' },
    create: { title: 'Create monitor', body: 'Save this monitor. It starts idle — click Activate to begin watching.' },
    activate: {
      title: 'Activate',
      body: 'Start monitoring: resolves the expiry and ATM strike from live Kite prices, then evaluates every closed candle.',
      note: 'Requires a Kite connection.',
    },
    deactivate: { title: 'Deactivate', body: 'Stop monitoring. The monitor and its alert history are kept.' },
    delete: { title: 'Delete monitor', body: 'Remove this monitor and all of its alerts.' },
    activateAll: { title: 'Activate all', body: 'Start every monitor in this group.' },
    deactivateAll: { title: 'Deactivate all', body: 'Stop every monitor in this group.' },
    deleteGroup: { title: 'Delete group monitor', body: 'Remove every monitor in this group and their alerts.' },
    groupBadge: { title: 'Group monitor', body: 'One monitor per underlying, created from a group; each fires its own alerts.' },
  },

  mcx: {
    overview: { title: 'Overview', body: 'MCX session, the commodity products with their live contracts, your active MCX monitors and the latest MCX alerts.' },
    monitors: { title: 'Monitors', body: 'Create commodity monitors (product, strategy, contract month) and switch them on or off.' },
    backtest: { title: 'Backtest', body: 'Replay a strategy on MCX historical candles with the same engine as live alerts.' },
    session: {
      title: 'MCX session',
      body: 'MCX trades 09:00 IST until 23:30 while the US observes daylight saving (mid-March to early November), otherwise until 23:55 — weekdays.',
      note: 'MCX monitors are evaluated only during this session; NSE/BSE monitors keep their own 09:15–15:30 session.',
    },
    products: {
      title: 'MCX products',
      body: 'Commodities available for monitoring. Futures cover every listed monthly contract; options are used where MCX lists them.',
      note: 'Options trade actively mainly on Gold, Silver, Crude Oil, Copper, Zinc and Natural Gas.',
    },
    optionsLiquid: { title: 'Options', body: 'MCX lists options on this product and they trade actively, so option-leg strategies (Call / Put) work here.' },
    optionsListed: { title: 'Options (thin)', body: 'MCX lists options on this product but they trade lightly — option-leg readings may be sparse. Futures are the safer leg.' },
    futuresOnly: { title: 'Futures only', body: 'No options are listed on this product. Monitors and backtests run with the Future leg only, so the strategy must read just the Future.' },
    notSynced: {
      title: 'Not in the instrument master',
      body: 'No contracts for this product are synced yet. Connect Kite (Settings) and refresh instruments — MCX syncs separately from NSE/BSE.',
    },
    futures: { title: 'Futures', body: 'Live monthly futures contracts, nearest first. The nearest is usually the most traded.' },
    optionExpiries: { title: 'Option expiries', body: 'Upcoming option expiries. MCX options expire a few days before the future of the same series and devolve into it.' },
    strikeGap: { title: 'Strike gap', body: 'Distance between listed strikes, read from the instrument master. ATM snaps to the listed strike nearest the future price.' },
    product: { title: 'Product', body: 'Pick one product for a single monitor, or several to create one monitor per product (a group you switch on and off together).' },
    expiry: {
      title: 'Contract month',
      body: 'Near month = nearest contract, Next = the one after, Far = the third. With options listed this is the option expiry and the future is the contract the option devolves into; without options it is the futures expiry.',
    },
    strike: {
      title: 'Strike',
      body: 'ATM = the listed strike nearest the future price; ATM±1 / ±2 move along the listed strikes. Only used when the product has options.',
    },
    contract: { title: 'Contracts', body: 'The exact contracts this monitor locked when it was activated. They roll to the next month automatically after expiry.' },
    create: { title: 'Create monitor', body: 'Save the monitor(s). They start idle — click Activate to begin watching.' },
    groupName: { title: 'Group name', body: 'Name for the group of monitors created when several products are selected.' },
    toNse: { title: 'NSE/BSE monitors', body: 'Index monitors are managed on the Configuration page.' },
    dashboardStrip: {
      title: 'MCX commodities',
      body: 'Commodity monitors run in the MCX tab with their own session. This dashboard shows NSE/BSE monitors and alerts.',
    },
    toMcx: { title: 'Open MCX', body: 'Go to the MCX tab: products, commodity monitors and backtests.' },
    strategyNotHere: {
      title: 'Strategy pinned to NSE/BSE',
      body: 'Strategies fixed to NSE/BSE underlyings aren’t listed here. Universal strategies and MCX-pinned ones are.',
    },
  },

  groups: {
    title: { title: 'Underlying groups', body: 'Named sets of underlyings. Use them to create one monitor per member, or to backtest them together.' },
    preset: { title: 'Preset group', body: 'Built in and read-only.' },
    create: { title: 'Create group', body: 'Save the selected underlyings as a named group.' },
    delete: { title: 'Delete group', body: 'Remove this group. Monitors already created from it are not affected.' },
  },

  settings: {
    connect: { title: 'Connect Kite', body: 'Log in to Zerodha Kite; you’re returned here automatically.' },
    reconnect: { title: 'Reconnect', body: 'Log in again to refresh the session (e.g. after switching Kite accounts).' },
    disconnect: {
      title: 'Disconnect',
      body: 'Revoke the Kite session at Zerodha and remove it from the server.',
      note: 'Live monitoring and backtests pause until you connect again.',
    },
    refresh: {
      title: 'Refresh instruments',
      body: 'Download the latest F&O instrument lists from Kite now — NSE/BSE (NFO + BFO) and MCX. They also refresh automatically after login and daily.',
    },
    instruments: {
      title: 'Instrument master',
      body: 'Futures and options contracts known to the app, used to find expiries and ATM strikes. NSE/BSE and MCX sync separately, so one market’s refresh never affects the other.',
    },
    browserNotifications: { title: 'Browser notifications', body: 'Show a desktop notification for each new alert while the app is open.' },
    sound: { title: 'Sound alert', body: 'Play a short chime for each new alert.' },
    darkTheme: { title: 'Dark theme', body: 'Light is the default. The choice is saved to your account.' },
    testNotification: { title: 'Test notification', body: 'Send a sample desktop notification to check permissions.' },
    testSound: { title: 'Test sound', body: 'Play the alert chime.' },
    marketSession: { title: 'NSE/BSE session', body: 'Open 09:15–15:30 IST on weekdays. NSE/BSE monitors are evaluated only while it’s open.' },
    mcxSession: {
      title: 'MCX session',
      body: 'Open 09:00 IST on weekdays until 23:30 while the US observes daylight saving (mid-March to early November), otherwise until 23:55. MCX monitors are evaluated only while it’s open.',
    },
    lastRun: { title: 'Last evaluator run', body: 'When monitors were last evaluated, and what that run found.' },
    telegram: {
      title: 'Telegram',
      body: 'Server-side delivery: alerts reach your Telegram chat even when no dashboard is open.',
      note: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the server environment to enable.',
    },
  },
} as const;
