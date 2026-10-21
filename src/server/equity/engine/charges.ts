/**
 * Zerodha equity DELIVERY charges per order (published rates, 2025 — update here when they change):
 *   brokerage    ₹0
 *   STT          0.1 % of the buy value and of the sell value
 *   exchange     0.00297 % of the order value (NSE)
 *   SEBI         ₹10 per crore
 *   GST          18 % of exchange + SEBI charges
 *   stamp duty   0.015 % of the buy value
 *   DP charge    ₹15.34 per stock sold (per scrip per day) — GST included (₹3.50 CDSL + ₹9.50 Zerodha + ₹2.34 GST)
 * Each buy and each add is its own order, so pyramiding pays per order.
 */
export const DELIVERY = {
  stt: 0.001,
  exchange: 0.0000297,
  sebi: 10 / 1e7,
  gst: 0.18,
  stamp: 0.00015,
  dp: 15.34,
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function orderCharges(side: 'BUY' | 'SELL', value: number): number {
  if (!(value > 0)) return 0;
  const stt = value * DELIVERY.stt;
  const exchange = value * DELIVERY.exchange;
  const sebi = value * DELIVERY.sebi;
  const stamp = side === 'BUY' ? value * DELIVERY.stamp : 0;
  const dp = side === 'SELL' ? DELIVERY.dp : 0;
  const gst = DELIVERY.gst * (exchange + sebi);
  return round2(stt + exchange + sebi + stamp + dp + gst);
}
