import { afterEach, describe, expect, it, vi } from 'vitest';
import { cached, clearMarketCache } from '@/server/market/cache';
import { buildLists, parseConstituents, plainName } from '@/server/market/lists';
import { decodeEntities, makeTagger, mergeNews, parseRss } from '@/server/market/news';
import {
  nseDate,
  nseDateTime,
  parse52w,
  parseAllIndices,
  parseDeals,
  parseFlows,
  parseFutures,
  parseHeatmap,
  parseMarketStatus,
  parseOiSpurts,
  parseParticipants,
  parseVolumeShockers,
  splitCsvLine,
} from '@/server/market/nse';
import { parseSpark, thin } from '@/server/market/yahoo';

describe('NSE parsing', () => {
  it('reads dates', () => {
    expect(nseDate('15-Oct-2026')).toBe('2026-10-15');
    expect(nseDate('7-Jan-2027 10:00')).toBe('2027-01-07');
    expect(nseDate('-')).toBeNull();
    expect(nseDateTime('16-Oct-2026 00:17:30')).toBe('2026-10-16T00:17:30+05:30');
  });

  it('reads allIndices (strings to numbers, 1-week change, groups)', () => {
    const [q] = parseAllIndices({
      data: [{ indexSymbol: 'NIFTY IT', last: 110, variation: 3, percentChange: 2.8, open: 107, high: 111, low: 106, previousClose: 107, yearHigh: 120, yearLow: 90, pe: '28.1', pb: '7.2', dy: '2.1', advances: '8', declines: '2', unchanged: '0', perChange30d: -1.5, perChange365d: 10, oneWeekAgoVal: 100 }],
    });
    expect(q).toMatchObject({ symbol: 'NIFTY IT', name: 'IT', group: 'sector', pct: 2.8, pe: 28.1, advances: 8, declines: 2, pct1w: 10, pct1m: -1.5, pct1y: 10 });
  });

  it('reads the market status, falling back to the clock', () => {
    expect(parseMarketStatus({ marketState: [{ market: 'Capital Market', marketStatus: 'Open', marketStatusMessage: 'Normal Market is Open', tradeDate: '16-Oct-2026' }] }).session).toBe('open');
    expect(parseMarketStatus({ marketState: [{ market: 'Capital Market', marketStatus: 'Closed', marketStatusMessage: 'Normal Market has Closed' }] }, Date.parse('2026-10-16T12:00:00Z')).session).toBe('closed');
    // Friday 10:00 IST, no answer from NSE → open by the clock.
    expect(parseMarketStatus(null, Date.parse('2026-10-16T04:30:00Z')).session).toBe('open');
    expect(parseMarketStatus(null, Date.parse('2026-10-16T03:35:00Z')).session).toBe('pre-open');
    expect(parseMarketStatus(null, Date.parse('2026-10-17T04:30:00Z')).session).toBe('closed'); // Saturday
  });

  it('reads FII / DII flows', () => {
    expect(
      parseFlows([
        { buyValue: '19438.65', category: 'DII', date: '15-Oct-2026', netValue: '3319.39', sellValue: '16119.26' },
        { buyValue: '12735.59', category: 'FII/FPI', date: '15-Oct-2026', netValue: '-5285.37', sellValue: '18020.96' },
      ]),
    ).toEqual({ date: '2026-10-15', fii: { buy: 12735.59, sell: 18020.96, net: -5285.37 }, dii: { buy: 19438.65, sell: 16119.26, net: 3319.39 } });
  });

  it('reads the participant-wise OI file', () => {
    const csv = [
      '""Participant wise Open Interest (no. of contracts) in Equity Derivatives as on Oct 15, 2026"",,,',
      'Client Type,Future Index Long,Future Index Short,Future Stock Long,Future Stock Short       ,Option Index Call Long,Option Index Put Long,Option Index Call Short,Option Index Put Short,Option Stock Call Long',
      'Client,274365,55053,3430726,251656,2922859,3565881,2864946,4037922,1',
      'DII,50751,14310,326278,4702832,21005,81661,1900,0,1',
      'FII,38549,318376,3607402,2820841,684021,1256369,891902,809342,1',
      'Pro,51015,26941,852822,441899,1051839,1261431,920976,1318078,1',
      'TOTAL,414680,414680,8217228,8217228,4679724,6165342,4679724,6165342,1',
    ].join('\n');
    const d = parseParticipants(csv, '2026-10-15')!;
    expect(d.rows.FII).toEqual({ futIdxLong: 38549, futIdxShort: 318376, futStkLong: 3607402, futStkShort: 2820841, callLong: 684021, putLong: 1256369, callShort: 891902, putShort: 809342 });
    expect(parseParticipants('not a csv', 'x')).toBeNull();
  });

  it('reads index futures (nearest expiry per index, basis)', () => {
    const f = parseFutures({
      volume: {
        data: [
          { underlying: 'NIFTY', instrumentType: 'FUTIDX', expiryDate: '24-Nov-2026', lastPrice: 23150, underlyingValue: 23000, pChange: 1 },
          { underlying: 'NIFTY', instrumentType: 'FUTIDX', expiryDate: '27-Oct-2026', lastPrice: 23050, underlyingValue: 23000, pChange: 1.2, openInterest: 100 },
          { underlying: 'RELIANCE', instrumentType: 'FUTSTK', expiryDate: '27-Oct-2026', lastPrice: 1, underlyingValue: 1 },
        ],
      },
    });
    expect(f).toEqual([{ symbol: 'NIFTY', expiry: '2026-10-27', last: 23050, spot: 23000, basis: 50, basisPct: 0.22, pct: 1.2, oi: 100 }]);
  });

  it('reads stock lists (heatmap, 52-week, volume, OI, deals)', () => {
    expect(parseHeatmap([{ symbol: 'TECHM', lastPrice: '1650', change: '74.8', pChange: '4.75', high: '1650', low: '1596.1', quantityTraded: '14110777633.68', totalTradedVolume: '8657928' }])[0]).toMatchObject({ symbol: 'TECHM', ltp: 1650, pct: 4.75, value: 14110777633.68 });
    expect(parse52w({ high: 69, data: [{ symbol: 'ABDL', comapnyName: 'Allied Blenders', ltp: 739.6, pChange: -0.5 }] }, 'high')).toEqual({ count: 69, list: [{ symbol: 'ABDL', name: 'Allied Blenders', ltp: 739.6, pct: -0.5 }] });
    expect(parseVolumeShockers({ data: [{ symbol: 'SHOPERSTOP', companyName: 'Shoppers Stop', volume: 17547673, week1AvgVolume: 2948525, ltp: 374, pChange: 0.2, turnover: 72178.84 }] })[0]).toMatchObject({ times: 6, value: 7217884000 });
    expect(parseOiSpurts({ data: [{ symbol: 'NESTLEIND', latestOI: 73842, prevOI: 41865, underlyingValue: 1275 }] })[0]).toMatchObject({ symbol: 'NESTLEIND', oiPct: 76.38 });
    const deals = parseDeals({ BULK_DEALS_DATA: [{ buySell: 'SELL', clientName: 'X', date: '15-Oct-2026', name: 'Jai Corp', qty: '100', symbol: 'JAICORPLTD', watp: '95.83' }], BLOCK_DEALS_DATA: [{ buySell: 'BUY', clientName: 'Y', date: '15-Oct-2026', name: 'Eternal', qty: '1000', symbol: 'ETERNAL', watp: '300' }] });
    expect(deals.map((d) => [d.kind, d.symbol, d.side, d.value])).toEqual([
      ['block', 'ETERNAL', 'BUY', 300000],
      ['bulk', 'JAICORPLTD', 'SELL', 9583],
    ]);
  });

  it('splits CSV lines with quotes', () => {
    expect(splitCsvLine('a,"b, c","say ""hi""",d')).toEqual(['a', 'b, c', 'say "hi"', 'd']);
  });
});

