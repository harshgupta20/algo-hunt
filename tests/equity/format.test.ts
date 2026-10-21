/** TradingView chart links for NSE stocks (TradingView writes NSE's “-” as “_” and keeps “&”). */
import { describe, expect, it } from 'vitest';
import { tradingViewUrl } from '../../src/client/equity/format';

describe('TradingView links', () => {
  it('opens the NSE chart on the strategy’s candles', () => {
    expect(tradingViewUrl('MARUTI', '1w')).toBe('https://www.tradingview.com/chart/?symbol=NSE%3AMARUTI&interval=W');
    expect(tradingViewUrl('BAJAJ-AUTO', '1d')).toBe('https://www.tradingview.com/chart/?symbol=NSE%3ABAJAJ_AUTO&interval=D');
    expect(tradingViewUrl('M&M', '1d')).toBe('https://www.tradingview.com/chart/?symbol=NSE%3AM%26M&interval=D');
  });
});
