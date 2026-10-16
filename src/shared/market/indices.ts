/**
 * Which NSE index is a sector, a theme, a style (factor) or a broad-market index — and the short name the page
 * shows. Symbols are NSE's (allIndices `indexSymbol`).
 */
import type { IndexGroup } from './types';

export const SECTOR_INDICES: Record<string, string> = {
  'NIFTY BANK': 'Bank',
  'NIFTY PVT BANK': 'Private Banks',
  'NIFTY PSU BANK': 'PSU Banks',
  'NIFTY FIN SERVICE': 'Financial Services',
  'NIFTY IT': 'IT',
  'NIFTY AUTO': 'Auto',
  'NIFTY PHARMA': 'Pharma',
  'NIFTY HEALTHCARE': 'Healthcare',
  'NIFTY FMCG': 'FMCG',
  'NIFTY METAL': 'Metal',
  'NIFTY REALTY': 'Realty',
  'NIFTY ENERGY': 'Energy',
  'NIFTY OIL AND GAS': 'Oil & Gas',
  'NIFTY MEDIA': 'Media',
  'NIFTY CONSR DURBL': 'Consumer Durables',
  'NIFTY CHEMICALS': 'Chemicals',
  'NIFTY CEMENT': 'Cement',
  'NIFTY CAPITAL MKT': 'Capital Markets',
};

export const THEME_INDICES: Record<string, string> = {
  'NIFTY IND DEFENCE': 'Defence',
  'NIFTY RAILWAYSPSU': 'Railway PSUs',
  'NIFTY EV': 'EV & New-age Auto',
  'NIFTY IND DIGITAL': 'Digital',
  'NIFTY INTERNET': 'Internet',
  'NIFTY IND TOURISM': 'Tourism',
  'NIFTY HOUSING': 'Housing',
  'NIFTY INFRA': 'Infrastructure',
  'NIFTY INDIA MFG': 'Manufacturing',
  'NIFTY CPSE': 'CPSE',
  'NIFTY PSE': 'PSE',
  'NIFTY COMMODITIES': 'Commodities',
  'NIFTY CONSUMPTION': 'Consumption',
  'NIFTY NEW CONSUMP': 'New-age Consumption',
  'NIFTY RURAL': 'Rural',
  'NIFTY MNC': 'MNC',
  'NIFTY MOBILITY': 'Mobility',
  'NIFTY TRANS LOGIS': 'Transport & Logistics',
  'NIFTY SERV SECTOR': 'Services',
  'NIFTY IPO': 'IPOs',
  'NIFTYCONGLOMERATE': 'Conglomerates',
  'NIFTY WAVES': 'Media & Entertainment (WAVES)',
};

/** Factor / style indices: which kind of stock is in favour. */
export const STYLE_INDICES: Record<string, string> = {
  'NIFTY200MOMENTM30': 'Momentum',
  'NIFTY100 QUALTY30': 'Quality',
  'NIFTY200 VALUE 30': 'Value',
  'NIFTY100 LOWVOL30': 'Low volatility',
  'NIFTY ALPHA 50': 'Alpha',
  'NIFTY HIGHBETA 50': 'High beta',
  'NIFTY50 EQL WGT': 'Nifty 50 equal weight',
  'NIFTY DIV OPPS 50': 'Dividend',
};

export const BROAD_INDICES: Record<string, string> = {
  'NIFTY 50': 'Nifty 50',
  'NIFTY NEXT 50': 'Nifty Next 50',
  'NIFTY 100': 'Nifty 100',
  'NIFTY 200': 'Nifty 200',
  'NIFTY 500': 'Nifty 500',
  'NIFTY MIDCAP 50': 'Midcap 50',
  'NIFTY MIDCAP 100': 'Midcap 100',
  'NIFTY MIDCAP 150': 'Midcap 150',
  'NIFTY SMLCAP 50': 'Smallcap 50',
  'NIFTY SMLCAP 100': 'Smallcap 100',
  'NIFTY SMLCAP 250': 'Smallcap 250',
  'NIFTY MICROCAP250': 'Microcap 250',
  'NIFTY TOTAL MKT': 'Total Market',
  'INDIA VIX': 'India VIX',
};

