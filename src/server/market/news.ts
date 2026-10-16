/**
 * Headlines from free RSS feeds (Economic Times, Mint, Business Standard, Inc42, YourStory, Google News),
 * tagged with the Nifty 500 companies and sectors they mention.
 */
import type { NewsCategory, NewsItem } from '@/shared/market/types';
import { createHash } from 'node:crypto';
import { getText } from './fetcher';
import { plainName, type ListedStock } from './lists';

export const FEEDS: Array<{ source: string; category: NewsCategory; url: string }> = [
  { source: 'ET Markets', category: 'markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { source: 'Mint', category: 'markets', url: 'https://www.livemint.com/rss/markets' },
  { source: 'Business Standard', category: 'markets', url: 'https://www.business-standard.com/rss/markets-106.rss' },
  { source: 'ET Economy', category: 'economy', url: 'https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms' },
  { source: 'Mint', category: 'economy', url: 'https://www.livemint.com/rss/economy' },
  { source: 'Business Standard', category: 'economy', url: 'https://www.business-standard.com/rss/economy-102.rss' },
  { source: 'ET Companies', category: 'companies', url: 'https://economictimes.indiatimes.com/news/company/rssfeeds/2143429.cms' },
  { source: 'Mint', category: 'companies', url: 'https://www.livemint.com/rss/companies' },
  { source: 'Business Standard', category: 'companies', url: 'https://www.business-standard.com/rss/companies-101.rss' },
  { source: 'ET Tech', category: 'tech', url: 'https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms' },
  { source: 'Mint', category: 'tech', url: 'https://www.livemint.com/rss/technology' },
  { source: 'Inc42', category: 'startups', url: 'https://inc42.com/feed/' },
  { source: 'YourStory', category: 'startups', url: 'https://yourstory.com/feed' },
];

// ---- RSS --------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', rupee: '₹' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const tag = (xml: string, name: string): string => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  return m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
};

