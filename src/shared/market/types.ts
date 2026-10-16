/**
 * Market eagle view — the whole Indian market on one screen. Shapes shared by the server (src/server/market) and
 * the page (src/client/market). Everything is read-only market data from free sources; nothing is stored in the
 * database.
 */

/** NSE cash market session right now. */
export type MarketSession = 'pre-open' | 'open' | 'closed';

/** One data source behind the view and how it's doing (shown at the bottom of the page). */
export interface SourceState {
  id: string;
  label: string;
  ok: boolean;
  /** When it last answered (ISO). */
  at: string | null;
  error?: string;
}

export type IndexGroup = 'broad' | 'sector' | 'theme' | 'style' | 'other';

export interface IndexQuote {
  /** NSE's symbol, e.g. "NIFTY 50", "NIFTY IT"; "SENSEX" for BSE. */
  symbol: string;
  /** Short display name: "Nifty 50", "IT", "Defence". */
  name: string;
  group: IndexGroup;
  last: number;
  change: number;
  pct: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  pe: number | null;
  pb: number | null;
  dy: number | null;
  pct1w: number | null;
  pct1m: number | null;
  pct1y: number | null;
}

/** A headline index tile: the quote plus today's intraday line. */
export interface HeadlineIndex extends IndexQuote {
  spark: number[] | null;
}

/** Floor-trader pivots and the central pivot range from the last completed session. */
export interface PivotLevels {
  symbol: string;
  name: string;
  /** The session the levels come from. */
  basis: { date: string; high: number; low: number; close: number };
  pivot: number;
  /** Central pivot range: bottom / top. */
  bc: number;
  tc: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
  /** CPR width as % of the pivot — narrow (< ~0.25%) often precedes a trending day. */
  cprWidthPct: number;
  last: number | null;
  /** Where the price is against the CPR. */
  position: 'above' | 'inside' | 'below' | null;
}

export interface FlowSide {
  buy: number;
  sell: number;
  net: number;
}

/** FII / DII cash-market activity for one day, ₹ crore. */
export interface Flow {
  date: string;
  fii: FlowSide;
  dii: FlowSide;
}

export type Participant = 'FII' | 'DII' | 'Pro' | 'Client';

export interface ParticipantPositions {
  futIdxLong: number;
  futIdxShort: number;
  futStkLong: number;
  futStkShort: number;
  callLong: number;
  putLong: number;
  callShort: number;
  putShort: number;
}

/** Who holds what in index / stock derivatives at the end of a day (NSE participant-wise OI, contracts). */
export interface ParticipantDay {
  date: string;
  rows: Record<Participant, ParticipantPositions>;
}

/** Index futures vs the index (premium = futures above spot). */
export interface FuturesBasis {
  symbol: string;
  expiry: string;
  last: number;
  spot: number;
  basis: number;
  basisPct: number;
  pct: number;
  oi: number | null;
}

export interface MarketOverview {
  at: string;
  status: { session: MarketSession; label: string; tradeDate: string | null };
  headline: HeadlineIndex[];
  /** Every NSE index (sectors, themes, styles, broad). */
  indices: IndexQuote[];
  /** Count of NSE stocks at a new 52-week high / low today. */
  highsLows: { highs: number; lows: number } | null;
  flows: { latest: Flow | null; history: Flow[] };
  /** Newest first, up to 5 days. */
  participants: ParticipantDay[];
  pivots: PivotLevels[];
  futures: FuturesBasis[];
  sources: SourceState[];
}

// ---- stocks ---------------------------------------------------------------------------------------

export type Universe = 'nifty50' | 'nifty100' | 'nifty500' | 'midcap150' | 'smallcap250' | 'fno';

/** Index membership of a stock. */
export type StockGroup = 'N50' | 'NN50' | 'MID150' | 'SML250';

export interface MapStock {
  symbol: string;
  name: string;
  /** NSE's macro sector ("Information Technology", "Capital Goods"…). */
  sector: string;
  ltp: number;
  pct: number;
  change: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  /** Traded value today, ₹. */
  value: number;
  volume: number;
  groups: StockGroup[];
  /** Has futures & options. */
  fno: boolean;
  /** At its upper / lower circuit limit (Kite only). */
  circuit: 'upper' | 'lower' | null;
  /** Your strategy alerts on this stock today. */
  alerts: number;
}

