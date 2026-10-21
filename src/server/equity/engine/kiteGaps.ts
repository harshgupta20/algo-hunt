/**
 * Days the market traded (Kite's NIFTY 50 has a candle) but Kite's stock histories mostly have no candle — a gap in
 * Kite's data, not days the stocks didn't trade. Found 2026-10-21 against 32 liquid NSE stocks: on each of these 46
 * days 30 of them have no candle (only RELIANCE, and ADANIENT until 2014, do); there is no other such day, and none
 * after 2018. They are every special session before 2019 (Budget Saturdays, Diwali Muhurat sessions, Saturday
 * test sessions) and 24 May – 22 Jun 2004.
 *
 * A next-open order is a day order: it lapses when its stock didn't trade on the market's next day. A stock without
 * a candle on one of these days isn't evidence of that — its order waits for its next candle instead (as
 * TradingView, which fills at the symbol's next bar, would). Illiquid stocks' real no-trade days still lapse.
 */
export const KITE_STOCK_GAPS: ReadonlySet<string> = new Set([
  // special sessions (Saturday / Sunday / Muhurat) missing from Kite's stock histories
  '2003-03-22', '2003-10-25', '2003-11-15', '2004-04-17', '2004-10-09', '2005-06-04', '2005-11-26', '2006-04-29',
  '2006-06-25', '2006-10-21', '2009-10-17', '2010-02-06', '2011-10-26', '2012-01-07', '2012-03-03', '2012-04-28',
  '2012-09-08', '2013-05-11', '2013-11-03', '2014-03-22', '2015-02-28', '2016-10-30', '2017-10-19', '2018-11-07',
  // 24 May – 22 Jun 2004: no candles for most stocks
  '2004-05-24', '2004-05-25', '2004-05-26', '2004-05-27', '2004-05-28', '2004-05-31', '2004-06-01', '2004-06-02',
  '2004-06-03', '2004-06-04', '2004-06-07', '2004-06-08', '2004-06-09', '2004-06-10', '2004-06-11', '2004-06-14',
  '2004-06-15', '2004-06-16', '2004-06-17', '2004-06-18', '2004-06-21', '2004-06-22',
]);
