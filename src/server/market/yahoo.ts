/**
 * Yahoo Finance's public chart data: world markets, commodities, currencies, Sensex, and daily bars for pivot
 * levels. Unofficial and rate-limited, so symbols go 20 to a request (the spark endpoint) and results are cached.
 */
import type { GlobalGroup, GlobalQuote } from '@/shared/market/types';
import { getJson } from './fetcher';

export const GLOBAL: Array<{ symbol: string; name: string; group: GlobalGroup; unit: string }> = [
  { symbol: '^DJI', name: 'Dow Jones', group: 'US', unit: '' },
  { symbol: '^GSPC', name: 'S&P 500', group: 'US', unit: '' },
  { symbol: '^IXIC', name: 'Nasdaq', group: 'US', unit: '' },
  { symbol: '^VIX', name: 'US VIX', group: 'US', unit: '' },
  { symbol: '^FTSE', name: 'FTSE 100', group: 'Europe', unit: '' },
  { symbol: '^GDAXI', name: 'DAX', group: 'Europe', unit: '' },
  { symbol: '^FCHI', name: 'CAC 40', group: 'Europe', unit: '' },
  { symbol: '^N225', name: 'Nikkei 225', group: 'Asia', unit: '' },
  { symbol: '^HSI', name: 'Hang Seng', group: 'Asia', unit: '' },
  { symbol: '000001.SS', name: 'Shanghai', group: 'Asia', unit: '' },
  { symbol: '^KS11', name: 'Kospi', group: 'Asia', unit: '' },
  { symbol: '^TWII', name: 'Taiwan', group: 'Asia', unit: '' },
  { symbol: 'BZ=F', name: 'Brent crude', group: 'Commodities', unit: '$/bbl' },
  { symbol: 'GC=F', name: 'Gold', group: 'Commodities', unit: '$/oz' },
  { symbol: 'SI=F', name: 'Silver', group: 'Commodities', unit: '$/oz' },
  { symbol: 'HG=F', name: 'Copper', group: 'Commodities', unit: '$/lb' },
  { symbol: 'NG=F', name: 'Natural gas', group: 'Commodities', unit: '$/MMBtu' },
  { symbol: 'INR=X', name: 'USD/INR', group: 'Currency & rates', unit: '₹' },
  { symbol: 'DX-Y.NYB', name: 'Dollar index', group: 'Currency & rates', unit: '' },
  { symbol: '^TNX', name: 'US 10-year yield', group: 'Currency & rates', unit: '%' },
  { symbol: 'BTC-USD', name: 'Bitcoin', group: 'Crypto', unit: '$' },
];

/** Our headline symbols on Yahoo (intraday sparklines; Sensex's quote). */
export const YAHOO_OF_HEADLINE: Record<string, string> = {
  'NIFTY 50': '^NSEI',
  SENSEX: '^BSESN',
  'NIFTY BANK': '^NSEBANK',
  'NIFTY FIN SERVICE': 'NIFTY_FIN_SERVICE.NS',
  'NIFTY MIDCAP 100': 'NIFTY_MIDCAP_100.NS',
  'NIFTY SMLCAP 100': '^CNXSC',
  'INDIA VIX': '^INDIAVIX',
};

export interface YahooSeries {
  symbol: string;
  name: string | null;
  last: number;
  prevClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  points: number[];
}

interface RawMeta {
  symbol?: string;
  shortName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}
interface RawChart {
  meta?: RawMeta;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; open?: Array<number | null> }> };
}

const fin = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function seriesOf(r: RawChart | undefined, fallbackSymbol = ''): YahooSeries | null {
  const m = r?.meta;
  const last = fin(m?.regularMarketPrice);
  if (!m || last === null) return null;
  const points = (r?.indicators?.quote?.[0]?.close ?? []).filter((v): v is number => fin(v) !== null);
  return {
    symbol: m.symbol ?? fallbackSymbol,
    name: m.shortName ?? null,
    last,
    prevClose: fin(m.chartPreviousClose) ?? fin(m.previousClose),
    dayHigh: fin(m.regularMarketDayHigh),
    dayLow: fin(m.regularMarketDayLow),
    yearHigh: fin(m.fiftyTwoWeekHigh),
    yearLow: fin(m.fiftyTwoWeekLow),
    points,
  };
}

interface FlatSpark {
  symbol?: string;
  close?: Array<number | null>;
  previousClose?: number;
  chartPreviousClose?: number;
  fulldayPrice?: number;
}

