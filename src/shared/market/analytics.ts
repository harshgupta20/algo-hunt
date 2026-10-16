/**
 * The calculations behind the market view — pure, so the server, the page and the tests share them.
 */
import type { MapStock, OiBuildup, OptionSnapshot, OptionStrikeRow, PivotLevels, StockGroup, Universe } from './types';

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ---- pivots / CPR ------------------------------------------------------------------------------------

/** Classic floor pivots + central pivot range from one session's high / low / close. */
export function pivotLevels(symbol: string, name: string, basis: { date: string; high: number; low: number; close: number }, last: number | null): PivotLevels {
  const { high: H, low: L, close: C } = basis;
  const pivot = (H + L + C) / 3;
  const bcRaw = (H + L) / 2;
  const tcRaw = 2 * pivot - bcRaw;
  const bc = Math.min(bcRaw, tcRaw);
  const tc = Math.max(bcRaw, tcRaw);
  const range = H - L;
  const levels = {
    pivot,
    bc,
    tc,
    r1: 2 * pivot - L,
    s1: 2 * pivot - H,
    r2: pivot + range,
    s2: pivot - range,
    r3: H + 2 * (pivot - L),
    s3: L - 2 * (H - pivot),
  };
  const r = Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, round(v)])) as typeof levels;
  return {
    symbol,
    name,
    basis,
    ...r,
    cprWidthPct: pivot ? round(((tc - bc) / pivot) * 100, 3) : 0,
    last,
    position: last === null ? null : last > tc ? 'above' : last < bc ? 'below' : 'inside',
  };
}

// ---- options -----------------------------------------------------------------------------------------

/** PCR, max pain, OI walls and the ATM straddle from an option chain (strikes sorted ascending). */
export function optionStats(rows: OptionStrikeRow[], spot: number): Pick<OptionSnapshot, 'atm' | 'pcr' | 'maxPain' | 'callWall' | 'putWall' | 'straddle'> {
  if (!rows.length) return { atm: spot, pcr: null, maxPain: null, callWall: null, putWall: null, straddle: null };
  const atmRow = rows.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best), rows[0]!);
  const callOi = rows.reduce((s, r) => s + r.callOi, 0);
  const putOi = rows.reduce((s, r) => s + r.putOi, 0);
  // Max pain: the expiry level at which the options' total intrinsic value (what writers pay) is smallest.
  let maxPain: number | null = null;
  let least = Infinity;
  for (const at of rows) {
    let pay = 0;
    for (const r of rows) pay += r.callOi * Math.max(0, at.strike - r.strike) + r.putOi * Math.max(0, r.strike - at.strike);
    if (pay < least) {
      least = pay;
      maxPain = at.strike;
    }
  }
  const wall = (key: 'callOi' | 'putOi') => {
    const top = rows.reduce((best, r) => (r[key] > best[key] ? r : best), rows[0]!);
    return top[key] > 0 ? { strike: top.strike, oi: top[key] } : null;
  };
  const straddle =
    atmRow.callLtp !== null && atmRow.putLtp !== null
      ? { strike: atmRow.strike, call: atmRow.callLtp, put: atmRow.putLtp, total: round(atmRow.callLtp + atmRow.putLtp), movePct: round(((atmRow.callLtp + atmRow.putLtp) / spot) * 100) }
      : null;
  return { atm: atmRow.strike, pcr: callOi > 0 ? round(putOi / callOi) : null, maxPain, callWall: wall('callOi'), putWall: wall('putOi'), straddle };
}

/** Price and open interest together: who is adding / closing positions. */
export function oiBuildup(pricePct: number, oiPct: number): OiBuildup {
  if (oiPct >= 0) return pricePct >= 0 ? 'long' : 'short';
  return pricePct >= 0 ? 'covering' : 'unwinding';
}

// ---- stocks ------------------------------------------------------------------------------------------

export function inUniverse(s: Pick<MapStock, 'groups' | 'fno'>, u: Universe): boolean {
  const has = (g: StockGroup) => s.groups.includes(g);
  switch (u) {
    case 'nifty50':
      return has('N50');
    case 'nifty100':
      return has('N50') || has('NN50');
    case 'midcap150':
      return has('MID150');
    case 'smallcap250':
      return has('SML250');
    case 'fno':
      return s.fno;
    default:
      return true;
  }
}

export interface SectorStat {
  sector: string;
  count: number;
  advances: number;
  declines: number;
  /** Equal-weighted average move of its stocks, %. */
  avgPct: number;
  /** Traded value, ₹. */
  value: number;
  best: MapStock | null;
  worst: MapStock | null;
}

