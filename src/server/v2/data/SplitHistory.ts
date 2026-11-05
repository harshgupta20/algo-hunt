/**
 * The F&O backtest's history for NSE / BSE products whose strategy reads contracts: the index / stock from Kite — the
 * prices the live scanner decides on (ATM, spot conditions) — and every option and future from Upstox, the only
 * source of expired contracts. Precise and safe by construction:
 *
 *   one source per instrument   SPOT → Kite; CE / PE / FUT → Upstox — for the whole run. A contract still listed
 *                               today is read from Upstox too, so no series switches source part-way through.
 *   no fallback                 a source that fails, or has no candle, stays a failure / a gap — never filled from
 *                               the other source or a neighbouring strike (an instrument of the wrong source is an
 *                               error, not a quiet redirect).
 *   exact identity              the spot is the product's own Kite index / stock (same product, kind SPOT);
 *                               contracts are Upstox's own listing (expiry, strike, type, the lot size of their expiry).
 *   checked                     check(): Kite vs Upstox on the same minutes — the index / stock on the trigger
 *                               interval, and one contract both list on 1-minute candles (compareCloses).
 */
import type { BacktestDataCheck, V2Instrument, V2Product } from '@/shared/v2';
import { BACKTEST_CHECK_RULE } from '@/shared/v2';
import type { RawCandle } from '../engine/candles';
import type { CandleQuery, NativeInterval } from './DataProvider';
import type { ContractList, HistoryStats, OptionsHistory } from './OptionsHistory';

/** What the split history needs from Kite: today's listing of a product, and candles (through the app's cache). */
export interface KiteSide {
  instruments(productId: string): Promise<V2Instrument[]>;
  candles(q: CandleQuery): Promise<RawCandle[]>;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const isKite = (i: V2Instrument) => i.id.startsWith('K:');
const isUpstox = (i: V2Instrument) => i.id.startsWith('U:');
const INTERVAL_WORDS: Record<NativeInterval, string> = { '1m': '1-minute', '3m': '3-minute', '5m': '5-minute', '10m': '10-minute', '15m': '15-minute', '30m': '30-minute', '1h': '1-hour', '1d': 'daily' };

/** Closes of the same candles (exact time) from Kite and Upstox: how far apart they are. */
export function compareCloses(kite: RawCandle[], upstox: RawCandle[], tick: number): Pick<BacktestDataCheck, 'matched' | 'medianDiffPct' | 'maxDiffPct' | 'withinTickPct' | 'ok'> {
  const other = new Map(upstox.map((c) => [c.time, c.close]));
  const diffs: number[] = [];
  let within = 0;
  for (const k of kite) {
    const u = other.get(k.time);
    if (u === undefined || !(k.close > 0) || !(u > 0)) continue;
    const gap = Math.abs(k.close - u);
    diffs.push((gap / k.close) * 100);
    if (gap <= tick + 1e-9) within++;
  }
  const matched = diffs.length;
  if (!matched) return { matched: 0, medianDiffPct: null, maxDiffPct: null, withinTickPct: null, ok: null };
  diffs.sort((a, b) => a - b);
  const mid = matched >> 1;
  const median = matched % 2 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
  const withinTickPct = round4((within / matched) * 100);
  const R = BACKTEST_CHECK_RULE;
  return {
    matched,
    medianDiffPct: round4(median),
    maxDiffPct: round4(diffs[matched - 1]!),
    withinTickPct,
    ok: matched < R.minMatched ? null : median <= R.maxMedianDiffPct && withinTickPct >= R.minWithinTickPct,
  };
}

export class SplitHistory implements OptionsHistory {
  readonly name = 'Upstox';
  /** The index / stock's source (notes say "the index from Kite"). */
  readonly spotName = 'Kite';
  /** Upstox's own index / stock per product — only for check(). */
  private readonly upstoxSpots = new Map<string, V2Instrument>();
  /** Kite's listing per product, read once per run. */
  private readonly listings = new Map<string, Promise<V2Instrument[]>>();

  constructor(
    private readonly upstox: OptionsHistory,
    private readonly kite: KiteSide,
  ) {}

  private listing(productId: string): Promise<V2Instrument[]> {
    let l = this.listings.get(productId);
    if (!l) this.listings.set(productId, (l = this.kite.instruments(productId)));
    return l;
  }

  async contracts(product: V2Product, range: { from: string; to: string }, opts: { options: boolean; futures: boolean }, stats?: HistoryStats): Promise<ContractList> {
    const [list, listing] = await Promise.all([this.upstox.contracts(product, range, opts, stats), this.listing(product.id)]);
    const spot = listing.find((i) => i.kind === 'SPOT' && i.productId === product.id && isKite(i));
    if (!spot) throw new Error(`Kite lists no index / stock for ${product.symbol} — its price (ATM, spot conditions) can’t be read. Sync products, then run it again.`);
    const foreign = list.contracts.find((c) => !isUpstox(c) || c.productId !== product.id || c.kind === 'SPOT');
    if (foreign) throw new Error(`${foreign.symbol} isn’t one of ${product.symbol}’s Upstox contracts — refusing to mix it in`);
    this.upstoxSpots.set(product.id, list.spot);
    return { ...list, spot };
  }

