/**
 * The market eagle view's data: indices, breadth, sectors, every Nifty 500 stock, movers, F&O positioning, option
 * chains, money flows, the world, news and the corporate calendar. Each piece is cached for as long as it's
 * worth (seconds while the market is open, longer when it's closed), so the page can poll freely and the free
 * sources see a few requests a minute. Kite (when logged in) gives live quotes for every stock and the option
 * chains; everything else is public data — the view works without Kite, with less.
 */
import { inUniverse, oiBuildup, optionStats, pivotLevels } from '@/shared/market/analytics';
import { HEADLINE, HEADLINE_NAMES, SECTOR_INDICES } from '@/shared/market/indices';
import type {
  CalendarData,
  CompanyData,
  GlobalData,
  HeadlineIndex,
  IndexQuote,
  MapStock,
  MarketMap,
  MarketOverview,
  MarketSession,
  MoversData,
  NewsData,
  OiMove,
  OptionsData,
  OptionSnapshot,
  OptionStrikeRow,
  PivotLevels,
  Universe,
} from '@/shared/market/types';
import { cached } from './cache';
import { markSource, sourceStates } from './fetcher';
import { rememberFlow } from './history';
import { getLists, type Lists } from './lists';
import {
  fetch52w,
  fetchActions,
  fetchAllIndices,
  fetchAnnouncements,
  fetchDeals,
  fetchEvents,
  fetchFlows,
  fetchFutures,
  fetchHeatmap,
  fetchMarketStatus,
  fetchMostActive,
  fetchOiSpurts,
  fetchParticipants,
  fetchPreOpen,
  fetchVolumeShockers,
  parseMarketStatus,
} from './nse';
import { FEEDS, fetchCompanyNews, fetchFeed, makeTagger, mergeNews, type Tagger } from './news';
import { GLOBAL, YAHOO_OF_HEADLINE, fetchDaily, fetchSpark, fetchStockChart, globalQuotes, thin, type YahooSeries } from './yahoo';


