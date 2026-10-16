/**
 * Tooltips for the market eagle view — every section, control and badge explains itself (what it is, how to read
 * it, where the data comes from).
 */
import type { TooltipContent } from '../components/Tooltip';

type Help = TooltipContent;

export const M = {
  page: {
    title: 'Market — eagle view',
    body: 'The whole Indian market on one screen: indices, breadth, sectors, every Nifty 500 stock, movers, F&O positioning, money flows, the world, news and the corporate calendar. It refreshes itself while open.',
    note: 'Built from your Kite session and free public data (NSE website, Yahoo Finance, news sites). Unofficial sources can be late or wrong — information, not advice.',
  } satisfies Help,
  session: {
    title: 'Market session (IST)',
    body: 'NSE cash market: pre-open 09:00–09:15, normal market 09:15–15:30 on trading days. While open, prices refresh every 20–30 seconds; when closed, every few minutes.',
  } satisfies Help,
  refresh: { title: 'Refresh now', body: 'Fetch every panel again instead of waiting for its next automatic update.' } satisfies Help,
  liveSource: {
    title: 'Where stock prices come from',
    body: 'Kite live: every Nifty 500 stock from your Kite session, every 15–20 seconds. NSE: without a Kite login, the stocks of NSE’s sector indices (about 250), every 2 minutes.',
  } satisfies Help,
  nav: { title: 'Jump to a section', body: 'Scroll straight to that part of the page.' } satisfies Help,

  pulse: {
    title: 'Index pulse',
    body: 'The headline indices: level, change today, today’s line (dotted = yesterday’s close), where it sits in today’s range, and how far from its 52-week high.',
    note: 'Sensex from Yahoo Finance; the rest from NSE.',
  } satisfies Help,
  dayRange: { title: 'Day range', body: 'Today’s low to high, with the marker at the current level. Near the right edge = trading near the day’s high.' } satisfies Help,
  yearRange: { title: '52-week position', body: 'How far the index is below its highest level of the last year (0% = at the high).' } satisfies Help,
  vix: {
    title: 'India VIX — the fear gauge',
    body: 'The market’s expected volatility for the next 30 days, from Nifty option prices. Rising VIX = traders paying more for protection.',
    note: 'Rough bands: under 12 very calm · 12–16 calm · 16–20 moderate · 20–25 elevated · above 25 fearful.',
  } satisfies Help,

  story: {
    title: 'The market in 30 seconds',
    body: 'Plain sentences written from the numbers on this page — index, breadth, mid & small caps, sectors, volatility, FII / DII money, FII futures positioning, options and the world.',
    note: 'Arrows show the direction of what each line describes, not a recommendation.',
  } satisfies Help,
  breadth: {
    title: 'Market breadth',
    body: 'How many stocks rose (green) vs fell (red) in each index. An index can rise on a few heavyweights while most stocks fall — breadth shows whether a move is broad or narrow.',
    example: 'Nifty +1% with 400 of 500 stocks up = broad rally · Nifty +1% with 150 up = narrow, large-cap-led',
  } satisfies Help,
  highsLows: { title: '52-week highs vs lows', body: 'NSE stocks that made a new 52-week high (green) or low (red) today. More highs than lows = an expanding uptrend.' } satisfies Help,

  sectors: {
    title: 'Sector board',
    body: 'Every NSE sector, theme or style index ranked by its move over the chosen period. The small bar shows its stocks up vs down today. Click a sector to show its stocks on the market map.',
    note: 'From NSE (all indices). P/E is the index’s price-to-earnings.',
  } satisfies Help,
  sectorKind: {
    sectors: { title: 'Sectors', body: 'NSE’s sector indices: banks, IT, auto, pharma, metal, energy, realty…' } satisfies Help,
    themes: { title: 'Themes', body: 'Thematic indices: defence, railway PSUs, EV, digital, housing, CPSE, manufacturing, IPOs…' } satisfies Help,
    styles: { title: 'Styles (factors)', body: 'Which kind of stock is in favour: momentum, quality, value, low volatility, alpha, high beta.' } satisfies Help,
  },
  period: {
    '1d': { title: 'Today', body: 'Change since yesterday’s close.' } satisfies Help,
    '1w': { title: '1 week', body: 'Change over the last week.' } satisfies Help,
    '1m': { title: '1 month', body: 'Change over the last 30 days.' } satisfies Help,
    '1y': { title: '1 year', body: 'Change over the last 365 days.' } satisfies Help,
  },
  rotation: {
    title: 'Sector rotation',
    body: 'Each sector’s 1-month move (across) and 1-week move (up / down), both measured against the Nifty 50. Money tends to rotate clockwise: Improving → Leading → Weakening → Lagging.',
    note: 'Leading: beating the Nifty over the month and the week · Weakening: strong month, weak week · Lagging: weak both · Improving: weak month, strong week.',
  } satisfies Help,

  map: {
    title: 'Market map',
    body: 'Every stock as a tile, grouped by sector: green up, red down, deeper colour = bigger move (the % is printed on the tile). Tile size = money traded today, so the big tiles are where the action is. Hover for details, click for the company panel.',
  } satisfies Help,
  universe: {
    nifty50: { title: 'Nifty 50', body: 'The 50 largest companies.' } satisfies Help,
    nifty100: { title: 'Nifty 100', body: 'Nifty 50 + Nifty Next 50.' } satisfies Help,
    nifty500: { title: 'Nifty 500', body: 'The 500 largest companies — about 95% of NSE’s market value.' } satisfies Help,
    midcap150: { title: 'Midcap 150', body: 'Companies ranked 101–250 by size.' } satisfies Help,
    smallcap250: { title: 'Smallcap 250', body: 'Companies ranked 251–500 by size.' } satisfies Help,
    fno: { title: 'F&O stocks', body: 'Stocks with futures & options — where traders take leveraged positions.' } satisfies Help,
  },
  sizeBy: {
    value: { title: 'Size by traded value', body: 'Bigger tile = more money traded today (square-root scaled, so smaller stocks stay visible).' } satisfies Help,
    equal: { title: 'Equal size', body: 'Every stock the same size — read the colour pattern only.' } satisfies Help,
  },
  sectorFilter: { title: 'Sector filter', body: 'Showing one sector only. Click × to show all sectors again.' } satisfies Help,
  colourKey: { title: 'Colour key', body: 'Grey = flat (under ±0.25%). Then deeper green / red at ±1%, ±2%, ±3% and ±5%.' } satisfies Help,
  alertBadge: { title: 'Your alerts today', body: 'Your V2 strategies alerted on this stock today.' } satisfies Help,

  movers: {
    title: 'Movers',
    body: 'Lists that pros scan every day — biggest moves, where the money is, unusual volume, new highs, gaps and opening setups. Click a stock for its panel.',
  } satisfies Help,
  moverTab: {
    gainers: { title: 'Top gainers', body: 'Biggest rises today in the chosen universe.' } satisfies Help,
    losers: { title: 'Top losers', body: 'Biggest falls today in the chosen universe.' } satisfies Help,
    active: { title: 'Most active by value', body: 'Most money traded today — where institutions are busy.' } satisfies Help,
    volume: { title: 'Volume shockers', body: 'Volume far above the stock’s 1-week average (NSE, all stocks). Unusual volume often comes before or with news.' } satisfies Help,
    highs: { title: '52-week highs', body: 'Stocks at a new 52-week high today (NSE, all stocks) — strength.' } satisfies Help,
    lows: { title: '52-week lows', body: 'Stocks at a new 52-week low today (NSE, all stocks) — weakness.' } satisfies Help,
    gapUp: { title: 'Gap up', body: 'Opened at least 1% above yesterday’s close.' } satisfies Help,
    gapDown: { title: 'Gap down', body: 'Opened at least 1% below yesterday’s close.' } satisfies Help,
    openLow: { title: 'Open = Low', body: 'Opened at the day’s low and are higher now — buyers in control since the open. A classic intraday long setup.' } satisfies Help,
    openHigh: { title: 'Open = High', body: 'Opened at the day’s high and are lower now — sellers in control since the open. A classic intraday short setup.' } satisfies Help,
    circuits: { title: 'Circuits', body: 'Stocks locked at their upper / lower price band for the day (needs Kite).' } satisfies Help,
    preOpen: { title: 'Pre-open', body: 'Indicative opening prices of F&O stocks from NSE’s 09:00–09:08 call auction.' } satisfies Help,
  },
  watch: { title: 'Watchlist', body: 'Pin a stock to the strip at the top of this page. Kept in this app on this computer.' } satisfies Help,
  watchStrip: { title: 'Your watchlist', body: 'Your pinned stocks with today’s move. Click one for its panel; pin or unpin from any stock’s panel or list.' } satisfies Help,

  fno: {
    title: 'F&O pulse',
    body: 'What derivatives traders are doing: the index option chains, open-interest build-up in stocks, who holds index futures, and futures premium.',
  } satisfies Help,
  chain: {
    title: 'Index option chain',
    body: 'Nifty and Bank Nifty options at the nearest expiry (from your Kite session): open interest by strike, put-call ratio, max pain, OI walls, and the move the ATM straddle prices in.',
  } satisfies Help,
  pcr: { title: 'PCR (put-call ratio)', body: 'Put open interest ÷ call open interest. Above 1 = more puts written (writers expect support); below ~0.7 = calls dominate (resistance above).', note: 'Very high or very low readings are often read as contrarian.' } satisfies Help,
  maxPain: { title: 'Max pain', body: 'The expiry level at which option buyers lose the most (writers pay the least). Prices often drift towards it near expiry.' } satisfies Help,
  callWall: { title: 'Call wall (resistance)', body: 'The strike with the most call open interest — sellers defend it, so it often acts as resistance.' } satisfies Help,
  putWall: { title: 'Put wall (support)', body: 'The strike with the most put open interest — writers defend it, so it often acts as support.' } satisfies Help,
  straddle: { title: 'Expected move', body: 'ATM call + put premium = the move (either way) the options market prices in by expiry. The range is spot ± that amount.' } satisfies Help,
  oiChart: { title: 'Open interest by strike', body: 'Call OI to the left (violet), put OI to the right (pink), strikes around the money; the dashed line is spot.' } satisfies Help,
  buildup: {
    title: 'OI build-up',
    body: 'Price move × change in open interest (NSE) shows who is acting: new longs, new shorts, shorts covering, or longs exiting.',
  } satisfies Help,
  buildupKind: {
    long: { title: 'Long build-up', body: 'Price up + open interest up: new buyers entering — bullish.' } satisfies Help,
    short: { title: 'Short build-up', body: 'Price down + open interest up: new sellers entering — bearish.' } satisfies Help,
    covering: { title: 'Short covering', body: 'Price up + open interest down: sellers exiting — a rally that may fade once covering ends.' } satisfies Help,
    unwinding: { title: 'Long unwinding', body: 'Price down + open interest down: buyers exiting — weakness without fresh shorts.' } satisfies Help,
  },
  participants: {
    title: 'Who holds index futures',
    body: 'NSE’s participant-wise open interest, end of each day: FIIs (foreign), DIIs (domestic institutions), Pros (brokers’ own trading) and Clients (retail). FII long % in index futures is watched closely — very low means FIIs are heavily short.',
    note: 'Contracts. Net = long − short.',
  } satisfies Help,
  basis: { title: 'Futures premium', body: 'Near-month index futures minus the index. A premium shows buyers willing to pay up; a discount often comes with short positions or dividends.' } satisfies Help,

  levels: {
    title: 'Key levels (pivots & CPR)',
    body: 'Floor-trader pivots from the last completed session: pivot P, support S1–S3, resistance R1–R3, and the central pivot range (BC–TC). The marker shows today’s level.',
    note: 'A narrow CPR (under ~0.25% of price) often comes before a trending day; a wide one before a range day. Above the CPR = buyers’ zone, below = sellers’.',
  } satisfies Help,

  flows: {
    title: 'Money flow',
    body: 'Who bought and sold in the cash market: FIIs / FPIs (foreign) and DIIs (Indian funds, insurers), ₹ crore, from NSE — published in the evening for that day.',
    note: 'NSE publishes only the latest day; this app keeps each day it sees, so the history grows over time.',
  } satisfies Help,
  deals: { title: 'Bulk & block deals', body: 'Large trades reported to NSE today (block: ≥ ₹10 Cr in the block window; bulk: > 0.5% of a company’s shares). Who bought or sold big.' } satisfies Help,

  world: {
    title: 'World',
    body: 'Overnight and live global cues: US, Europe and Asian markets, crude, metals, the rupee, the dollar index, US yields and bitcoin (Yahoo Finance; each at its own market’s last price).',
    note: 'Up / down is against each market’s previous close.',
  } satisfies Help,

  news: {
    title: 'News & innovation',
    body: 'Headlines from Economic Times, Mint, Business Standard, Inc42 and YourStory, newest first. Companies mentioned are tagged with today’s move — click a tag for its panel.',
  } satisfies Help,
  newsCat: {
    all: { title: 'All news', body: 'Every category together.' } satisfies Help,
    markets: { title: 'Markets', body: 'Stock market news and analysis.' } satisfies Help,
    economy: { title: 'Economy', body: 'Macro: inflation, RBI, GDP, trade, policy.' } satisfies Help,
    companies: { title: 'Companies', body: 'Results, orders, deals, management news.' } satisfies Help,
    tech: { title: 'Tech', body: 'Technology and innovation news.' } satisfies Help,
    startups: { title: 'Startups', body: 'Startups, funding and new-age companies (Inc42, YourStory).' } satisfies Help,
  },
  newsFilter: {
    watch: { title: 'Watchlist only', body: 'Only headlines about your pinned stocks.' } satisfies Help,
    movers: { title: 'Today’s movers', body: 'Only headlines about stocks moving more than 3% today — why they’re moving.' } satisfies Help,
    search: { title: 'Search', body: 'Filter headlines by any word, company or symbol.' } satisfies Help,
  },

  calendar: {
    title: 'Calendar',
    body: 'What’s coming: results and board meetings (next 3 weeks), dividend / split / bonus ex-dates, and the latest company announcements (NSE).',
  } satisfies Help,
  calTab: {
    events: { title: 'Results & meetings', body: 'Board meetings for results, dividends, fund raising — the dates stocks move on.' } satisfies Help,
    actions: { title: 'Corporate actions', body: 'Ex-dates for dividends, splits and bonuses: buy before the ex-date to be entitled.' } satisfies Help,
    announcements: { title: 'Announcements', body: 'The latest filings companies made to NSE (orders, results, acquisitions, investor meets).' } satisfies Help,
  },
  only500: { title: 'Nifty 500 only', body: 'Hide smaller companies; untick to see every NSE company.' } satisfies Help,

  company: {
    title: 'Company panel',
    body: 'One stock in depth: today’s move and range, 52-week range, today’s line, news (Google News), filings and upcoming events.',
  } satisfies Help,
  openV2: { title: 'Use in a strategy', body: 'Open V2 Products to connect your strategies to this stock (it must be synced from Kite).' } satisfies Help,
  external: {
    nse: { title: 'Open on NSE', body: 'The stock’s page on nseindia.com (opens in your browser).' } satisfies Help,
    chart: { title: 'Open chart', body: 'A full TradingView chart of the stock (opens in your browser).' } satisfies Help,
  },
  close: { title: 'Close', body: 'Close the company panel (or press Esc).' } satisfies Help,

  sources: {
    title: 'Data sources',
    body: 'Each source behind this page and when it last answered. A red one isn’t answering right now; its panels show the last data they had.',
  } satisfies Help,
} as const;