  async candles(inst: V2Instrument, interval: NativeInterval, from: string, to: string, stats?: HistoryStats): Promise<RawCandle[]> {
    if (inst.kind === 'SPOT') {
      if (!isKite(inst)) throw new Error(`${inst.symbol}: the index / stock price is read from Kite only`);
      return this.kite.candles({ instrument: inst, interval, from, to });
    }
    if (!isUpstox(inst)) throw new Error(`${inst.symbol}: contracts are read from Upstox only`);
    return this.upstox.candles(inst, interval, from, to, stats);
  }

  /**
   * Kite vs Upstox on the same candles for one product: its index / stock on `interval` over `days`, and one contract
   * the run used that Kite still lists (today's listing — expired ones it can't serve), on 1-minute candles over the
   * days of `days` up to its expiry. Prefers a contract a trade was made on. Never throws: a failure is a check
   * that couldn't run (ok null, with the reason).
   */
  async check(p: { product: V2Product; days: string[]; interval: NativeInterval; used: V2Instrument[]; traded: V2Instrument[]; stats?: HistoryStats }): Promise<BacktestDataCheck[]> {
    const out: BacktestDataCheck[] = [];
    const days = [...p.days].sort();
    if (!days.length) return out;
    const base = { productId: p.product.id };
    let listing: V2Instrument[] = [];
    try {
      listing = await this.listing(p.product.id);
    } catch (err) {
      return [{ ...base, what: `${p.product.symbol}`, from: days[0]!, to: days.at(-1)!, matched: 0, medianDiffPct: null, maxDiffPct: null, withinTickPct: null, ok: null, note: `Kite’s listing: ${msg(err)}` }];
    }

    // The index / stock.
    const kSpot = listing.find((i) => i.kind === 'SPOT' && i.productId === p.product.id && isKite(i));
    const uSpot = this.upstoxSpots.get(p.product.id);
    const from = days[0]!;
    const to = days.at(-1)!;
    const spotWhat = `${kSpot?.symbol ?? p.product.symbol} (index / stock), ${INTERVAL_WORDS[p.interval]} closes`;
    if (kSpot && uSpot) {
      try {
        const [k, u] = await Promise.all([this.kite.candles({ instrument: kSpot, interval: p.interval, from, to }), this.upstox.candles(uSpot, p.interval, from, to, p.stats)]);
        out.push({ ...base, what: spotWhat, from, to, ...compareCloses(k, u, kSpot.tickSize) });
      } catch (err) {
        out.push({ ...base, what: spotWhat, from, to, matched: 0, medianDiffPct: null, maxDiffPct: null, withinTickPct: null, ok: null, note: msg(err) });
      }
    }

    // One contract both list: traded ones first, the latest expiry first.
    const twin = (u: V2Instrument) => listing.find((k) => isKite(k) && k.kind === u.kind && k.expiry === u.expiry && (u.strike === null ? k.strike === null : k.strike !== null && Math.abs(k.strike - u.strike) < 1e-6));
    const order = (list: V2Instrument[]) => [...list].sort((a, b) => (b.expiry ?? '').localeCompare(a.expiry ?? ''));
    const seen = new Set<string>();
    const candidates = [...order(p.traded), ...order(p.used)].filter((u) => u.kind !== 'SPOT' && !seen.has(u.id) && seen.add(u.id));
    const pair = candidates.map((u) => ({ u, k: twin(u) })).find((x) => x.k && days.some((d) => d <= (x.u.expiry ?? '9999-12-31')));
    if (!pair || !pair.k) {
      out.push({ ...base, what: 'Contracts, 1-minute closes', from, to, matched: 0, medianDiffPct: null, maxDiffPct: null, withinTickPct: null, ok: null, note: 'Every contract this run used has expired — Kite lists only today’s, so none could be compared.' });
      return out;
    }
    const cDays = days.filter((d) => d <= (pair.u.expiry ?? '9999-12-31'));
    const cFrom = cDays[0]!;
    const cTo = cDays.at(-1)!;
    const what = `${pair.k.symbol} (contract), 1-minute closes`;
    try {
      const [k, u] = await Promise.all([this.kite.candles({ instrument: pair.k, interval: '1m', from: cFrom, to: cTo }), this.upstox.candles(pair.u, '1m', cFrom, cTo, p.stats)]);
      const r = compareCloses(k, u, Math.max(pair.k.tickSize, pair.u.tickSize));
      const lots = pair.k.lotSize !== pair.u.lotSize ? `Lot size differs: Kite ${pair.k.lotSize}, Upstox ${pair.u.lotSize} (Upstox’s is the one traded — it’s that expiry’s).` : undefined;
      out.push({ ...base, what, from: cFrom, to: cTo, ...r, ...(lots ? { note: lots } : {}) });
    } catch (err) {
      out.push({ ...base, what, from: cFrom, to: cTo, matched: 0, medianDiffPct: null, maxDiffPct: null, withinTickPct: null, ok: null, note: msg(err) });
    }
    return out;
  }
}