export function sectorStats(stocks: MapStock[]): SectorStat[] {
  const by = new Map<string, MapStock[]>();
  for (const s of stocks) by.set(s.sector, [...(by.get(s.sector) ?? []), s]);
  return [...by.entries()]
    .map(([sector, list]) => ({
      sector,
      count: list.length,
      advances: list.filter((s) => s.pct > 0).length,
      declines: list.filter((s) => s.pct < 0).length,
      avgPct: round(list.reduce((a, s) => a + s.pct, 0) / list.length),
      value: list.reduce((a, s) => a + s.value, 0),
      best: list.reduce<MapStock | null>((b, s) => (!b || s.pct > b.pct ? s : b), null),
      worst: list.reduce<MapStock | null>((b, s) => (!b || s.pct < b.pct ? s : b), null),
    }))
    .sort((a, b) => b.value - a.value);
}

const gapPct = (s: MapStock) => (s.open !== null && s.prevClose ? ((s.open - s.prevClose) / s.prevClose) * 100 : null);
/** Equal within a tick-ish tolerance (0.05%). */
const same = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.0005);

export interface DerivedMovers {
  gainers: MapStock[];
  losers: MapStock[];
  active: MapStock[];
  gapUp: Array<MapStock & { gap: number }>;
  gapDown: Array<MapStock & { gap: number }>;
  /** Opened at the day's low and are higher now — buyers in control since the open. */
  openLow: MapStock[];
  /** Opened at the day's high and are lower now — sellers in control since the open. */
  openHigh: MapStock[];
  upperCircuit: MapStock[];
  lowerCircuit: MapStock[];
}

export function deriveMovers(stocks: MapStock[], n = 15): DerivedMovers {
  const traded = stocks.filter((s) => s.ltp > 0);
  const byPct = [...traded].sort((a, b) => b.pct - a.pct);
  const gaps = traded.map((s) => ({ ...s, gap: gapPct(s) })).filter((s): s is MapStock & { gap: number } => s.gap !== null);
  return {
    gainers: byPct.filter((s) => s.pct > 0).slice(0, n),
    losers: [...byPct].reverse().filter((s) => s.pct < 0).slice(0, n),
    active: [...traded].sort((a, b) => b.value - a.value).slice(0, n),
    gapUp: gaps.filter((s) => s.gap >= 1).sort((a, b) => b.gap - a.gap).slice(0, n),
    gapDown: gaps.filter((s) => s.gap <= -1).sort((a, b) => a.gap - b.gap).slice(0, n),
    openLow: traded.filter((s) => same(s.open, s.low) && s.ltp > (s.open ?? Infinity)).sort((a, b) => b.pct - a.pct).slice(0, n),
    openHigh: traded.filter((s) => same(s.open, s.high) && s.ltp < (s.open ?? -Infinity)).sort((a, b) => a.pct - b.pct).slice(0, n),
    upperCircuit: traded.filter((s) => s.circuit === 'upper'),
    lowerCircuit: traded.filter((s) => s.circuit === 'lower'),
  };
}

// ---- treemap -----------------------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): lays `values` out in `box`, keeping tiles close to square.
 * Returns one rectangle per value, in the input order. Values must be ≥ 0.
 */
export function squarify(values: number[], box: Rect): Rect[] {
  const out: Rect[] = new Array(values.length);
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  if (!total || box.w <= 0 || box.h <= 0) {
    for (let i = 0; i < values.length; i++) out[i] = { x: box.x, y: box.y, w: 0, h: 0 };
    return out;
  }
  const scale = (box.w * box.h) / total;
  const items = values.map((v, i) => ({ i, a: Math.max(0, v) * scale })).sort((a, b) => b.a - a.a);
  let rect = { ...box };
  let row: typeof items = [];
  const worst = (r: typeof items, side: number) => {
    const s = r.reduce((a, x) => a + x.a, 0);
    const max = Math.max(...r.map((x) => x.a));
    const min = Math.min(...r.map((x) => x.a));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const place = (r: typeof items) => {
    const s = r.reduce((a, x) => a + x.a, 0);
    if (rect.w >= rect.h) {
      const w = s / rect.h;
      let y = rect.y;
      for (const x of r) {
        const h = x.a / w;
        out[x.i] = { x: rect.x, y, w, h };
        y += h;
      }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      const h = s / rect.w;
      let x0 = rect.x;
      for (const x of r) {
        const w = x.a / h;
        out[x.i] = { x: x0, y: rect.y, w, h };
        x0 += w;
      }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }
  };
  for (const item of items) {
    if (item.a <= 0) {
      out[item.i] = { x: rect.x, y: rect.y, w: 0, h: 0 };
      continue;
    }
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, item], side) <= worst(row, side)) row.push(item);
    else {
      place(row);
      row = [item];
    }
  }
  if (row.length) place(row);
  return out;
}

// ---- colour steps ------------------------------------------------------------------------------------

/**
 * Diverging intensity for a % move: 0 = flat (neutral grey) … 5 = strongest. The page tints green (up) or red
 * (down) by this step; the signed % is always printed too, so colour is never the only cue.
 */
export function moveStep(pct: number): 0 | 1 | 2 | 3 | 4 | 5 {
  const a = Math.abs(pct);
  if (a < 0.25) return 0;
  if (a < 1) return 1;
  if (a < 2) return 2;
  if (a < 3) return 3;
  if (a < 5) return 4;
  return 5;
}