export const stripHtml = (s: string) =>
  decodeEntities(
    s
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();

export interface RssItem {
  title: string;
  link: string;
  at: string | null;
  summary: string;
  source: string | null;
}

export function parseRss(xml: string): RssItem[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return items
    .map((it) => {
      const title = stripHtml(tag(it, 'title'));
      const link = decodeEntities(tag(it, 'link') || tag(it, 'guid')).trim();
      const date = tag(it, 'pubDate') || tag(it, 'dc:date');
      const t = Date.parse(date);
      const summary = stripHtml(tag(it, 'description'));
      return { title, link, at: Number.isFinite(t) ? new Date(t).toISOString() : null, summary: summary.length > 240 ? `${summary.slice(0, 237)}…` : summary, source: stripHtml(tag(it, 'source')) || null };
    })
    .filter((i) => i.title && /^https?:\/\//.test(i.link));
}

// ---- tagging ------------------------------------------------------------------------------------------

/** Names headlines use for the big companies (beyond the listed name). */
const ALIASES: Record<string, string[]> = {
  RELIANCE: ['Reliance Industries', 'RIL'],
  TCS: ['Tata Consultancy'],
  INFY: ['Infosys'],
  HDFCBANK: ['HDFC Bank'],
  ICICIBANK: ['ICICI Bank'],
  SBIN: ['SBI', 'State Bank of India'],
  BHARTIARTL: ['Airtel'],
  LT: ['L&T', 'Larsen & Toubro', 'Larsen and Toubro'],
  'M&M': ['M&M', 'Mahindra & Mahindra', 'Mahindra and Mahindra'],
  KOTAKBANK: ['Kotak Mahindra Bank', 'Kotak Bank'],
  HINDUNILVR: ['HUL', 'Hindustan Unilever'],
  MARUTI: ['Maruti'],
  SUNPHARMA: ['Sun Pharma'],
  HCLTECH: ['HCLTech', 'HCL Tech'],
  TECHM: ['Tech Mahindra'],
  ULTRACEMCO: ['UltraTech'],
  POWERGRID: ['Power Grid'],
  DRREDDY: ["Dr Reddy's", 'Dr Reddys', "Dr. Reddy's"],
  EICHERMOT: ['Eicher', 'Royal Enfield'],
  ETERNAL: ['Zomato', 'Blinkit'],
  INDIGO: ['IndiGo', 'InterGlobe'],
  HAL: ['Hindustan Aeronautics'],
  BEL: ['Bharat Electronics'],
  JIOFIN: ['Jio Financial'],
  PAYTM: ['Paytm'],
  NYKAA: ['Nykaa'],
  POLICYBZR: ['Policybazaar', 'PB Fintech'],
  DMART: ['DMart', 'Avenue Supermarts'],
  VEDL: ['Vedanta'],
  IDEA: ['Vodafone Idea'],
  PNB: ['Punjab National Bank'],
  BANKBARODA: ['Bank of Baroda'],
  LICI: ['LIC'],
  IOC: ['Indian Oil'],
  DIVISLAB: ["Divi's"],
  CHOLAFIN: ['Cholamandalam'],
  INDUSINDBK: ['IndusInd'],
  IDFCFIRSTB: ['IDFC First'],
  MAZDOCK: ['Mazagon Dock'],
  OFSS: ['Oracle Financial'],
  LTIM: ['LTIMindtree'],
  KPITTECH: ['KPIT'],
  UNITDSPR: ['United Spirits'],
  VBL: ['Varun Beverages'],
  JUBLFOOD: ['Jubilant FoodWorks'],
  NAUKRI: ['Info Edge', 'Naukri'],
};

/** Listed names that are also everyday words or group names — matched only through their full name / aliases. */
const AMBIGUOUS = new Set(['eternal', 'sun', 'union', 'central', 'indian', 'federal', 'hero', 'prestige', 'phoenix', 'supreme', 'trident', 'godrej', 'tata', 'bajaj', 'adani', 'reliance', 'mahindra', 'birla', 'jindal', 'gland', 'angel', 'aster', 'action', 'global', 'bharat', 'india', 'national', 'sterling', 'premier', 'apollo', 'bse', 'mcx', 'oil']);
/** Acronyms in headlines that aren't the stock with that symbol. */
const NOT_SYMBOLS = new Set(['IT', 'IPO', 'GST', 'RBI', 'SEBI', 'FII', 'DII', 'GDP', 'CPI', 'PSU', 'FMCG', 'ETF', 'SIP', 'NSE', 'BSE', 'USA', 'CEO', 'CFO', 'MF', 'AI', 'EV', 'US', 'UK', 'EU', 'OIL', 'MCX']);

const SECTOR_WORDS: Array<[string, RegExp]> = [
  ['Information Technology', /\b(IT (stocks|sector|companies|firms|services)|tech stocks|software services|IT major)\b/i],
  ['Financial Services', /\b(banks?|banking|NBFCs?|lenders?|insurers?|insurance|mutual funds?|AMCs?|fintech|microfinance)\b/i],
  ['Automobile and Auto Components', /\b(auto (stocks|sales|sector|makers?)|automakers?|carmakers?|two-wheelers?|car sales|vehicle sales|EVs?)\b/i],
  ['Healthcare', /\b(pharma|drugmakers?|hospitals?|healthcare|USFDA|generic drugs?)\b/i],
  ['Fast Moving Consumer Goods', /\b(FMCG|consumer goods|packaged foods?)\b/i],
  ['Metals & Mining', /\b(metals?|steel|aluminium|copper|zinc|mining|iron ore)\b/i],
  ['Oil Gas & Consumable Fuels', /\b(crude|oil marketing|OMCs?|natural gas|refiners?|refinery|petrol|diesel|coal)\b/i],
  ['Realty', /\b(realty|real estate|housing sales|property market)\b/i],
  ['Power', /\b(power (sector|demand|stocks)|electricity|renewables?|solar|wind energy|green energy)\b/i],
  ['Telecommunication', /\b(telecom|5G|tariff hikes?)\b/i],
  ['Capital Goods', /\b(capital goods|defen[cs]e|order book|bags? orders?|orders? worth|engineering)\b/i],
  ['Chemicals', /\b(chemicals?|agrochemicals?|specialty chem)/i],
  ['Construction Materials', /\b(cement)\b/i],
  ['Consumer Services', /\b(quick commerce|e-commerce|food delivery|hotels?|airlines?|aviation|retail chain)\b/i],
  ['Media Entertainment & Publication', /\b(media stocks|OTT|broadcasters?)\b/i],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Tagger {
  tag(text: string): { symbols: string[]; sectors: string[] };
}

export function makeTagger(stocks: ListedStock[]): Tagger {
  const patterns: Array<{ symbol: string; re: RegExp }> = [];
  for (const s of stocks) {
    const names = new Set<string>();
    const plain = plainName(s.name);
    const first = plain.split(' ')[0] ?? '';
    if (plain.split(' ').length > 1 || !AMBIGUOUS.has(plain.toLowerCase())) names.add(plain);
    for (const a of ALIASES[s.symbol] ?? []) names.add(a);
    // Single-word names ("Infosys", "Cipla") also match as the first word of a longer listed name.
    if (plain.split(' ').length === 2 && first.length >= 5 && !AMBIGUOUS.has(first.toLowerCase()) && /^(Ltd|India|Industries|Limited)$/i.test(plain.split(' ')[1] ?? '')) names.add(first);
    const alts = [...names].filter((n) => n.length >= 3).map((n) => escapeRe(n));
    if (alts.length) patterns.push({ symbol: s.symbol, re: new RegExp(`(^|[^\\w&])(${alts.join('|')})(?=$|[^\\w&])`, 'i') });
    // The bare symbol only in capitals ("TCS", "NTPC") — case-sensitive, so ordinary words don't match.
    if (/^[A-Z]{3,}$/.test(s.symbol) && !NOT_SYMBOLS.has(s.symbol)) patterns.push({ symbol: s.symbol, re: new RegExp(`(^|[^\\w&])${s.symbol}(?=$|[^\\w&])`) });
  }
  const sectorOf = new Map(stocks.map((s) => [s.symbol, s.sector]));
  return {
    tag(text: string) {
      const symbols = [...new Set(patterns.filter((p) => p.re.test(text)).map((p) => p.symbol))].slice(0, 6);
      const sectors = new Set(symbols.map((s) => sectorOf.get(s)).filter((s): s is string => !!s));
      for (const [sector, re] of SECTOR_WORDS) if (re.test(text)) sectors.add(sector);
      return { symbols, sectors: [...sectors] };
    },
  };
}

// ---- fetching -----------------------------------------------------------------------------------------

const idOf = (link: string) => createHash('sha1').update(link).digest('hex').slice(0, 12);
const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

export async function fetchFeed(feed: (typeof FEEDS)[number], tagger: Tagger | null): Promise<NewsItem[]> {
  const items = parseRss(await getText(feed.url, { timeoutMs: 12_000 }));
  return items.map((i) => ({ id: idOf(i.link), title: i.title, link: i.link, source: feed.source, at: i.at, category: feed.category, summary: i.summary, ...(tagger?.tag(`${i.title}. ${i.summary}`) ?? { symbols: [], sectors: [] }) }));
}

/** Newest first, the same story from two feeds once. */
export function mergeNews(lists: NewsItem[][], limit = 240): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const i of lists.flat().sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))) {
    const k = titleKey(i.title);
    if (seen.has(k) || seen.has(i.link)) continue;
    seen.add(k);
    seen.add(i.link);
    out.push(i);
  }
  return out.slice(0, limit);
}

/** One company's last week of news (Google News search). */
export async function fetchCompanyNews(name: string, symbol: string, tagger: Tagger | null): Promise<NewsItem[]> {
  const q = `"${plainName(name)}" when:7d`;
  const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`, { timeoutMs: 12_000 });
  return parseRss(xml)
    .slice(0, 25)
    .map((i) => {
      // Google appends " - Publisher" to titles.
      const m = i.title.match(/^(.*) - ([^-]{2,60})$/);
      const title = m ? m[1]!.trim() : i.title;
      const tags = tagger?.tag(title) ?? { symbols: [], sectors: [] };
      return { id: idOf(i.link), title, link: i.link, source: i.source ?? m?.[2]?.trim() ?? 'Google News', at: i.at, category: 'companies' as const, summary: '', symbols: tags.symbols.includes(symbol) ? tags.symbols : [symbol, ...tags.symbols], sectors: tags.sectors };
    });
}
