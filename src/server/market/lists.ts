/**
 * Who is in which index, and each company's sector — NSE's published constituent files (archives.nseindia.com,
 * refreshed twice a year by NSE). The Nifty 500 file carries the sector; the others give membership.
 */
import type { StockGroup } from '@/shared/market/types';
import { cached } from './cache';
import { nseArchive } from './fetcher';
import { splitCsvLine } from './nse';

export interface ListedStock {
  symbol: string;
  name: string;
  sector: string;
  groups: StockGroup[];
}

export interface Lists {
  bySymbol: Map<string, ListedStock>;
  /** Nifty 500 in file order. */
  all: ListedStock[];
}

const FILES: Array<{ group: StockGroup | null; file: string }> = [
  { group: null, file: 'ind_nifty500list.csv' },
  { group: 'N50', file: 'ind_nifty50list.csv' },
  { group: 'NN50', file: 'ind_niftynext50list.csv' },
  { group: 'MID150', file: 'ind_niftymidcap150list.csv' },
  { group: 'SML250', file: 'ind_niftysmallcap250list.csv' },
];

/** "Company Name,Industry,Symbol,Series,ISIN Code" rows. */
export function parseConstituents(csv: string): Array<{ symbol: string; name: string; sector: string }> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0] ?? '').map((h) => h.trim().toLowerCase());
  const at = (n: string) => header.indexOf(n);
  const [iName, iSector, iSymbol] = [at('company name'), at('industry'), at('symbol')];
  if (iSymbol < 0) return [];
  return lines.slice(1).map((l) => {
    const c = splitCsvLine(l);
    return { symbol: (c[iSymbol] ?? '').trim(), name: (c[iName] ?? '').trim(), sector: (c[iSector] ?? '').trim() };
  }).filter((r) => r.symbol);
}

export function buildLists(files: Array<{ group: StockGroup | null; rows: Array<{ symbol: string; name: string; sector: string }> }>): Lists {
  const bySymbol = new Map<string, ListedStock>();
  const all: ListedStock[] = [];
  for (const f of files) {
    for (const r of f.rows) {
      let s = bySymbol.get(r.symbol);
      if (!s) {
        s = { symbol: r.symbol, name: r.name, sector: r.sector || 'Other', groups: [] };
        bySymbol.set(r.symbol, s);
        all.push(s);
      }
      if (f.group && !s.groups.includes(f.group)) s.groups.push(f.group);
      if (s.sector === 'Other' && r.sector) s.sector = r.sector;
    }
  }
  return { bySymbol, all };
}

export async function getLists(): Promise<Lists | undefined> {
  const r = await cached('lists', 12 * 60 * 60_000, 'nse-lists', async () => {
    const files = [];
    for (const f of FILES) files.push({ group: f.group, rows: parseConstituents(await nseArchive(`content/indices/${f.file}`)) });
    if (!files[0]!.rows.length) throw new Error('the Nifty 500 list came back empty');
    return buildLists(files);
  });
  return r.value;
}

/** Company name without legal suffixes: "Tata Consultancy Services Ltd." → "Tata Consultancy Services". */
export function plainName(name: string): string {
  return name
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\b(Ltd|Limited|Ltd\.)\.?$/i, '')
    .replace(/\s+(Ltd|Limited)\.?\s*$/i, '')
    .replace(/[.,]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