/** The tiles at the top, in order. SENSEX comes from BSE (Yahoo). */
export const HEADLINE = ['NIFTY 50', 'SENSEX', 'NIFTY BANK', 'NIFTY FIN SERVICE', 'NIFTY MIDCAP 100', 'NIFTY SMLCAP 100', 'INDIA VIX'] as const;

export const HEADLINE_NAMES: Record<string, string> = {
  'NIFTY 50': 'Nifty 50',
  SENSEX: 'Sensex',
  'NIFTY BANK': 'Bank Nifty',
  'NIFTY FIN SERVICE': 'Fin Nifty',
  'NIFTY MIDCAP 100': 'Midcap 100',
  'NIFTY SMLCAP 100': 'Smallcap 100',
  'INDIA VIX': 'India VIX',
};

/** Breadth rows (advances / declines come with each index). */
export const BREADTH_INDICES = ['NIFTY 50', 'NIFTY 500', 'NIFTY MIDCAP 150', 'NIFTY SMLCAP 250'] as const;

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bNifty\b/, 'Nifty');

export function indexMeta(symbol: string): { group: IndexGroup; name: string } {
  if (SECTOR_INDICES[symbol]) return { group: 'sector', name: SECTOR_INDICES[symbol]! };
  if (THEME_INDICES[symbol]) return { group: 'theme', name: THEME_INDICES[symbol]! };
  if (STYLE_INDICES[symbol]) return { group: 'style', name: STYLE_INDICES[symbol]! };
  if (BROAD_INDICES[symbol]) return { group: 'broad', name: BROAD_INDICES[symbol]! };
  return { group: 'other', name: titleCase(symbol) };
}

/** Sector index → the NSE macro sector its stocks carry in the Nifty 500 list (for "show these stocks"). */
export const SECTOR_OF_INDEX: Record<string, string[]> = {
  'NIFTY BANK': ['Financial Services'],
  'NIFTY PVT BANK': ['Financial Services'],
  'NIFTY PSU BANK': ['Financial Services'],
  'NIFTY FIN SERVICE': ['Financial Services'],
  'NIFTY CAPITAL MKT': ['Financial Services'],
  'NIFTY IT': ['Information Technology'],
  'NIFTY AUTO': ['Automobile and Auto Components'],
  'NIFTY PHARMA': ['Healthcare'],
  'NIFTY HEALTHCARE': ['Healthcare'],
  'NIFTY FMCG': ['Fast Moving Consumer Goods'],
  'NIFTY METAL': ['Metals & Mining'],
  'NIFTY REALTY': ['Realty'],
  'NIFTY ENERGY': ['Oil Gas & Consumable Fuels', 'Power'],
  'NIFTY OIL AND GAS': ['Oil Gas & Consumable Fuels'],
  'NIFTY MEDIA': ['Media Entertainment & Publication'],
  'NIFTY CONSR DURBL': ['Consumer Durables'],
  'NIFTY CHEMICALS': ['Chemicals'],
  'NIFTY CEMENT': ['Construction Materials'],
};

/** Short names for NSE's macro sectors (map labels). */
export const SECTOR_SHORT: Record<string, string> = {
  'Financial Services': 'Financials',
  'Information Technology': 'IT',
  'Automobile and Auto Components': 'Auto',
  'Fast Moving Consumer Goods': 'FMCG',
  'Oil Gas & Consumable Fuels': 'Oil & Gas',
  'Metals & Mining': 'Metals',
  'Media Entertainment & Publication': 'Media',
  'Construction Materials': 'Cement & Materials',
  'Consumer Durables': 'Durables',
  'Consumer Services': 'Consumer Services',
  'Capital Goods': 'Capital Goods',
  Telecommunication: 'Telecom',
};

export const sectorShort = (s: string) => SECTOR_SHORT[s] ?? s;
