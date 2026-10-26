/** Tooltip wording for the landing page's controls and chips. */
import type { TooltipContent } from '@/client/components/Tooltip';

export const LANDING_HELP = {
  openApp: {
    title: 'Open Algo Hunt',
    body: 'Sign in with the app password, then the app opens: strategies, connections, alerts, paper trading, backtests, Equity and Market.',
    note: 'Already signed in on this browser? It goes straight in.',
  },
  clock: {
    title: 'India time (IST)',
    body: 'The clock every candle, alert and square-off in Algo Hunt runs on.',
  },
  liveData: {
    title: 'Real market data',
    body: 'Alerts are worked out from your Zerodha Kite session: live ticks, then Kite’s own candles to confirm. NSE and BSE indices, NSE stocks, MCX commodities.',
  },
  seeItWork: { title: 'See it work', body: 'Scrolls to the walkthrough, one feature at a time.' },
  board: {
    title: 'Alert board',
    body: 'Each row is a strategy firing on a product: when, which leg, direction, and how long after the candle close it was decided.',
    note: 'Example rows. Your board fills with your own strategies.',
  },

  presets: {
    lead: {
      title: 'Future leads the call',
      body: 'Two legs. The future’s RSI is above the ATM call’s RSI, and the call’s RSI crosses 60.',
      example: 'A · FUT RSI(14) > B · CE ATM RSI(14)\nB · CE ATM RSI(14) crossed above 60',
    },
    callPut: {
      title: 'Call up, put down',
      body: 'The ATM call’s RSI crosses 60 while the ATM put’s RSI stays under 40.',
    },
    four: {
      title: 'Future + 3 options',
      body: 'All four legs: the future, the ATM call, the ATM put and the call one strike up, each with its own rule.',
    },
    spot: {
      title: 'Spot breakout',
      body: 'One leg. The close breaks the highest high of the previous 20 candles. Works on cash stocks too.',
    },
  },
  personas: {
    scalpers: {
      title: 'Index option scalpers',
      body: 'NIFTY, BANKNIFTY, FINNIFTY, SENSEX: ATM calls and puts that roll with the strike, 1–15 min triggers, signals about 2 s after the candle close.',
    },
    options: {
      title: 'Option buyers & writers',
      body: 'CE / PE legs at ATM ±3 strikes on the current, next or far expiry, and paper trades that Buy or Sell. OI build-up, PCR, max pain and call / put walls on the Market page.',
    },
    stocks: {
      title: 'F&O stock traders',
      body: 'About 210 F&O stocks with FUT, CE and PE legs. Connect one strategy to all of them in one go; Compare shows where it fires most.',
    },
    mcx: {
      title: 'MCX night desk',
      body: 'Crude oil, natural gas, gold, silver and copper with their real lot units. The live stream keeps alerting until MCX closes (23:30 / 23:55).',
    },
    swing: {
      title: 'Swing & positional traders',
      body: 'Daily or weekly close strategies on every NSE stock and 212 indices: 52-week breakouts, golden crosses, Supertrend, RSI-MA crosses. The screener lists fresh signals.',
    },
    pyramid: {
      title: 'Trend pyramiders',
      body: 'Add a lot each time the rising MA reaches your last buy, with one stop for every lot; target and trailing SL in the same strategy.',
    },
  },
  patterns: {
    title: 'Candlestick patterns',
    body: 'Doji, hammer, engulfing, harami, piercing, morning / evening star, three white soldiers, three black crows, marubozu, shooting star, hanging man, dark cloud cover.',
  },
  oiValue: { title: 'OI as a value', body: 'Open interest can be read like price or volume, so a rule can compare OI on any leg and timeframe.' },
  anyLeg: { title: 'Any leg vs any leg', body: 'Compare a future with a call, a call with a put, or any value with a number.' },
  groups: { title: 'AND / OR / NOT groups', body: 'Nest conditions in groups and name them (e.g. “Bullish”, “Bearish”) so alerts read clearly.' },
  timeframes: { title: 'Timeframe per value', body: 'Each value has its own timeframe and candle type, so a 15-min trigger can read a 1-hour RSI.' },
  candles: { title: 'Candle types', body: 'Normal, Heikin Ashi or volume candles, per value.' },
  versions: { title: 'Every save is a version', body: 'Alerts show which version of the strategy fired.' },

  radarFilter: {
    all: { title: 'Everything', body: 'NSE / BSE indices, NSE stocks and MCX commodities on one scope.' },
    idx: { title: 'Indices', body: 'NIFTY, BANKNIFTY, FINNIFTY, SENSEX and the rest: spot, future and weekly options.' },
    stk: { title: 'Stocks', body: 'NSE stocks. F&O stocks get FUT / CE / PE legs; cash-only stocks get SPOT.' },
    mcx: { title: 'MCX', body: 'Commodities with their real lot units: crude, natural gas, gold, silver, copper…' },
  },
  period: {
    d5: { title: '5 days', body: 'Count the alerts the strategy would have given over the last 5 trading days.' },
    d10: { title: '10 days', body: 'The last 10 trading days.' },
    max: { title: 'Max', body: 'As far back as the trigger timeframe allows on Kite.' },
  },
  replay: { title: 'Replay', body: 'Runs the animation again from the candle close.' },
  scrub: {
    title: 'Rewind',
    body: 'Drag (or use the arrow keys) to see the result as it stood on any date: capital, win rate, drawdown, months.',
  },
  aiPrompt: { title: 'Example prompt', body: 'Shows how this sentence becomes builder rules.' },

  btOrders: { title: 'Every order and why', body: 'Each trade lists its orders with the indicator values at the signal, so you can check it on the chart.' },
  btBenchmark: { title: 'Benchmark', body: 'The result next to simply buying and holding NIFTY 50 over the same period.' },
  btNoCaps: { title: 'No caps', body: 'Any products, any period. Big tests run in the background with progress and time left; candles are cached.' },
  btHistory: { title: 'Backtest history', body: 'Every finished backtest is kept: open it exactly as it was, run it again, or delete it.' },
  btCsv: { title: 'CSV export', body: 'Every matching trade as a spreadsheet.' },

  eqTimeframe: { title: 'Checked on', body: 'Daily close or weekly close, chosen once per strategy: every buy, exit and pyramiding value uses those candles.' },
  eqUniverse: { title: 'Universe', body: 'All NSE stocks, all 212 NSE and BSE indices, index presets and your watchlists.' },
  eqScreener: {
    title: 'Screener',
    body: 'Each stock at its last close: entry true, fresh signal (true now, not at the check before) or exit true, with every condition’s values.',
  },
  eqWatchlists: { title: 'Watchlists', body: 'Your own stock lists, started from an index list or picked one by one.' },
  eqTradingView: {
    title: 'TradingView links',
    body: 'Every stock in trades, by-stock, skipped and screener lists opens its TradingView chart on the strategy’s candles.',
  },

  mkLevels: { title: 'Key levels', body: 'Pivots S3–R3 and the central pivot range for Nifty, Bank Nifty, Fin Nifty and Sensex, with CPR width.' },
  mkParticipants: { title: 'Who holds index F&O', body: 'FII, DII, Pro and Client positions, and the FII long % over five days.' },
  mkWorld: { title: 'World', body: 'US, Europe and Asia indices; Brent, gold, silver, copper, natural gas; USD/INR, the dollar index and US yields.' },
  mkNews: { title: 'News', body: 'Business news, newest first, tagged with the companies it mentions and their move today.' },
  mkBells: { title: 'Your alerts on the map', body: 'A bell marks every stock your strategies alerted on today.' },
} satisfies Record<string, TooltipContent | Record<string, TooltipContent>>;