export class MarketError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** An option / futures contract as the market view needs it (V2's instrument list provides these). */
export interface Contract {
  exchange: string;
  symbol: string;
  kind: string;
  expiry: string | null;
  strike: number | null;
}

interface KiteQuote {
  last_price?: number;
  volume?: number;
  average_price?: number;
  oi?: number;
  upper_circuit_limit?: number;
  lower_circuit_limit?: number;
  ohlc?: { open?: number; high?: number; low?: number; close?: number };
}

/** What the market view needs from the rest of the app (narrow, so tests can fake it). */
export interface MarketDeps {
  /** Runs `fn` with a logged-in Kite client (throws when there's no Kite session). */
  kite: <T>(fn: (kc: { getQuote(keys: string[]): Promise<Record<string, KiteQuote>> }) => Promise<T>) => Promise<T>;
  v2: {
    alerts(q: { from: string; to: string; limit: number }): Promise<Array<{ productId: string }>>;
    products(f: { kind: string; market: string; needs: Array<'FUT'>; limit: number }): Promise<Array<{ symbol: string; id: string }>>;
    instrumentsFor(productId: string): Promise<Contract[]>;
  } | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const istNow = () => new Date(Date.now() + 330 * MIN);
const istToday = () => istNow().toISOString().slice(0, 10);
const istMinutes = () => istNow().getUTCHours() * 60 + istNow().getUTCMinutes();
const round2 = (v: number) => Math.round(v * 100) / 100;
const pctOf = (last: number, prev: number | null | undefined) => (prev ? round2(((last - prev) / prev) * 100) : 0);

/** Pivot tables: our index, its Yahoo daily series, display name. */
const PIVOTS: Array<[string, string, string]> = [
  ['NIFTY 50', '^NSEI', 'Nifty 50'],
  ['NIFTY BANK', '^NSEBANK', 'Bank Nifty'],
  ['NIFTY FIN SERVICE', 'NIFTY_FIN_SERVICE.NS', 'Fin Nifty'],
  ['SENSEX', '^BSESN', 'Sensex'],
];

/** Index option chains computed from Kite. */
const CHAINS = [
  { underlying: 'NIFTY', name: 'Nifty 50', productId: 'NSE:NIFTY', spot: 'NSE:NIFTY 50' },
  { underlying: 'BANKNIFTY', name: 'Bank Nifty', productId: 'NSE:BANKNIFTY', spot: 'NSE:NIFTY BANK' },
];
const STRIKES_EACH_SIDE = 20;

export class MarketService {
  constructor(private readonly deps: MarketDeps) {}

  // ---- session ------------------------------------------------------------------------------------

  /** NSE's own market state (knows holidays); the clock only when NSE doesn't answer. */
  async status(): Promise<{ session: MarketSession; label: string; tradeDate: string | null }> {
    const r = await cached('status', MIN, 'nse-status', fetchMarketStatus);
    return r.value ?? parseMarketStatus(null);
  }

  private async live(): Promise<boolean> {
    return (await this.status()).session !== 'closed';
  }

  // ---- overview -----------------------------------------------------------------------------------

  async overview(): Promise<MarketOverview> {
    const status = await this.status();
    const live = status.session !== 'closed';
    const [indices, flows, highs, lows, participants, futures, spark] = await Promise.all([
      cached('indices', live ? 20_000 : 5 * MIN, 'nse-indices', fetchAllIndices),
      cached('flows', 15 * MIN, 'nse-flows', fetchFlows),
      cached('52w-high', live ? 2 * MIN : 30 * MIN, 'nse-52w', () => fetch52w('high')),
      cached('52w-low', live ? 2 * MIN : 30 * MIN, 'nse-52w', () => fetch52w('low')),
      cached('participants', 3 * HOUR, 'nse-participants', () => fetchParticipants(5)),
      cached('futures', live ? MIN : 15 * MIN, 'nse-futures', fetchFutures),
      cached('headline-spark', live ? 2 * MIN : 15 * MIN, 'yahoo', () => fetchSpark(Object.values(YAHOO_OF_HEADLINE), '5m')),
    ]);
    const list = indices.value ?? [];
    const series = spark.value ?? new Map<string, YahooSeries>();
    const headline: HeadlineIndex[] = HEADLINE.flatMap((symbol) => {
      const y = series.get(YAHOO_OF_HEADLINE[symbol]!);
      const q = list.find((i) => i.symbol === symbol) ?? (y ? fromYahoo(symbol, y) : undefined);
      return q ? [{ ...q, name: HEADLINE_NAMES[symbol] ?? q.name, spark: y?.points.length ? thin(y.points, 80) : null }] : [];
    });
    const history = rememberFlow(flows.value ?? null);
    return {
      at: new Date().toISOString(),
      status,
      headline,
      indices: list,
      highsLows: highs.value || lows.value ? { highs: highs.value?.count ?? 0, lows: lows.value?.count ?? 0 } : null,
      flows: { latest: flows.value ?? history[0] ?? null, history: history.slice(0, 30) },
      participants: participants.value ?? [],
      pivots: await this.pivots(status, list, headline),
      futures: futures.value ?? [],
      sources: sourceStates(['nse-status', 'nse-indices', 'yahoo', 'nse-flows', 'nse-52w', 'nse-participants', 'nse-futures']),
    };
  }

  /**
   * Pivots from the last completed session's high, low and close. While the market is closed NSE's own numbers
   * are that session (the levels for the next one); while it's open, yesterday's daily bar.
   */
  private async pivots(status: { session: MarketSession; tradeDate: string | null }, indices: IndexQuote[], headline: HeadlineIndex[]): Promise<PivotLevels[]> {
    const today = istToday();
    const closed = status.session === 'closed';
    const out: PivotLevels[] = [];
    for (const [symbol, ySymbol, name] of PIVOTS) {
      const q = indices.find((i) => i.symbol === symbol) ?? headline.find((i) => i.symbol === symbol);
      let basis: { date: string; high: number; low: number; close: number } | null = null;
      if (closed && q && q.high !== null && q.low !== null && q.high > 0) basis = { date: status.tradeDate ?? today, high: q.high, low: q.low, close: q.last };
      else {
        const daily = await cached(`daily:${ySymbol}`, closed ? 30 * MIN : 3 * HOUR, 'yahoo', () => fetchDaily(ySymbol));
        const bars = (daily.value?.bars ?? []).filter((b) => (closed ? b.date <= today : b.date < today));
        basis = bars.at(-1) ?? null;
        // Closed: the quote's session can be newer than the last finished daily bar.
        const s = daily.value?.session;
        if (closed && s && s.date <= today && (!basis || s.date > basis.date)) basis = s;
      }
      if (basis) out.push(pivotLevels(symbol, name, basis, q?.last ?? null));
    }
    return out;
  }

  // ---- stocks -------------------------------------------------------------------------------------

  async map(universe: Universe): Promise<MarketMap> {
    const live = await this.live();
    const lists = await getLists();
    if (!lists) throw new MarketError(503, 'NSE’s index lists couldn’t be loaded — check the internet connection.');
    const base = await this.stocks(lists, live);
    const alerts = await this.alertCounts();
    return {
      at: new Date(base.at || Date.now()).toISOString(),
      source: base.source,
      note: base.note,
      stocks: base.stocks.filter((s) => inUniverse(s, universe)).map((s) => ({ ...s, alerts: alerts.get(s.symbol) ?? 0 })),
    };
  }

  /** Every stock we have a price for: Kite (all Nifty 500, live) or NSE's sector-index stocks. */
  private async stocks(lists: Lists, live: boolean): Promise<{ source: 'kite' | 'nse'; note: string | null; stocks: MapStock[]; at: number }> {
    const fno = await this.fnoSymbols();
    const kite = await cached('stocks-kite', live ? 15_000 : 10 * MIN, 'kite-quotes', () => this.kiteStocks(lists, fno), { retryMs: 2 * MIN });
    if (kite.value?.length && (!kite.error || Date.now() - kite.at < 5 * MIN)) return { source: 'kite', note: null, stocks: kite.value, at: kite.at };
    const nse = await cached('stocks-nse', live ? 2 * MIN : 30 * MIN, 'nse-heatmap', () => this.nseStocks(lists, fno));
    const n = nse.value?.length ?? 0;
    return {
      source: 'nse',
      note: `Kite isn’t connected, so this shows the ${n} stocks of NSE’s sector indices, refreshed every 2 minutes while the market is open. Connect Kite for all Nifty 500 stocks, live.`,
      stocks: nse.value ?? [],
      at: nse.at,
    };
  }

  private async kiteStocks(lists: Lists, fno: Set<string>): Promise<MapStock[]> {
    const keys = lists.all.map((s) => `NSE:${s.symbol}`);
    const quotes: Record<string, KiteQuote> = {};
    for (let i = 0; i < keys.length; i += 500) Object.assign(quotes, await this.deps.kite((kc) => kc.getQuote(keys.slice(i, i + 500))));
    const out: MapStock[] = [];
    for (const s of lists.all) {
      const q = quotes[`NSE:${s.symbol}`];
      const ltp = q?.last_price;
      if (!q || !ltp) continue;
      const prev = q.ohlc?.close || null;
      const up = q.upper_circuit_limit ?? 0;
      const down = q.lower_circuit_limit ?? 0;
      out.push({
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        ltp,
        pct: pctOf(ltp, prev),
        change: prev ? round2(ltp - prev) : 0,
        open: q.ohlc?.open || null,
        high: q.ohlc?.high || null,
        low: q.ohlc?.low || null,
        prevClose: prev,
        value: (q.volume ?? 0) * (q.average_price ?? ltp),
        volume: q.volume ?? 0,
        groups: s.groups,
        fno: fno.has(s.symbol),
        circuit: up > 0 && ltp >= up ? 'upper' : down > 0 && ltp <= down ? 'lower' : null,
        alerts: 0,
      });
    }
    if (!out.length) throw new Error('Kite returned no quotes');
    return out;
  }

  private async nseStocks(lists: Lists, fno: Set<string>): Promise<MapStock[]> {
    const by = new Map<string, MapStock>();
    let failures = 0;
    for (const index of ['NIFTY 50', ...Object.keys(SECTOR_INDICES)]) {
      try {
        const rows = await fetchHeatmap(index, index === 'NIFTY 50' ? 'Broad Market Indices' : 'Sectoral Indices');
        for (const r of rows) {
          const s = lists.bySymbol.get(r.symbol);
          if (!s || by.has(r.symbol)) continue;
          const prev = r.ltp - r.change || null;
          by.set(r.symbol, { symbol: r.symbol, name: s.name, sector: s.sector, ltp: r.ltp, pct: r.pct, change: r.change, open: null, high: r.high, low: r.low, prevClose: prev, value: r.value, volume: r.volume, groups: s.groups, fno: fno.has(r.symbol), circuit: null, alerts: 0 });
        }
      } catch {
        failures++;
      }
    }
    if (!by.size) throw new Error(`NSE sent no stock prices (${failures} requests failed)`);
    return [...by.values()];
  }

  /** Stocks with futures & options (from the V2 product list, or NSE's OI data). */
  private async fnoSymbols(): Promise<Set<string>> {
    const r = await cached('fno', 6 * HOUR, 'nse-oi', async () => {
      try {
        const products = (await this.deps.v2?.products({ kind: 'STOCK', market: 'NSE', needs: ['FUT'], limit: 2000 })) ?? [];
        if (products.length > 50) return products.map((p) => p.symbol);
      } catch {
        /* no database: use NSE's list */
      }
      return (await fetchOiSpurts()).map((r) => r.symbol);
    });
    return new Set(r.value ?? []);
  }

  /** Your strategy alerts today per stock symbol (from V2, in memory). */
  private async alertCounts(): Promise<Map<string, number>> {
    const r = await cached('alerts-today', MIN, 'alerts', async () => {
      const today = istToday();
      const list = (await this.deps.v2?.alerts({ from: today, to: today, limit: 1000 })) ?? [];
      const m = new Map<string, number>();
      for (const a of list) if (a.productId?.startsWith('NSE:')) m.set(a.productId.slice(4), (m.get(a.productId.slice(4)) ?? 0) + 1);
      return [...m.entries()];
    });
    return new Map(r.value ?? []);
  }

  // ---- movers ---------------------------------------------------------------------------------------

  async movers(): Promise<MoversData> {
    const status = await this.status();
    const live = status.session !== 'closed';
    const ttl = live ? 2 * MIN : 30 * MIN;
    const [highs, lows, volume, active, oi, deals] = await Promise.all([
      cached('52w-high', ttl, 'nse-52w', () => fetch52w('high')),
      cached('52w-low', ttl, 'nse-52w', () => fetch52w('low')),
      cached('volume', ttl, 'nse-movers', fetchVolumeShockers),
      cached('active', ttl, 'nse-movers', fetchMostActive),
      cached('oi', ttl, 'nse-oi', fetchOiSpurts),
      cached('deals', live ? 10 * MIN : HOUR, 'nse-deals', fetchDeals),
    ]);
    const m = istMinutes();
    const preWindow = status.session === 'pre-open' || (status.session !== 'closed' && m >= 540 && m < 560);
    const pre = preWindow ? await cached('preopen', 30_000, 'nse-preopen', fetchPreOpen) : null;

    // OI change with today's price move → who is adding / closing positions.
    const lists = await getLists();
    const prices = lists ? new Map((await this.stocks(lists, live)).stocks.map((s) => [s.symbol, s])) : new Map<string, MapStock>();
    const oiMoves: OiMove[] = (oi.value ?? []).flatMap((r) => {
      const s = prices.get(r.symbol);
      if (!s) return [];
      return [{ symbol: r.symbol, name: s.name, pct: s.pct, oiPct: r.oiPct, oi: r.oi, ltp: s.ltp, kind: oiBuildup(s.pct, r.oiPct) }];
    });
    const nameOf = (sym: string, fallback: string) => lists?.bySymbol.get(sym)?.name ?? fallback;
    return {
      at: new Date().toISOString(),
      highs52: (highs.value?.list ?? []).slice(0, 60),
      lows52: (lows.value?.list ?? []).slice(0, 60),
      volumeShockers: (volume.value ?? []).slice(0, 40),
      mostActive: (active.value ?? []).map((a) => ({ ...a, name: nameOf(a.symbol, a.name) })).slice(0, 40),
      oi: oiMoves.sort((a, b) => Math.abs(b.oiPct) - Math.abs(a.oiPct)),
      deals: (deals.value ?? []).slice(0, 80),
      preOpen: pre?.value ? [...pre.value].sort((a, b) => b.pct - a.pct) : null,
      sources: sourceStates(['nse-52w', 'nse-movers', 'nse-oi', 'nse-deals', ...(preWindow ? ['nse-preopen'] : [])]),
    };
  }

  // ---- options (Kite) ---------------------------------------------------------------------------------

  async options(): Promise<OptionsData> {
    const live = await this.live();
    const r = await cached('options', live ? MIN : 10 * MIN, 'kite-options', () => this.optionChains(), { retryMs: 2 * MIN });
    if (r.value?.length) return { at: new Date(r.at).toISOString(), available: true, reason: null, chains: r.value };
    const notLoggedIn = !r.error || /not connected|log in|session|access token|token/i.test(r.error);
    return {
      at: new Date().toISOString(),
      available: false,
      reason: notLoggedIn ? 'Connect Kite (top bar) to see the Nifty and Bank Nifty option chains — PCR, max pain, OI walls and the expected move.' : `The option chain couldn’t be loaded: ${r.error}`,
      chains: [],
    };
  }

  private async optionChains(): Promise<OptionSnapshot[]> {
    if (!this.deps.v2) throw new Error('V2 isn’t available');
    const today = istToday();
    const spots = await this.deps.kite((kc) => kc.getQuote(CHAINS.map((c) => c.spot)));
    const plans: Array<{ c: (typeof CHAINS)[number]; spot: number; expiry: string; rows: Map<number, { ce?: Contract; pe?: Contract }> }> = [];
    for (const c of CHAINS) {
      const spot = spots[c.spot]?.last_price;
      const insts = (await cached(`instruments:${c.productId}`, 6 * HOUR, 'kite-options', () => this.deps.v2!.instrumentsFor(c.productId))).value ?? [];
      const options = insts.filter((i) => (i.kind === 'CE' || i.kind === 'PE') && i.expiry && i.expiry >= today && i.strike !== null);
      if (!spot || !options.length) continue;
      const expiry = options.reduce((e, i) => (i.expiry! < e ? i.expiry! : e), options[0]!.expiry!);
      const strikes = [...new Set(options.filter((i) => i.expiry === expiry).map((i) => i.strike!))].sort((a, b) => a - b);
      const atAtm = strikes.reduce((best, s, i) => (Math.abs(s - spot) < Math.abs(strikes[best]! - spot) ? i : best), 0);
      const chosen = new Set(strikes.slice(Math.max(0, atAtm - STRIKES_EACH_SIDE), atAtm + STRIKES_EACH_SIDE + 1));
      const rows = new Map<number, { ce?: Contract; pe?: Contract }>();
      for (const i of options) if (i.expiry === expiry && chosen.has(i.strike!)) rows.set(i.strike!, { ...rows.get(i.strike!), [i.kind === 'CE' ? 'ce' : 'pe']: i });
      plans.push({ c, spot, expiry, rows });
    }
    if (!plans.length) throw new Error('No option contracts — sync products in V2 → Products');
    const keys = plans.flatMap((p) => [...p.rows.values()].flatMap((r) => [r.ce, r.pe].filter((i): i is Contract => !!i).map((i) => `${i.exchange}:${i.symbol}`)));
    const quotes: Record<string, KiteQuote> = {};
    for (let i = 0; i < keys.length; i += 500) Object.assign(quotes, await this.deps.kite((kc) => kc.getQuote(keys.slice(i, i + 500))));
    return plans.map(({ c, spot, expiry, rows }) => {
      const q = (i?: Contract) => (i ? quotes[`${i.exchange}:${i.symbol}`] : undefined);
      const strikes: OptionStrikeRow[] = [...rows.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([strike, r]) => ({ strike, callOi: q(r.ce)?.oi ?? 0, putOi: q(r.pe)?.oi ?? 0, callLtp: q(r.ce)?.last_price ?? null, putLtp: q(r.pe)?.last_price ?? null }));
      const days = Math.max(0, Math.round((Date.parse(`${expiry}T15:30:00+05:30`) - Date.now()) / 86_400_000));
      return { underlying: c.underlying, name: c.name, expiry, daysToExpiry: days, spot, ...optionStats(strikes, spot), strikes };
    });
  }

  // ---- world ------------------------------------------------------------------------------------------

  async global(): Promise<GlobalData> {
    const r = await cached('global', 3 * MIN, 'yahoo', () => fetchSpark(GLOBAL.map((g) => g.symbol)));
    return { at: new Date(r.at || Date.now()).toISOString(), quotes: r.value ? globalQuotes(r.value) : [], sources: sourceStates(['yahoo']) };
  }

  // ---- news -------------------------------------------------------------------------------------------

  private async tagger(): Promise<Tagger | null> {
    const lists = await getLists();
    if (!lists) return null;
    const r = await cached('tagger', 12 * HOUR, 'nse-lists', async () => makeTagger(lists.all));
    return r.value ?? null;
  }

  async news(): Promise<NewsData> {
    const tagger = await this.tagger();
    const results = await Promise.all(FEEDS.map((f) => cached(`feed:${f.url}`, 5 * MIN, 'news', () => fetchFeed(f, tagger))));
    const ok = results.filter((r) => r.value).length;
    if (ok && ok < results.length) markSource('news', true);
    return { at: new Date().toISOString(), items: mergeNews(results.map((r) => r.value ?? [])), sources: sourceStates(['news']) };
  }

  // ---- calendar ---------------------------------------------------------------------------------------

  async calendar(): Promise<CalendarData> {
    const live = await this.live();
    const [events, actions, ann] = await Promise.all([
      cached('events', HOUR, 'nse-calendar', fetchEvents),
      cached('actions', HOUR, 'nse-actions', () => fetchActions()),
      cached('announcements', live ? 5 * MIN : 30 * MIN, 'nse-announcements', () => fetchAnnouncements()),
    ]);
    const today = istToday();
    const inDays = (d: number) => new Date(Date.parse(`${today}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    return {
      at: new Date().toISOString(),
      events: (events.value ?? []).filter((e) => e.date >= today && e.date <= inDays(21)),
      actions: (actions.value ?? []).filter((a) => a.exDate >= inDays(-1) && a.exDate <= inDays(30)),
      announcements: (ann.value ?? []).slice(0, 200),
      sources: sourceStates(['nse-calendar', 'nse-actions', 'nse-announcements']),
    };
  }

  // ---- one company --------------------------------------------------------------------------------------

  async company(symbol: string): Promise<CompanyData> {
    if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new MarketError(400, 'Unknown symbol');
    const lists = await getLists();
    const info = lists?.bySymbol.get(symbol);
    const name = info?.name ?? symbol;
    const live = await this.live();
    const base = lists ? await this.stocks(lists, live) : null;
    const tagger = await this.tagger();
    const [chart, news, ann, cal, fno] = await Promise.all([
      cached(`chart:${symbol}`, live ? 3 * MIN : 30 * MIN, 'yahoo', () => fetchStockChart(symbol)),
      cached(`gnews:${symbol}`, 15 * MIN, 'google-news', () => fetchCompanyNews(name, symbol, tagger)),
      cached(`ann:${symbol}`, 30 * MIN, 'nse-announcements', () => fetchAnnouncements(symbol, 30)),
      this.calendar(),
      this.fnoSymbols(),
    ]);
    const quote = base?.stocks.find((s) => s.symbol === symbol) ?? null;
    const alerts = await this.alertCounts();
    const y = chart.value ?? null;
    return {
      symbol,
      name,
      sector: info?.sector ?? '',
      groups: info?.groups ?? [],
      fno: fno.has(symbol),
      productId: info ? `NSE:${symbol}` : null,
      quote: quote ? { ...quote, alerts: alerts.get(symbol) ?? 0 } : null,
      range52: y && y.yearLow !== null && y.yearHigh !== null ? { low: y.yearLow, high: y.yearHigh } : null,
      spark: y ? thin(y.points, 90) : [],
      sparkPrev: y?.prevClose ?? null,
      news: news.value ?? [],
      announcements: (ann.value ?? []).slice(0, 25),
      events: cal.events.filter((e) => e.symbol === symbol),
      actions: cal.actions.filter((a) => a.symbol === symbol),
      sources: sourceStates(['yahoo', 'google-news', 'nse-announcements']),
    };
  }
}

/** A headline index quote from Yahoo (Sensex; or when NSE is unreachable). */
function fromYahoo(symbol: string, y: YahooSeries): IndexQuote {
  const change = y.prevClose !== null ? round2(y.last - y.prevClose) : 0;
  return {
    symbol,
    name: HEADLINE_NAMES[symbol] ?? symbol,
    group: 'broad',
    last: y.last,
    change,
    pct: pctOf(y.last, y.prevClose),
    open: null,
    high: y.dayHigh,
    low: y.dayLow,
    prevClose: y.prevClose,
    yearHigh: y.yearHigh,
    yearLow: y.yearLow,
    advances: null,
    declines: null,
    unchanged: null,
    pe: null,
    pb: null,
    dy: null,
    pct1w: null,
    pct1m: null,
    pct1y: null,
  };
}
