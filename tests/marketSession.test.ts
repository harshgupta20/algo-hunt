import { describe, expect, it } from 'vitest';
import {
  MCX_SESSION,
  NSE_SESSION,
  candleCloseMs,
  isAnyMarketWindow,
  isMarketWindow,
  periodOpenMs,
  sessionCloseMs,
  sessionFor,
  usDstInEffect,
} from '../src/server/utils/marketTime';

const ist = (s: string) => Date.parse(`${s}+05:30`);

describe('MCX session follows US daylight saving', () => {
  it('closes 23:30 while the US is on DST and 23:55 otherwise (switching on the Monday after)', () => {
    // 2026: US DST from Sun 8 Mar to Sun 1 Nov.
    expect(usDstInEffect('2026-03-06')).toBe(false); // Fri before the switch
    expect(usDstInEffect('2026-03-09')).toBe(true); // Mon after
    expect(usDstInEffect('2026-10-30')).toBe(true); // last Friday on DST
    expect(usDstInEffect('2026-11-02')).toBe(false); // Mon after DST ends
    expect(sessionCloseMs(ist('2026-09-23T12:00:00'), MCX_SESSION)).toBe(ist('2026-09-23T23:30:00'));
    expect(sessionCloseMs(ist('2026-12-02T12:00:00'), MCX_SESSION)).toBe(ist('2026-12-02T23:55:00'));
  });

  it('is open in the evening when NSE is closed', () => {
    const evening = ist('2026-09-23T20:00:00');
    expect(isMarketWindow(evening, 0, MCX_SESSION)).toBe(true);
    expect(isMarketWindow(evening, 0, NSE_SESSION)).toBe(false);
    expect(isAnyMarketWindow(evening)).toBe(true);
    expect(isAnyMarketWindow(ist('2026-09-26T20:00:00'))).toBe(false); // Saturday
    expect(isMarketWindow(ist('2026-09-23T09:05:00'), 0, MCX_SESSION)).toBe(true);
    expect(isMarketWindow(ist('2026-09-23T09:05:00'), 0, NSE_SESSION)).toBe(false);
  });

  it('routes underlyings to their session', () => {
    expect(sessionFor('CRUDEOIL')).toBe(MCX_SESSION);
    expect(sessionFor('NIFTY')).toBe(NSE_SESSION);
  });
});

describe('candle alignment and closes per session', () => {
  it('aligns intraday candles to the session open (09:15 NSE, 09:00 MCX)', () => {
    expect(periodOpenMs(ist('2026-09-23T10:20:00'), '1h', NSE_SESSION)).toBe(ist('2026-09-23T10:15:00'));
    expect(periodOpenMs(ist('2026-09-23T10:20:00'), '1h', MCX_SESSION)).toBe(ist('2026-09-23T10:00:00'));
    expect(periodOpenMs(ist('2026-09-23T09:07:00'), '15m', MCX_SESSION)).toBe(ist('2026-09-23T09:00:00'));
  });

  it('daily candles open at IST midnight; weekly on Monday', () => {
    expect(periodOpenMs(ist('2026-09-23T14:00:00'), '1d')).toBe(ist('2026-09-23T00:00:00'));
    expect(periodOpenMs(ist('2026-09-23T14:00:00'), '1w')).toBe(ist('2026-09-21T00:00:00')); // Wed → Mon
    expect(periodOpenMs(ist('2026-09-27T14:00:00'), '1w')).toBe(ist('2026-09-21T00:00:00')); // Sun → same week
  });

  it('truncates the last MCX hourly candle at the session close', () => {
    expect(candleCloseMs(ist('2026-09-23T23:00:00'), '1h', MCX_SESSION)).toBe(ist('2026-09-23T23:30:00'));
    expect(candleCloseMs(ist('2026-12-02T23:00:00'), '1h', MCX_SESSION)).toBe(ist('2026-12-02T23:55:00'));
  });

  it('closes daily candles at the session close and weekly ones on Friday', () => {
    expect(candleCloseMs(ist('2026-09-23T00:00:00'), '1d', NSE_SESSION)).toBe(ist('2026-09-23T15:30:00'));
    expect(candleCloseMs(ist('2026-09-23T00:00:00'), '1d', MCX_SESSION)).toBe(ist('2026-09-23T23:30:00'));
    expect(candleCloseMs(ist('2026-09-21T00:00:00'), '1w', NSE_SESSION)).toBe(ist('2026-09-25T15:30:00'));
  });
});
