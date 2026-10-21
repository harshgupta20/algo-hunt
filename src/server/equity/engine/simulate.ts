/**
 * The equity portfolio simulation — every trading day in order, all stocks sharing one cash balance.
 *
 * Each day, in this exact order:
 *   1. OPEN (fills at the next open only): orders signalled at the previous check fill at today's open —
 *      sells first (they free cash), then adds, then new buys (stocks in alphabetical order).
 *   2. DURING THE DAY, for every stock held:
 *        stop-loss (TOUCH mode): today opened at / below the stop → sold at the open (a gap); else today's low
 *          reached it → sold at the stop. The stop is the highest of: stop-loss %, trailing stop (highest high
 *          before today), the pyramiding stop.
 *        target: opened at / above it → sold at the open; else today's high reached it → sold at the target.
 *        Both touched in one day (no gap) → the STOP counts (we can't know which came first).
 *      Then the highest high is updated with today's high.
 *   3. CLOSE, for stocks whose check falls today (every day for Daily, the week's last day for Weekly):
 *        a. exits — stop on a closing basis (CLOSE mode), exit conditions, time exit;
 *        b. pyramiding — MA ≥ last buy price and close ≥ MA → buy one more lot; the stop for ALL lots
 *           becomes that MA value once the lot is bought;
 *        c. new buys — entry conditions true (or just turned true) for a stock not held and not sold today.
 *      With fills at the close these happen now (sells, then adds, then buys); with fills at the next open
 *      they wait for step 1 of the next trading day.
 *   4. The account is valued at the close (cash + shares × close).
 * How orders fill (next open or the close, stops on the low or the close, charges, slippage) comes from the order
 * rules — EQ_ORDER_RULES in every backtest. Slippage worsens every market order (not target limit orders) and the
 * order's text shows the price before it. A buy that the cash can't cover, that buys
 * 0 shares, or that exceeds the max stocks held is skipped and listed. Positions open at the end are closed
 * at the last close (reason END, charges counted).
 */
import type { EqExitReason, EqFill, EqOrderRules, EqSkip, EqStrategyDefinition, EqTrade } from '@/shared/equity';
import { fmtNum } from '@/shared/equity';
import type { Bars } from './bars';
import { orderCharges } from './charges';
import { TRUE, type Timeline } from './evaluate';

export interface SimStock {
  symbol: string;
  name: string;
  /** All daily candles fetched (warm-up included). */
  daily: Bars;
  timeline: Timeline;
  /** Per check: entry conditions / exit conditions (tri-state) and the pyramiding MA. */
  entry: Int8Array;
  exit: Int8Array | null;
  ma: Float64Array | null;
  /** Audit text for an entry / exit signal at check k. */
  why(kind: 'ENTRY' | 'EXIT', k: number): string;
}

export interface SimOptions {
  from: string;
  to: string;
  capital: number | null;
  maxPositions: number | null;
  rules: EqOrderRules;
}

export interface SimOutput {
  trades: EqTrade[];
  skipped: EqSkip[];
  curve: Array<{ date: string; equity: number }>;
  openAtEnd: number;
  /** Trading days with at least one stock held, and all trading days. */
  exposedDays: number;
  days: number;
}

interface Position {
  fills: EqFill[];
  qty: number;
  /** Σ price × shares of every buy. */
  buyValue: number;
  charges: number;
  firstPrice: number;
  lastBuyPrice: number;
  adds: number;
  pyramidStop: number | null;
  /** Highest high since the first buy (the fill price on the first day). */
  highWater: number;
  /** Check index of the entry signal (time exits count checks from here). */
  entryCheck: number;
  entryDate: string;
}

interface Pending {
  kind: 'ENTRY' | 'ADD' | 'EXIT';
  signalDate: string;
  signalCheck: number;
  reason: string;
  exitReason?: EqExitReason;
  stopAfter?: number;
}

