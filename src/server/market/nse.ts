/**
 * NSE's public website data (www.nseindia.com/api, archives.nseindia.com) for the market view. These are the
 * endpoints NSE's own pages use — free, no login, but unofficial: NSE can change or block them, so every caller
 * treats a failure as "this panel has no data right now". The parse* functions are pure (tested with samples).
 */
import type { Announcement, CalendarEvent, CorporateAction, Deal, Flow, FuturesBasis, IndexQuote, MarketSession, ParticipantDay, ParticipantPositions, StockMove, VolumeShocker } from '@/shared/market/types';
import { indexMeta } from '@/shared/market/indices';
import { nseArchive, nseJson, SourceError } from './fetcher';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const num0 = (v: unknown) => num(v) ?? 0;
const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

/** "15-Oct-2026" → "2026-10-15" (null when it isn't a date). */
export function nseDate(s: unknown): string | null {
  const m = String(s ?? '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  return m ? `${m[3]}-${MONTHS[m[2]!.toUpperCase()] ?? '01'}-${m[1]!.padStart(2, '0')}` : null;
}

/** "16-Oct-2026 00:17:30" (IST) → ISO. */
export function nseDateTime(s: unknown): string | null {
  const d = nseDate(s);
  const t = String(s ?? '').match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  return d ? `${d}T${t ? `${t[1]}:${t[2]}:${t[3] ?? '00'}` : '00:00:00'}+05:30` : null;
}

// ---- indices --------------------------------------------------------------------------------------

interface RawIndex {
  index?: string;
  indexSymbol?: string;
  last?: number;
  variation?: number;
  percentChange?: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  yearHigh?: number;
  yearLow?: number;
  pe?: string;
  pb?: string;
  dy?: string;
  advances?: string;
  declines?: string;
  unchanged?: string;
  perChange30d?: number;
  perChange365d?: number;
  oneWeekAgoVal?: number;
}

export function parseAllIndices(raw: { data?: RawIndex[] }): IndexQuote[] {
  return (raw.data ?? [])
    .filter((r) => r.indexSymbol && Number.isFinite(r.last))
    .map((r) => {
      const symbol = r.indexSymbol!;
      const last = r.last!;
      const weekAgo = num(r.oneWeekAgoVal);
      return {
        symbol,
        ...indexMeta(symbol),
        last,
        change: num0(r.variation),
        pct: num0(r.percentChange),
        open: num(r.open),
        high: num(r.high),
        low: num(r.low),
        prevClose: num(r.previousClose),
        yearHigh: num(r.yearHigh),
        yearLow: num(r.yearLow),
        advances: num(r.advances),
        declines: num(r.declines),
        unchanged: num(r.unchanged),
        pe: num(r.pe),
        pb: num(r.pb),
        dy: num(r.dy),
        pct1w: weekAgo ? Math.round((last / weekAgo - 1) * 10_000) / 100 : null,
        pct1m: num(r.perChange30d),
        pct1y: num(r.perChange365d),
      };
    });
}

export const fetchAllIndices = async () => parseAllIndices(await nseJson<{ data?: RawIndex[] }>('allIndices'));

/** NSE's own state for the cash market; falls back to the clock (weekday 09:00–09:15 pre-open, –15:30 open). */
export function parseMarketStatus(raw: { marketState?: Array<{ market?: string; marketStatus?: string; marketStatusMessage?: string; tradeDate?: string }> } | null, now = Date.now()): { session: MarketSession; label: string; tradeDate: string | null } {
  const cm = raw?.marketState?.find((m) => m.market === 'Capital Market');
  const ist = new Date(now + 330 * 60_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const weekday = ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5;
  const clock: MarketSession = weekday && mins >= 540 && mins < 555 ? 'pre-open' : weekday && mins >= 555 && mins < 930 ? 'open' : 'closed';
  if (!cm) return { session: clock, label: clock === 'open' ? 'Market open' : clock === 'pre-open' ? 'Pre-open session' : 'Market closed', tradeDate: null };
  const msg = cm.marketStatusMessage ?? '';
  const session: MarketSession = /pre-?open/i.test(msg) || (clock === 'pre-open' && !/closed/i.test(cm.marketStatus ?? '')) ? 'pre-open' : /^open/i.test(cm.marketStatus ?? '') ? 'open' : 'closed';
  return { session, label: msg || cm.marketStatus || '', tradeDate: nseDate(cm.tradeDate) };
}

export const fetchMarketStatus = async () => parseMarketStatus(await nseJson('marketStatus'));

// ---- money --------------------------------------------------------------------------------------------

export function parseFlows(raw: Array<{ category?: string; date?: string; buyValue?: string; sellValue?: string; netValue?: string }>): Flow | null {
  const side = (re: RegExp) => {
    const r = raw.find((x) => re.test(x.category ?? ''));
    return r ? { buy: num0(r.buyValue), sell: num0(r.sellValue), net: num0(r.netValue), date: nseDate(r.date) } : null;
  };
  const fii = side(/FII|FPI/i);
  const dii = side(/^DII/i);
  if (!fii || !dii) return null;
  const { date: d1, ...f } = fii;
  const { date: d2, ...d } = dii;
  return { date: d1 ?? d2 ?? '', fii: f, dii: d };
}

export const fetchFlows = async () => parseFlows(await nseJson('fiidiiTradeReact'));

const PARTICIPANT_COLS: Record<keyof ParticipantPositions, string> = {
  futIdxLong: 'Future Index Long',
  futIdxShort: 'Future Index Short',
  futStkLong: 'Future Stock Long',
  futStkShort: 'Future Stock Short',
  callLong: 'Option Index Call Long',
  putLong: 'Option Index Put Long',
  callShort: 'Option Index Call Short',
  putShort: 'Option Index Put Short',
};

/** NSE's participant-wise open interest file (fao_participant_oi_DDMMYYYY.csv). */
export function parseParticipants(csv: string, date: string): ParticipantDay | null {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const headerAt = lines.findIndex((l) => /^"?Client Type/i.test(l));
  if (headerAt < 0) return null;
  const header = splitCsvLine(lines[headerAt]!).map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const rows: Partial<ParticipantDay['rows']> = {};
  for (const line of lines.slice(headerAt + 1)) {
    const cells = splitCsvLine(line);
    const who = cells[0]?.trim();
    if (who !== 'FII' && who !== 'DII' && who !== 'Pro' && who !== 'Client') continue;
    rows[who] = Object.fromEntries(Object.entries(PARTICIPANT_COLS).map(([k, name]) => [k, num0(cells[col(name)])])) as unknown as ParticipantPositions;
  }
  return rows.FII && rows.DII && rows.Pro && rows.Client ? { date, rows: rows as ParticipantDay['rows'] } : null;
}

/** The last `days` trading days' participant OI (weekends skipped; holidays simply aren't there). */
export async function fetchParticipants(days = 5, now = Date.now()): Promise<ParticipantDay[]> {
  const out: ParticipantDay[] = [];
  for (let back = 0; back < 12 && out.length < days; back++) {
    const d = new Date(now + 330 * 60_000 - back * 86_400_000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    const file = `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
    try {
      const day = parseParticipants(await nseArchive(`content/nsccl/fao_participant_oi_${file}.csv`), iso);
      if (day) out.push(day);
    } catch (err) {
      if (!(err instanceof SourceError && err.status === 404)) throw err; // not published (yet / holiday)
    }
  }
  return out;
}

export function parseFutures(raw: { volume?: { data?: Array<Record<string, unknown>> } }): FuturesBasis[] {
  const seen = new Set<string>();
  const out: FuturesBasis[] = [];
  const rows = (raw.volume?.data ?? []).filter((r) => r.instrumentType === 'FUTIDX');
  // Nearest expiry first per index.
  rows.sort((a, b) => String(nseDate(a.expiryDate)).localeCompare(String(nseDate(b.expiryDate))));
  for (const r of rows) {
    const symbol = String(r.underlying ?? '');
    const last = num(r.lastPrice);
    const spot = num(r.underlyingValue);
    if (!symbol || seen.has(symbol) || last === null || spot === null || !spot) continue;
    seen.add(symbol);
    out.push({ symbol, expiry: nseDate(r.expiryDate) ?? '', last, spot, basis: Math.round((last - spot) * 100) / 100, basisPct: Math.round(((last - spot) / spot) * 10_000) / 100, pct: num0(r.pChange), oi: num(r.openInterest) });
  }
  return out;
}

export const fetchFutures = async () => parseFutures(await nseJson('snapshot-derivatives-equity?index=futures'));

// ---- stocks ---------------------------------------------------------------------------------------------

export interface NseStockRow {
  symbol: string;
  ltp: number;
  pct: number;
  change: number;
  high: number | null;
  low: number | null;
  value: number;
  volume: number;
}

/** heatmap-symbols: the stocks of one index (value is ₹). */
export function parseHeatmap(raw: Array<Record<string, unknown>>): NseStockRow[] {
  return raw
    .map((r) => ({
      symbol: String(r.symbol ?? ''),
      ltp: num0(r.lastPrice),
      pct: num0(r.pChange),
      change: num0(r.change),
      high: num(r.high),
      low: num(r.low),
      value: num0(r.quantityTraded),
      volume: num0(r.totalTradedVolume),
    }))
    .filter((r) => r.symbol && r.ltp > 0);
}

export const fetchHeatmap = async (index: string, type = 'Sectoral Indices') => parseHeatmap(await nseJson(`heatmap-symbols?type=${encodeURIComponent(type)}&indices=${encodeURIComponent(index)}`));

export function parse52w(raw: { high?: number; low?: number; data?: Array<Record<string, unknown>> }, kind: 'high' | 'low'): { count: number; list: StockMove[] } {
  const list = (raw.data ?? [])
    .map((r) => ({ symbol: String(r.symbol ?? ''), name: String(r.comapnyName ?? r.companyName ?? r.symbol ?? ''), ltp: num0(r.ltp), pct: num0(r.pChange) }))
    .filter((r) => r.symbol);
  return { count: num(kind === 'high' ? raw.high : raw.low) ?? list.length, list };
}

export const fetch52w = async (kind: 'high' | 'low') => parse52w(await nseJson(`live-analysis-data-52week${kind}stock`), kind);

export function parseVolumeShockers(raw: { data?: Array<Record<string, unknown>> }): VolumeShocker[] {
  return (raw.data ?? [])
    .map((r) => {
      const volume = num0(r.volume);
      const avgVolume = num0(r.week1AvgVolume);
      return { symbol: String(r.symbol ?? ''), name: String(r.companyName ?? r.symbol ?? ''), ltp: num0(r.ltp), pct: num0(r.pChange), value: num0(r.turnover) * 1e5, volume, avgVolume, times: avgVolume ? Math.round((volume / avgVolume) * 10) / 10 : 0 };
    })
    .filter((r) => r.symbol)
    .sort((a, b) => b.times - a.times);
}

export const fetchVolumeShockers = async () => parseVolumeShockers(await nseJson('live-analysis-volume-gainers'));

export function parseMostActive(raw: { data?: Array<Record<string, unknown>> }): StockMove[] {
  return (raw.data ?? []).map((r) => ({ symbol: String(r.symbol ?? ''), name: String(r.symbol ?? ''), ltp: num0(r.lastPrice), pct: num0(r.pChange), value: num0(r.totalTradedValue) })).filter((r) => r.symbol);
}

export const fetchMostActive = async () => parseMostActive(await nseJson('live-analysis-most-active-securities?index=value'));

export interface NseOiRow {
  symbol: string;
  oi: number;
  prevOi: number;
  oiPct: number;
  price: number;
}

export function parseOiSpurts(raw: { data?: Array<Record<string, unknown>> }): NseOiRow[] {
  return (raw.data ?? [])
    .map((r) => {
      const oi = num0(r.latestOI);
      const prevOi = num0(r.prevOI);
      return { symbol: String(r.symbol ?? ''), oi, prevOi, oiPct: prevOi ? Math.round(((oi - prevOi) / prevOi) * 10_000) / 100 : 0, price: num0(r.underlyingValue) };
    })
    .filter((r) => r.symbol && r.prevOi > 0);
}

export const fetchOiSpurts = async () => parseOiSpurts(await nseJson('live-analysis-oi-spurts-underlyings'));

export function parseDeals(raw: Record<string, unknown>): Deal[] {
  const list = (key: string, kind: Deal['kind']) =>
    ((raw[key] as Array<Record<string, unknown>> | undefined) ?? []).map((r) => {
      const qty = num0(r.qty);
      const price = num0(r.watp);
      return { kind, date: nseDate(r.date) ?? '', symbol: String(r.symbol ?? ''), name: String(r.name ?? r.symbol ?? ''), client: String(r.clientName ?? ''), side: (String(r.buySell).toUpperCase() === 'SELL' ? 'SELL' : 'BUY') as Deal['side'], qty, price, value: qty * price };
    });
  return [...list('BLOCK_DEALS_DATA', 'block'), ...list('BULK_DEALS_DATA', 'bulk')].filter((d) => d.symbol).sort((a, b) => b.value - a.value);
}

export const fetchDeals = async () => parseDeals(await nseJson('snapshot-capital-market-largedeal'));

export function parsePreOpen(raw: { data?: Array<{ metadata?: Record<string, unknown> }> }): StockMove[] {
  return (raw.data ?? [])
    .map((r) => r.metadata ?? {})
    .map((m) => ({ symbol: String(m.symbol ?? ''), name: String(m.symbol ?? ''), ltp: num0(m.lastPrice ?? m.iep), pct: num0(m.pChange), value: num(m.finalQuantity) !== null && num(m.lastPrice) !== null ? num0(m.finalQuantity) * num0(m.lastPrice) : undefined }))
    .filter((r) => r.symbol && r.ltp > 0);
}

export const fetchPreOpen = async () => parsePreOpen(await nseJson('market-data-pre-open?key=FO'));

// ---- calendar -------------------------------------------------------------------------------------------

export function parseEvents(raw: Array<Record<string, unknown>>): CalendarEvent[] {
  return raw
    .map((r) => ({ symbol: String(r.symbol ?? ''), company: String(r.company ?? r.symbol ?? ''), purpose: String(r.purpose ?? ''), detail: String(r.bm_desc ?? ''), date: nseDate(r.date) ?? '' }))
    .filter((r) => r.symbol && r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const fetchEvents = async () => parseEvents(await nseJson('event-calendar'));

export function parseActions(raw: Array<Record<string, unknown>>): CorporateAction[] {
  return raw
    .map((r) => ({ symbol: String(r.symbol ?? ''), company: String(r.comp ?? r.symbol ?? ''), subject: String(r.subject ?? ''), exDate: nseDate(r.exDate) ?? '', recordDate: nseDate(r.recDate) }))
    .filter((r) => r.symbol && r.exDate)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
}

export const fetchActions = async (symbol?: string) => parseActions(await nseJson(`corporates-corporateActions?index=equities${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`));

export function parseAnnouncements(raw: Array<Record<string, unknown>>): Announcement[] {
  return raw
    .map((r) => ({
      symbol: String(r.symbol ?? ''),
      company: String(r.sm_name ?? r.symbol ?? ''),
      subject: String(r.desc ?? ''),
      text: String(r.attchmntText ?? '').replace(/\s+/g, ' ').trim(),
      at: nseDateTime(r.an_dt) ?? '',
      link: typeof r.attchmntFile === 'string' && r.attchmntFile.startsWith('https://') ? r.attchmntFile : null,
    }))
    .filter((r) => r.symbol && r.at)
    .sort((a, b) => b.at.localeCompare(a.at));
}

const ddmmyyyy = (ms: number) => {
  const d = new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
  return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
};

export async function fetchAnnouncements(symbol?: string, days = 2): Promise<Announcement[]> {
  const range = symbol ? `&symbol=${encodeURIComponent(symbol)}&from_date=${ddmmyyyy(Date.now() - days * 86_400_000)}&to_date=${ddmmyyyy(Date.now())}` : '';
  return parseAnnouncements(await nseJson(`corporate-announcements?index=equities${range}`));
}

// ---- csv ------------------------------------------------------------------------------------------------

/** One CSV line → cells (quoted cells may hold commas and "" escapes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