describe('index lists', () => {
  it('builds membership and sectors from the constituent files', () => {
    const n500 = parseConstituents('Company Name,Industry,Symbol,Series,ISIN Code\nInfosys Ltd.,Information Technology,INFY,EQ,X\nPolycab India Ltd.,Capital Goods,POLYCAB,EQ,Y');
    const n50 = parseConstituents('Company Name,Industry,Symbol,Series,ISIN Code\nInfosys Ltd.,Information Technology,INFY,EQ,X');
    const lists = buildLists([
      { group: null, rows: n500 },
      { group: 'N50', rows: n50 },
    ]);
    expect(lists.bySymbol.get('INFY')).toEqual({ symbol: 'INFY', name: 'Infosys Ltd.', sector: 'Information Technology', groups: ['N50'] });
    expect(lists.bySymbol.get('POLYCAB')!.groups).toEqual([]);
    expect(plainName('Tata Consultancy Services Ltd.')).toBe('Tata Consultancy Services');
    expect(plainName('Larsen & Toubro Limited')).toBe('Larsen & Toubro');
  });
});

describe('news', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Infosys shares jump 4% after strong Q2 &amp; buyback]]></title><link>https://x.com/a</link><pubDate>Thu, 15 Oct 2026 10:00:00 +0530</pubDate><description><![CDATA[<p>IT stocks rallied as <b>Infosys</b> beat estimates.</p>]]></description></item>
    <item><title>L&amp;T bags orders worth ₹5,000 crore</title><link>https://x.com/b</link><pubDate>Thu, 15 Oct 2026 11:00:00 +0530</pubDate></item>
    <item><title>Idea of a calm market</title><link>https://x.com/c</link></item>
  </channel></rss>`;

  it('parses RSS items (CDATA, entities, HTML in descriptions)', () => {
    const items = parseRss(xml);
    expect(items[0]).toMatchObject({ title: 'Infosys shares jump 4% after strong Q2 & buyback', link: 'https://x.com/a', summary: 'IT stocks rallied as Infosys beat estimates.', at: '2026-10-15T04:30:00.000Z' });
    expect(items[1]!.title).toBe('L&T bags orders worth ₹5,000 crore');
    expect(decodeEntities('&#8217;&#x20B9;&rsquo;')).toBe('’₹’');
  });

  it('tags companies by name, alias or capitalised symbol — not ordinary words', () => {
    const tagger = makeTagger([
      { symbol: 'INFY', name: 'Infosys Ltd.', sector: 'Information Technology', groups: [] },
      { symbol: 'LT', name: 'Larsen & Toubro Ltd.', sector: 'Construction', groups: [] },
      { symbol: 'IDEA', name: 'Vodafone Idea Ltd.', sector: 'Telecommunication', groups: [] },
      { symbol: 'NTPC', name: 'NTPC Ltd.', sector: 'Power', groups: [] },
    ]);
    expect(tagger.tag('Infosys shares jump; IT stocks rally')).toEqual({ symbols: ['INFY'], sectors: ['Information Technology'] });
    expect(tagger.tag('L&T bags orders worth ₹5,000 crore').symbols).toEqual(['LT']);
    expect(tagger.tag('Idea of a calm market').symbols).toEqual([]);
    expect(tagger.tag('NTPC to add 2 GW of solar').symbols).toEqual(['NTPC']);
  });

  it('merges feeds newest first, without repeats', () => {
    const a = { id: '1', title: 'Same story!', link: 'https://a', source: 'A', at: '2026-10-15T10:00:00Z', category: 'markets' as const, summary: '', symbols: [], sectors: [] };
    const merged = mergeNews([[a, { ...a, id: '2', link: 'https://b', at: '2026-10-15T11:00:00Z', title: 'Newer' }], [{ ...a, id: '3', link: 'https://c', title: 'same story' }]]);
    expect(merged.map((i) => i.title)).toEqual(['Newer', 'Same story!']);
  });
});

describe('Yahoo', () => {
  it('reads both spark shapes', () => {
    const flat = parseSpark({ '^NSEI': { symbol: '^NSEI', close: [1, null, 3], chartPreviousClose: 2, fulldayPrice: 3 } });
    expect(flat.get('^NSEI')).toMatchObject({ last: 3, prevClose: 2, points: [1, 3], dayHigh: null });
    const nested = parseSpark({ spark: { result: [{ symbol: '^DJI', response: [{ meta: { regularMarketPrice: 5, chartPreviousClose: 4 }, indicators: { quote: [{ close: [4, 5] }] } }] }] } });
    expect(nested.get('^DJI')).toMatchObject({ last: 5, prevClose: 4, points: [4, 5] });
  });

  it('thins long series, keeping both ends', () => {
    const t = thin(Array.from({ length: 100 }, (_, i) => i), 10);
    expect(t).toHaveLength(10);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBe(99);
  });
});

describe('cache', () => {
  afterEach(() => {
    clearMarketCache();
    vi.useRealTimers();
  });

  it('reuses a fresh value, serves the stale one while refreshing, keeps it when the source fails', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    let calls = 0;
    let fail = false;
    const load = async () => {
      calls++;
      if (fail) throw new Error('down');
      return calls;
    };
    expect((await cached('k', 1000, 'test', load)).value).toBe(1);
    expect((await cached('k', 1000, 'test', load)).value).toBe(1);
    expect(calls).toBe(1);
    vi.setSystemTime(1_002_000); // stale: answered at once, refreshed behind
    expect((await cached('k', 1000, 'test', load)).value).toBe(1);
    await vi.runAllTimersAsync();
    expect((await cached('k', 1000, 'test', load)).value).toBe(2);
    fail = true;
    vi.setSystemTime(1_004_000);
    await cached('k', 1000, 'test', load);
    await vi.runAllTimersAsync();
    const r = await cached('k', 1000, 'test', load);
    expect(r.value).toBe(2);
    expect(r.error).toBe('down');
  });

  it('never throws; a first failure has no value', async () => {
    const r = await cached('x', 1000, 'test', async () => {
      throw new Error('nope');
    });
    expect(r).toMatchObject({ value: undefined, error: 'nope' });
  });
});
