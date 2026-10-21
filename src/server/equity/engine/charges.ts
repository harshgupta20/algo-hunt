/**
 * Zerodha equity charges per order (published rates, zerodha.com/charges, Oct 2026 — update here when they change).
 *
 * DELIVERY (CNC, held overnight)
 *   brokerage    ₹0
 *   STT          0.1 % of the buy value and of the sell value
 *   exchange     0.00307 % of the order value (NSE)
 *   SEBI         ₹10 per crore
 *   GST          18 % of brokerage + exchange + SEBI
 *   stamp duty   0.015 % of the buy value
 *   DP charge    ₹15.34 per stock sold (per scrip per day) — GST included (₹3.50 CDSL + ₹9.50 Zerodha + ₹2.34 GST)
 *
 * INTRADAY — a CNC buy sold the SAME DAY is charged as intraday (Zerodha support: "treated as intraday")
 *   brokerage    0.03 % or ₹20 per executed order, whichever is lower
 *   STT          0.025 % of the sell value (none on the buy)
 *   stamp duty   0.003 % of the buy value
 *   exchange / SEBI / GST as above; no DP charge (the shares never leave or enter the demat)
 *
 * Each buy and each add is its own order, so pyramiding pays per order.
 */
export const DELIVERY = {
  stt: 0.001,
  exchange: 0.0000307,
  sebi: 10 / 1e7,
  gst: 0.18,
  stamp: 0.00015,
  dp: 15.34,
} as const;

export const INTRADAY = {
  brokerage: 0.0003,
  brokerageCap: 20,
  sttSell: 0.00025,
  stamp: 0.00003,
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Charges of a delivery order (`intraday` = false) or a same-day round trip's leg (`intraday` = true). */
export function orderCharges(side: 'BUY' | 'SELL', value: number, intraday = false): number {
  if (!(value > 0)) return 0;
  const exchange = value * DELIVERY.exchange;
  const sebi = value * DELIVERY.sebi;
  if (intraday) {
    const brokerage = Math.min(value * INTRADAY.brokerage, INTRADAY.brokerageCap);
    const stt = side === 'SELL' ? value * INTRADAY.sttSell : 0;
    const stamp = side === 'BUY' ? value * INTRADAY.stamp : 0;
    return round2(brokerage + stt + exchange + sebi + stamp + DELIVERY.gst * (brokerage + exchange + sebi));
  }
  const stt = value * DELIVERY.stt;
  const stamp = side === 'BUY' ? value * DELIVERY.stamp : 0;
  const dp = side === 'SELL' ? DELIVERY.dp : 0;
  return round2(stt + exchange + sebi + stamp + dp + DELIVERY.gst * (exchange + sebi));
}

/**
 * Charges of one sale order of `intradayQty` shares bought today and `deliveryQty` held from before, at `price`:
 * one order, so one brokerage (on the intraday part) and one DP charge (only if delivery shares leave the demat).
 */
export function saleCharges(price: number, intradayQty: number, deliveryQty: number): number {
  if (!intradayQty) return orderCharges('SELL', deliveryQty * price);
  const intraday = orderCharges('SELL', intradayQty * price, true);
  return deliveryQty ? round2(intraday + orderCharges('SELL', deliveryQty * price)) : intraday;
}