export interface MarketMap {
  at: string;
  /** kite = live Nifty 500 quotes from your Kite session; nse = NSE's sector-index data (no Kite needed). */
  source: 'kite' | 'nse';
  note: string | null;
  stocks: MapStock[];
}

export interface StockMove {
  symbol: string;
  name: string;
  ltp: number;
  pct: number;
  value?: number;
}

export interface VolumeShocker extends StockMove {
  volume: number;
  avgVolume: number;
  /** Today's volume ÷ the 1-week average. */
  times: number;
}

export type OiBuildup = 'long' | 'short' | 'covering' | 'unwinding';

export interface OiMove {
  symbol: string;
  name: string;
  pct: number;
  /** Open-interest change vs the previous day, %. */
  oiPct: number;
  oi: number;
  ltp: number;
  kind: OiBuildup;
}

export interface Deal {
  kind: 'bulk' | 'block';
  date: string;
  symbol: string;
  name: string;
  client: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  /** ₹. */
  value: number;
}

export interface MoversData {
  at: string;
  highs52: StockMove[];
  lows52: StockMove[];
  volumeShockers: VolumeShocker[];
  mostActive: StockMove[];
  oi: OiMove[];
  deals: Deal[];
  /** Indicative opening prices during pre-open (09:00–09:08); null outside it. */
  preOpen: StockMove[] | null;
  sources: SourceState[];
}

// ---- index options (Kite) ---------------------------------------------------------------------------

export interface OptionStrikeRow {
  strike: number;
  callOi: number;
  putOi: number;
  callLtp: number | null;
  putLtp: number | null;
}

export interface OptionSnapshot {
  underlying: string;
  name: string;
  expiry: string;
  daysToExpiry: number;
  spot: number;
  atm: number;
  /** Put open interest ÷ call open interest (strikes shown). */
  pcr: number | null;
  /** Expiry level where option buyers lose the most (sellers pay least). */
  maxPain: number | null;
  callWall: { strike: number; oi: number } | null;
  putWall: { strike: number; oi: number } | null;
  /** ATM call + put — the move the options market prices in until expiry. */
  straddle: { strike: number; call: number; put: number; total: number; movePct: number } | null;
  strikes: OptionStrikeRow[];
}

export interface OptionsData {
  at: string;
  available: boolean;
  reason: string | null;
  chains: OptionSnapshot[];
}

// ---- world ------------------------------------------------------------------------------------------

export type GlobalGroup = 'US' | 'Europe' | 'Asia' | 'Commodities' | 'Currency & rates' | 'Crypto';

export interface GlobalQuote {
  symbol: string;
  name: string;
  group: GlobalGroup;
  last: number;
  prevClose: number | null;
  change: number | null;
  pct: number | null;
  spark: number[];
  unit: string;
}

export interface GlobalData {
  at: string;
  quotes: GlobalQuote[];
  sources: SourceState[];
}

// ---- news, calendar, company --------------------------------------------------------------------------

export type NewsCategory = 'markets' | 'economy' | 'companies' | 'tech' | 'startups';

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  /** ISO. */
  at: string | null;
  category: NewsCategory;
  summary: string;
  /** NSE symbols the headline is about. */
  symbols: string[];
  /** Sectors it's about. */
  sectors: string[];
}

export interface NewsData {
  at: string;
  items: NewsItem[];
  sources: SourceState[];
}

export interface CalendarEvent {
  symbol: string;
  company: string;
  purpose: string;
  detail: string;
  /** yyyy-mm-dd. */
  date: string;
}

export interface CorporateAction {
  symbol: string;
  company: string;
  subject: string;
  exDate: string;
  recordDate: string | null;
}

export interface Announcement {
  symbol: string;
  company: string;
  subject: string;
  text: string;
  at: string;
  link: string | null;
}

export interface CalendarData {
  at: string;
  events: CalendarEvent[];
  actions: CorporateAction[];
  announcements: Announcement[];
  sources: SourceState[];
}

export interface CompanyData {
  symbol: string;
  name: string;
  sector: string;
  groups: StockGroup[];
  fno: boolean;
  /** V2 product id when it can be connected to a strategy ("NSE:RELIANCE"). */
  productId: string | null;
  quote: MapStock | null;
  range52: { low: number; high: number } | null;
  spark: number[];
  sparkPrev: number | null;
  news: NewsItem[];
  announcements: Announcement[];
  events: CalendarEvent[];
  actions: CorporateAction[];
  sources: SourceState[];
}