/**
 * spark comes in two shapes: `{ "^NSEI": { close: [...], previousClose, fulldayPrice } }` (current) or
 * `{ spark: { result: [{ symbol, response: [chart] }] } }` (older).
 */
export function parseSpark(raw: Record<string, unknown>): Map<string, YahooSeries> {
  const out = new Map<string, YahooSeries>();
  const nested = (raw as { spark?: { result?: Array<{ symbol?: string; response?: RawChart[] }> } }).spark;
  if (nested) {
    for (const r of nested.result ?? []) {
      const s = seriesOf(r.response?.[0], r.symbol);
      if (s && r.symbol) out.set(r.symbol, s);
    }
    return out;
  }
  for (const [key, v] of Object.entries(raw)) {
    const f = v as FlatSpark;
    const points = (f?.close ?? []).filter((x): x is number => fin(x) !== null);
    const last = fin(f?.fulldayPrice) ?? points.at(-1) ?? null;
    if (last === null) continue;
    // This shape has closes only — no true day high / low.
    out.set(f.symbol ?? key, { symbol: f.symbol ?? key, name: null, last, prevClose: fin(f.chartPreviousClose) ?? fin(f.previousClose), dayHigh: null, dayLow: null, yearHigh: null, yearLow: null, points });
  }
  return out;
}

/** Today's line for up to 20 symbols per request. */
export async function fetchSpark(symbols: string[], interval = '15m'): Promise<Map<string, YahooSeries>> {
  const out = new Map<string, YahooSeries>();
  for (let i = 0; i < symbols.length; i += 20) {
    const batch = symbols.slice(i, i + 20);
    const raw = await getJson<Record<string, unknown>>(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(batch.join(','))}&range=1d&interval=${interval}`);
    for (const [k, v] of parseSpark(raw)) out.set(k, v);
  }
  return out;
}

export function globalQuotes(series: Map<string, YahooSeries>): GlobalQuote[] {
  return GLOBAL.flatMap((g) => {
    const s = series.get(g.symbol);
    if (!s) return [];
    const change = s.prevClose !== null ? s.last - s.prevClose : null;
    return [{ ...g, last: s.last, prevClose: s.prevClose, change, pct: change !== null && s.prevClose ? Math.round((change / s.prevClose) * 10_000) / 100 : null, spark: thin(s.points, 60) }];
  });
}

/** At most `n` points (evenly picked, always keeping the last). */
export function thin(points: number[], n: number): number[] {
  if (points.length <= n) return points;
  const step = (points.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => points[Math.round(i * step)]!);
}

export interface DailyBar {
  /** IST date. */
  date: string;
  high: number;
  low: number;
  close: number;
}

/** Complete daily bars (oldest first), plus the latest session from the quote (its bar can lag), for pivots. */
export async function fetchDaily(symbol: string): Promise<{ bars: DailyBar[]; last: number | null; session: DailyBar | null }> {
  const raw = await getJson<{ chart?: { result?: Array<RawChart & { meta?: RawMeta & { regularMarketTime?: number } }> } }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d`);
  const r = raw.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  const istDay = (sec: number) => new Date(sec * 1000 + 330 * 60_000).toISOString().slice(0, 10);
  const bars: DailyBar[] = [];
  (r?.timestamp ?? []).forEach((t, i) => {
    const high = fin(q?.high?.[i]);
    const low = fin(q?.low?.[i]);
    const close = fin(q?.close?.[i]);
    if (high !== null && low !== null && close !== null) bars.push({ date: istDay(t), high, low, close });
  });
  const m = r?.meta;
  const [h, l, c, t] = [fin(m?.regularMarketDayHigh), fin(m?.regularMarketDayLow), fin(m?.regularMarketPrice), fin(m?.regularMarketTime)];
  return { bars, last: c, session: h !== null && l !== null && c !== null && t !== null ? { date: istDay(t), high: h, low: l, close: c } : null };
}

/** One NSE stock's intraday line and 52-week range (`RELIANCE` → RELIANCE.NS). */
export async function fetchStockChart(symbol: string): Promise<YahooSeries | null> {
  const raw = await getJson<{ chart?: { result?: RawChart[] } }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${symbol}.NS`)}?range=1d&interval=5m`);
  return seriesOf(raw.chart?.result?.[0], symbol);
}
