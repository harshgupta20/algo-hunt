/**
 * "The market in 30 seconds" — a few plain sentences written from the numbers on the page (no opinions, no AI):
 * the index and how broad its move is, mid / small caps, leading and lagging sectors, volatility, money flows,
 * positioning, options, and the world.
 */
import type { GlobalQuote, IndexQuote, MarketOverview, OptionSnapshot } from './types';

export interface StoryLine {
  /** Which part of the market the line is about (an icon on the page). */
  topic: 'index' | 'breadth' | 'caps' | 'sectors' | 'volatility' | 'flows' | 'positioning' | 'options' | 'world' | 'extremes';
  text: string;
  /** Direction of what the line describes (an ▲ / ▼ / • marker), not an opinion. */
  tone: 'up' | 'down' | 'neutral';
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-IN');
const n2 = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const tone = (v: number | null | undefined): StoryLine['tone'] => (!v ? 'neutral' : v > 0 ? 'up' : 'down');
const crore = (v: number) => `₹${n0(Math.abs(v))} Cr`;
const day = (d: string) => {
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : d;
};

/** VIX bands commonly used for India VIX (rough guide, not a rule). */
export function vixBand(v: number): string {
  if (v < 12) return 'very low — a calm market';
  if (v < 16) return 'low — a calm market';
  if (v < 20) return 'moderate';
  if (v < 25) return 'elevated — bigger swings likely';
  return 'high — a fearful market';
}

export interface StoryInput {
  overview: MarketOverview | null;
  global?: GlobalQuote[] | null;
  options?: OptionSnapshot[] | null;
}

export function marketStory({ overview, global, options }: StoryInput): StoryLine[] {
  if (!overview) return [];
  const lines: StoryLine[] = [];
  const idx = (s: string): IndexQuote | undefined => overview.indices.find((i) => i.symbol === s) ?? overview.headline.find((i) => i.symbol === s);
  const nifty = idx('NIFTY 50');
  const n500 = idx('NIFTY 500');

  if (nifty) {
    const range = nifty.high !== null && nifty.low !== null ? ` (day range ${n2(nifty.low)} – ${n2(nifty.high)})` : '';
    lines.push({ topic: 'index', tone: tone(nifty.pct), text: `Nifty 50 ${nifty.pct >= 0 ? 'is up' : 'is down'} ${pct(nifty.pct)} at ${n2(nifty.last)}${range}.` });
  }

  if (n500?.advances !== null && n500?.advances !== undefined && n500.declines !== null) {
    const a = n500.advances;
    const d = n500.declines;
    const ratio = d ? a / d : a ? Infinity : 1;
    let text: string;
    if (nifty && nifty.pct > 0.2 && ratio < 0.8) text = `Narrow move: the Nifty is up but most stocks fell — ${a} up, ${d} down in the Nifty 500. Large caps are carrying the index.`;
    else if (nifty && nifty.pct < -0.2 && ratio > 1.25) text = `The Nifty is down but most stocks rose — ${a} up, ${d} down in the Nifty 500. Selling is concentrated in a few heavyweights.`;
    else if (ratio >= 2) text = `Broad buying: ${a} of ${a + d + (n500.unchanged ?? 0)} Nifty 500 stocks are up, ${d} down.`;
    else if (ratio <= 0.5) text = `Broad selling: ${d} of ${a + d + (n500.unchanged ?? 0)} Nifty 500 stocks are down, ${a} up.`;
    else text = `Mixed breadth: ${a} Nifty 500 stocks up, ${d} down.`;
    lines.push({ topic: 'breadth', tone: tone(a - d), text });
  }

  const mid = idx('NIFTY MIDCAP 100');
  const sml = idx('NIFTY SMLCAP 100');
  if (nifty && mid && sml) {
    const gap = (mid.pct + sml.pct) / 2 - nifty.pct;
    const verdict = Math.abs(gap) < 0.25 ? 'in line with the Nifty' : gap > 0 ? 'beating the Nifty' : 'lagging the Nifty';
    lines.push({ topic: 'caps', tone: tone((mid.pct + sml.pct) / 2), text: `Midcaps ${pct(mid.pct)}, smallcaps ${pct(sml.pct)} — ${verdict}.` });
  }

  const sectors = overview.indices.filter((i) => i.group === 'sector').sort((a, b) => b.pct - a.pct);
  if (sectors.length >= 4) {
    const up = sectors.filter((s) => s.pct > 0).length;
    const top = sectors.slice(0, 2).map((s) => `${s.name} (${pct(s.pct)})`);
    const bottom = sectors.slice(-2).reverse().map((s) => `${s.name} (${pct(s.pct)})`);
    const head = up === sectors.length ? 'Every sector is up; ' : up === 0 ? 'Every sector is down; ' : `${up} of ${sectors.length} sectors up; `;
    lines.push({ topic: 'sectors', tone: tone(up - (sectors.length - up)), text: `${head}${top.join(' and ')} lead, ${bottom.join(' and ')} lag.` });
  }

  const vix = idx('INDIA VIX');
  if (vix) lines.push({ topic: 'volatility', tone: 'neutral', text: `India VIX ${n2(vix.last)} (${pct(vix.pct)}) — ${vixBand(vix.last)}.` });

  const flow = overview.flows.latest;
  if (flow) {
    const verb = (v: number) => (v >= 0 ? 'bought' : 'sold');
    lines.push({
      topic: 'flows',
      tone: tone(flow.fii.net + flow.dii.net),
      text: `Cash market on ${day(flow.date)}: FIIs net ${verb(flow.fii.net)} ${crore(flow.fii.net)}, DIIs net ${verb(flow.dii.net)} ${crore(flow.dii.net)}.`,
    });
  }

  const [p0, p1] = overview.participants;
  if (p0) {
    const longPct = (p: typeof p0) => {
      const f = p.rows.FII;
      const t = f.futIdxLong + f.futIdxShort;
      return t ? (f.futIdxLong / t) * 100 : null;
    };
    const now = longPct(p0);
    const before = p1 ? longPct(p1) : null;
    if (now !== null) {
      const trend = before !== null ? ` (${now >= before ? 'up' : 'down'} from ${before.toFixed(0)}% on ${day(p1!.date)})` : '';
      lines.push({ topic: 'positioning', tone: now >= 50 ? 'up' : 'down', text: `FIIs hold ${now.toFixed(0)}% of their index-futures positions long, ${(100 - now).toFixed(0)}% short${trend}.` });
    }
  }

  if (overview.highsLows) {
    const { highs, lows } = overview.highsLows;
    lines.push({ topic: 'extremes', tone: tone(highs - lows), text: `${highs} stocks hit a 52-week high today, ${lows} a 52-week low.` });
  }

  const nOpt = options?.find((o) => o.underlying === 'NIFTY');
  if (nOpt?.straddle) {
    const walls = [nOpt.putWall && `support (most put OI) ${n0(nOpt.putWall.strike)}`, nOpt.callWall && `resistance (most call OI) ${n0(nOpt.callWall.strike)}`].filter(Boolean).join(', ');
    lines.push({
      topic: 'options',
      tone: 'neutral',
      text: `Options price a ±${nOpt.straddle.movePct.toFixed(1)}% Nifty move by expiry (${day(nOpt.expiry)})${nOpt.pcr !== null ? `; PCR ${nOpt.pcr.toFixed(2)}` : ''}${walls ? `; ${walls}` : ''}.`,
    });
  }

  if (global?.length) {
    const g = (s: string) => global.find((q) => q.symbol === s);
    const part = (list: string[]) =>
      list
        .map(g)
        .filter((q): q is GlobalQuote => !!q && q.pct !== null)
        .map((q) => `${q.name} ${pct(q.pct!)}`);
    const us = part(['^DJI', '^GSPC', '^IXIC']);
    const asia = part(['^N225', '^HSI', '000001.SS']);
    const brent = g('BZ=F');
    const inr = g('INR=X');
    const bits = [us.length ? `US ${us.join(', ')}` : '', asia.length ? `Asia ${asia.join(', ')}` : '', brent ? `Brent $${n2(brent.last)}` : '', inr ? `USD/INR ${n2(inr.last)}` : ''].filter(Boolean);
    if (bits.length) {
      const usMove = ['^DJI', '^GSPC', '^IXIC'].map(g).filter((q) => q?.pct != null).reduce((a, q) => a + q!.pct!, 0);
      lines.push({ topic: 'world', tone: tone(usMove), text: `World: ${bits.join('; ')}.` });
    }
  }
  return lines;
}