interface Slot {
  stock: SimStock;
  /** Next daily index to process. */
  ptr: number;
  lastClose: number | null;
  lastDate: string | null;
  pos: Position | null;
  pending: Pending | null;
  soldOn: string | null;
  /** Last skip reason per kind (one entry in the list per run of identical skips). */
  lastSkip: Record<'ENTRY' | 'ADD', string | null>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const inr = (n: number) => `₹${fmtNum(n)}`;
const fmtPct = (n: number) => `${Math.round(n * 1e4) / 1e4}%`;

export function simulate(def: EqStrategyDefinition, stocks: SimStock[], opt: SimOptions): SimOutput {
  const slots: Slot[] = [...stocks]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((stock) => {
      let ptr = 0;
      while (ptr < stock.daily.length && stock.daily.date[ptr]! < opt.from) ptr++;
      return { stock, ptr, lastClose: ptr > 0 ? stock.daily.close[ptr - 1]! : null, lastDate: null, pos: null, pending: null, soldOn: null, lastSkip: { ENTRY: null, ADD: null } };
    });
  const dateSet = new Set<string>();
  for (const s of slots) for (let i = s.ptr; i < s.stock.daily.length && s.stock.daily.date[i]! <= opt.to; i++) dateSet.add(s.stock.daily.date[i]!);
  const dates = [...dateSet].sort();

  const rules = opt.rules;
  const slip = rules.slippagePct / 100;
  const charge = (side: 'BUY' | 'SELL', value: number) => (rules.charges ? orderCharges(side, value) : 0);
  /** The price before slippage, for the order's text. */
  const slipped = (raw: number, sign: '+' | '−') => (slip ? ` (${inr(raw)} ${sign} ${fmtPct(rules.slippagePct)} slippage)` : '');
  const limited = opt.capital !== null;
  let cash = opt.capital ?? 0;
  let tradeNo = 0;
  const trades: EqTrade[] = [];
  const skipped: EqSkip[] = [];
  const curve: SimOutput['curve'] = [];
  let exposedDays = 0;

  const held = () => slots.filter((s) => s.pos).length;
  const pendingBuys = () => slots.filter((s) => s.pending?.kind === 'ENTRY').length;
  const equity = () => cash + slots.reduce((a, s) => a + (s.pos && s.lastClose !== null ? s.pos.qty * s.lastClose : 0), 0);
  const avg = (p: Position) => p.buyValue / p.qty;
  const base = (p: Position) => (def.exit.priceBase === 'AVERAGE' ? avg(p) : p.firstPrice);

  const skip = (s: Slot, kind: 'ENTRY' | 'ADD', date: string, category: string, reason: string) => {
    if (s.lastSkip[kind] === category) return;
    s.lastSkip[kind] = category;
    skipped.push({ symbol: s.stock.symbol, date, kind, reason });
  };

  /** The binding stop: the highest of stop-loss %, trailing stop and the pyramiding stop. */
  const activeStop = (p: Position): { price: number; reason: EqExitReason; label: string } | null => {
    const c: Array<{ price: number; reason: EqExitReason; label: string; rank: number }> = [];
    if (def.exit.stopLossPct !== null) c.push({ price: base(p) * (1 - def.exit.stopLossPct / 100), reason: 'STOP_LOSS', label: `stop-loss ${def.exit.stopLossPct}%`, rank: 0 });
    if (def.exit.trailingStopPct !== null) c.push({ price: p.highWater * (1 - def.exit.trailingStopPct / 100), reason: 'TRAILING_STOP', label: `trailing stop ${def.exit.trailingStopPct}% below ${inr(p.highWater)}`, rank: 1 });
    if (p.pyramidStop !== null) c.push({ price: p.pyramidStop, reason: 'PYRAMID_STOP', label: 'pyramiding stop', rank: 2 });
    if (!c.length) return null;
    return c.reduce((a, b) => (b.price > a.price || (b.price === a.price && b.rank > a.rank) ? b : a));
  };
  const targetPrice = (p: Position) => (def.exit.targetPct === null ? null : base(p) * (1 + def.exit.targetPct / 100));

  const shares = (price: number): number => {
    const v = def.sizing.value;
    if (def.sizing.mode === 'QUANTITY') return Math.floor(v);
    const money = def.sizing.mode === 'AMOUNT' ? v : (equity() * v) / 100;
    return Math.floor(money / price);
  };

  function buy(s: Slot, raw: number, date: string, o: { kind: 'ENTRY' | 'ADD'; signalDate: string; signalCheck: number; reason: string; stopAfter?: number }): boolean {
    const px = raw * (1 + slip);
    const qty = shares(px);
    if (qty < 1) {
      skip(s, o.kind, date, 'size', `${def.sizing.mode === 'QUANTITY' ? 'Shares per buy' : 'Money per buy'} buys 0 shares at ${inr(px)}`);
      return false;
    }
    if (o.kind === 'ENTRY' && opt.maxPositions !== null && held() >= opt.maxPositions) {
      skip(s, o.kind, date, 'max', `Already holding ${opt.maxPositions} stocks (the maximum)`);
      return false;
    }
    const value = qty * px;
    const ch = charge('BUY', value);
    if (limited && value + ch > cash + 1e-9) {
      skip(s, o.kind, date, 'cash', `Not enough cash: ${qty} × ${inr(px)} needs ${inr(value + ch)}, ${inr(Math.max(0, cash))} free`);
      return false;
    }
    cash -= value + ch;
    s.lastSkip[o.kind] = null;
    let p = s.pos;
    if (o.kind === 'ENTRY' || !p) {
      p = { fills: [], qty: 0, buyValue: 0, charges: 0, firstPrice: px, lastBuyPrice: px, adds: 0, pyramidStop: null, highWater: px, entryCheck: o.signalCheck, entryDate: date };
      s.pos = p;
    } else {
      p.adds++;
      p.lastBuyPrice = px;
      if (o.stopAfter !== undefined) p.pyramidStop = o.stopAfter;
    }
    p.qty += qty;
    p.buyValue += value;
    p.charges += ch;
    const stop = activeStop(p);
    p.fills.push({ date, side: 'BUY', kind: o.kind, quantity: qty, price: round2(px), charges: ch, reason: `${o.reason}${slipped(raw, '+')}`, signalDate: o.signalDate, stopAfter: stop ? round2(stop.price) : null });
    return true;
  }

  function sell(s: Slot, raw: number, date: string, o: { reason: EqExitReason; text: string; signalDate: string; slippage: boolean }) {
    const p = s.pos!;
    const px = o.slippage ? raw * (1 - slip) : raw;
    const value = p.qty * px;
    const ch = charge('SELL', value);
    cash += value - ch;
    p.charges += ch;
    p.fills.push({ date, side: 'SELL', kind: 'EXIT', quantity: p.qty, price: round2(px), charges: ch, reason: `${o.text}${o.slippage ? slipped(raw, '−') : ''}`, signalDate: o.signalDate, stopAfter: null });
    const gross = value - p.buyValue;
    const net = gross - p.charges;
    trades.push({
      id: `t${++tradeNo}`,
      symbol: s.stock.symbol,
      name: s.stock.name,
      entryDate: p.entryDate,
      exitDate: date,
      exitReason: o.reason,
      quantity: p.qty,
      adds: p.adds,
      avgPrice: round2(avg(p)),
      exitPrice: round2(px),
      invested: round2(p.buyValue),
      grossPnl: round2(gross),
      charges: round2(p.charges),
      netPnl: round2(net),
      returnPct: round2((net / p.buyValue) * 100),
      holdingDays: daysBetween(p.entryDate, date),
      fills: p.fills,
    });
    s.pos = null;
    s.soldOn = date;
  }

  for (const date of dates) {
    const today = slots.filter((s) => s.ptr < s.stock.daily.length && s.stock.daily.date[s.ptr] === date);
    const bar = (s: Slot) => {
      const d = s.stock.daily;
      const i = s.ptr;
      return { i, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]! };
    };

    // 1. Orders from the previous check fill at today's open: sells, adds, buys.
    for (const kind of ['EXIT', 'ADD', 'ENTRY'] as const) {
      for (const s of today) {
        const o = s.pending;
        if (!o || o.kind !== kind) continue;
        s.pending = null;
        const b = bar(s);
        if (kind === 'EXIT') {
          if (s.pos) sell(s, b.open, date, { reason: o.exitReason!, text: `${o.reason} — sold at the next open`, signalDate: o.signalDate, slippage: true });
        } else if (kind === 'ADD') {
          if (s.pos) buy(s, b.open, date, { kind, signalDate: o.signalDate, signalCheck: o.signalCheck, reason: `${o.reason} — bought at the next open`, stopAfter: o.stopAfter });
        } else if (!s.pos) {
          buy(s, b.open, date, { kind, signalDate: o.signalDate, signalCheck: o.signalCheck, reason: `${o.reason} — bought at the next open` });
        }
      }
    }

    // 2. Stops and targets during the day.
    for (const s of today) {
      const p = s.pos;
      if (!p) continue;
      const b = bar(s);
      const stop = activeStop(p);
      const target = targetPrice(p);
      const touch = rules.stopTrigger === 'TOUCH';
      if (touch && stop && b.open <= stop.price) sell(s, b.open, date, { reason: stop.reason, text: `Opened at ${inr(b.open)}, at or below the ${stop.label} ${inr(stop.price)}`, signalDate: date, slippage: true });
      else if (target !== null && b.open >= target) sell(s, b.open, date, { reason: 'TARGET', text: `Opened at ${inr(b.open)}, at or above the target ${inr(target)}`, signalDate: date, slippage: false });
      else if (touch && stop && b.low <= stop.price) sell(s, stop.price, date, { reason: stop.reason, text: `Low ${inr(b.low)} reached the ${stop.label} ${inr(stop.price)}${target !== null && b.high >= target ? ' (the target was touched the same day — the stop counts)' : ''}`, signalDate: date, slippage: true });
      else if (target !== null && b.high >= target) sell(s, target, date, { reason: 'TARGET', text: `High ${inr(b.high)} reached the target ${inr(target)}`, signalDate: date, slippage: false });
      if (s.pos) s.pos.highWater = Math.max(s.pos.highWater, b.high);
    }

    // 3. Checks at the close.
    for (const s of today) s.lastClose = bar(s).close;
    const checks = today.map((s) => ({ s, k: s.stock.timeline.checkAt[s.ptr]! })).filter((x) => x.k >= 0);
    const atClose = rules.fill === 'CLOSE';
    // a. exits
    for (const { s, k } of checks) {
      const p = s.pos;
      if (!p || s.pending) continue;
      const b = bar(s);
      const stop = activeStop(p);
      let reason: EqExitReason | null = null;
      let text = '';
      if (rules.stopTrigger === 'CLOSE' && stop && b.close < stop.price) {
        reason = stop.reason;
        text = `Closed at ${inr(b.close)}, below the ${stop.label} ${inr(stop.price)}`;
      } else if (s.stock.exit && s.stock.exit[k] === TRUE) {
        reason = 'EXIT_RULE';
        text = `Exit: ${s.stock.why('EXIT', k)}`;
      } else if (def.exit.maxBars !== null && k - p.entryCheck >= def.exit.maxBars) {
        reason = 'TIME';
        text = `Held ${k - p.entryCheck} ${def.timeframe === '1w' ? 'weeks' : 'days'} (time exit)`;
      }
      if (!reason) continue;
      if (atClose) sell(s, b.close, date, { reason, text, signalDate: date, slippage: true });
      else s.pending = { kind: 'EXIT', signalDate: date, signalCheck: k, reason: text, exitReason: reason };
    }
    // b. pyramiding
    if (def.pyramid.enabled) {
      for (const { s, k } of checks) {
        const p = s.pos;
        if (!p || s.pending || !s.stock.ma) continue;
        const ma = s.stock.ma[k]!;
        const close = bar(s).close;
        const due = Number.isFinite(ma) && ma >= p.lastBuyPrice && close >= ma && (def.pyramid.maxAdds === null || p.adds < def.pyramid.maxAdds);
        if (!due) {
          s.lastSkip.ADD = null;
          continue;
        }
        const label = `${def.pyramid.maType}(${def.pyramid.maPeriod})`;
        const reason = `${label} ${inr(ma)} reached the last buy ${inr(p.lastBuyPrice)} (close ${inr(close)}); stop for all lots → ${inr(ma)}`;
        if (atClose) buy(s, close, date, { kind: 'ADD', signalDate: date, signalCheck: k, reason, stopAfter: ma });
        else s.pending = { kind: 'ADD', signalDate: date, signalCheck: k, reason, stopAfter: ma };
      }
    }
    // c. new buys
    for (const { s, k } of checks) {
      if (s.pos || s.pending || s.soldOn === date) continue;
      const e = s.stock.entry;
      const signal = e[k] === TRUE && (def.entry.trigger === 'WHEN_TRUE' || k === 0 || e[k - 1] !== TRUE);
      if (!signal) {
        s.lastSkip.ENTRY = null;
        continue;
      }
      const reason = `Entry: ${s.stock.why('ENTRY', k)}`;
      if (atClose) buy(s, bar(s).close, date, { kind: 'ENTRY', signalDate: date, signalCheck: k, reason });
      else if (opt.maxPositions !== null && held() + pendingBuys() >= opt.maxPositions) skip(s, 'ENTRY', date, 'max', `Already holding ${opt.maxPositions} stocks (the maximum)`);
      else s.pending = { kind: 'ENTRY', signalDate: date, signalCheck: k, reason };
    }

    // 4. Value the account at the close.
    for (const s of today) {
      s.lastDate = date;
      s.ptr++;
    }
    if (slots.some((s) => s.pos)) exposedDays++;
    curve.push({ date, equity: round2(equity()) });
  }

  // Still open at the end: closed at the last close (charges counted, no slippage).
  let openAtEnd = 0;
  for (const s of slots) {
    if (s.pending?.kind === 'ENTRY') skipped.push({ symbol: s.stock.symbol, date: s.pending.signalDate, kind: 'ENTRY', reason: 'Signal at the last check — it would buy at the next open, after the period' });
    if (!s.pos || s.lastClose === null) continue;
    openAtEnd++;
    const pendingExit = s.pending?.kind === 'EXIT' ? s.pending : null;
    sell(s, s.lastClose, s.lastDate ?? opt.to, {
      reason: pendingExit?.exitReason ?? 'END',
      text: pendingExit ? `${pendingExit.reason} — at the last close (the next open is after the period)` : 'Still held at the end of the period — valued at the last close',
      signalDate: pendingExit?.signalDate ?? s.lastDate ?? opt.to,
      slippage: false,
    });
  }
  // The last point includes the END sales' charges, so it equals the trades' total.
  if (curve.length) curve[curve.length - 1]!.equity = round2(cash);

  return { trades, skipped, curve, openAtEnd, exposedDays, days: dates.length };
}
