/**
 * Approximate Zerodha charges for a round trip (one buy + one sell order), from Zerodha's published
 * rates (2025). They change occasionally — update the table here when they do.
 *   brokerage   ₹20 per order (options), or 0.03 % capped at ₹20 (futures, intraday equity)
 *   STT / CTT   on the sell side (options on premium)
 *   exchange    transaction charges on turnover
 *   SEBI        ₹10 per crore of turnover
 *   GST         18 % on brokerage + exchange + SEBI
 *   stamp duty  on the buy side
 *
 * Also the money a trade ties up (`moneyPerUnit`): the premium for bought options and stocks, an
 * estimated margin for futures and sold options (Kite's exact SPAN + exposure margin needs its margin API).
 */
import type { PaperSide, ProductKind, V2Instrument } from '@/shared/v2';

interface Rates {
  brokerage: 'flat' | 'capped' | 'free';
  stt: number; // on sell value
  sttBuy?: number; // on buy value (delivery)
  exchange: number; // on total turnover
  stamp: number; // on buy value
}

const PCT = 0.01;
const RATES = {
  nseOption: { brokerage: 'flat', stt: 0.1 * PCT, exchange: 0.03503 * PCT, stamp: 0.003 * PCT },
  bseOption: { brokerage: 'flat', stt: 0.1 * PCT, exchange: 0.0325 * PCT, stamp: 0.003 * PCT },
  nseFuture: { brokerage: 'capped', stt: 0.02 * PCT, exchange: 0.00173 * PCT, stamp: 0.002 * PCT },
  mcxOption: { brokerage: 'flat', stt: 0.05 * PCT, exchange: 0.0418 * PCT, stamp: 0.003 * PCT },
  mcxFuture: { brokerage: 'capped', stt: 0.01 * PCT, exchange: 0.0021 * PCT, stamp: 0.002 * PCT },
  equityIntraday: { brokerage: 'capped', stt: 0.025 * PCT, exchange: 0.00297 * PCT, stamp: 0.003 * PCT },
  equityDelivery: { brokerage: 'free', stt: 0.1 * PCT, sttBuy: 0.1 * PCT, exchange: 0.00297 * PCT, stamp: 0.015 * PCT },
} satisfies Record<string, Rates>;

function ratesFor(i: V2Instrument, intraday: boolean): Rates {
  const option = i.kind === 'CE' || i.kind === 'PE';
  if (i.exchange === 'MCX') return option ? RATES.mcxOption : RATES.mcxFuture;
  if (i.kind === 'SPOT') return intraday ? RATES.equityIntraday : RATES.equityDelivery;
  if (i.exchange === 'BFO') return option ? RATES.bseOption : RATES.nseFuture;
  return option ? RATES.nseOption : RATES.nseFuture;
}

const brokerage = (r: Rates, value: number) => (r.brokerage === 'free' ? 0 : r.brokerage === 'flat' ? 20 : Math.min(20, value * 0.03 * PCT));

/** Total charges (₹) for buying `quantity` at `buyPrice` and selling at `sellPrice` (stocks: intraday unless `intraday` is false). */
export function roundTripCharges(i: V2Instrument, quantity: number, buyPrice: number, sellPrice: number, intraday = true): number {
  const r = ratesFor(i, intraday);
  const buy = buyPrice * quantity;
  const sell = sellPrice * quantity;
  const brk = brokerage(r, buy) + brokerage(r, sell);
  const exchange = (buy + sell) * r.exchange;
  const sebi = (buy + sell) * 1e-6; // ₹10 per crore
  const gst = 0.18 * (brk + exchange + sebi);
  const total = brk + r.stt * sell + (r.sttBuy ?? 0) * buy + exchange + sebi + gst + r.stamp * buy;
  return Math.round(total * 100) / 100;
}

/** Rough SPAN + exposure margin as a share of the contract value (varies by contract and volatility). */
const MARGIN_SHARE: Record<ProductKind, number> = { INDEX: 0.12, STOCK: 0.2, COMMODITY: 0.1 };

/** Money one unit of quantity ties up: price for bought options / stocks, an estimated margin for futures and sold options. */
export function moneyPerUnit(i: V2Instrument, kind: ProductKind, side: PaperSide, price: number): { perUnit: number; estimated: boolean } {
  const option = i.kind === 'CE' || i.kind === 'PE';
  if (i.kind === 'SPOT' || (option && side === 'BUY')) return { perUnit: price, estimated: false };
  const underlying = option ? (i.strike ?? price) : price;
  return { perUnit: underlying * MARGIN_SHARE[kind], estimated: true };
}
