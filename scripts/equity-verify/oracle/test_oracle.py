"""Self-tests for the oracle. Run: python3 oracle/test_oracle.py  (the smoke test needs the candles that
`npm run verify:equity` downloads into $EQUITY_VERIFY_DIR, default ~/.cache/algo-hunt-verify)

Expected values are hand-computed (worked in the comments), not produced by the code under test.
"""
import datetime
import json
import math
import os
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import indicators as I  # noqa: E402
from evaluate import build_weekly, StrategySeries  # noqa: E402
from simulate import simulate, round2, order_charges  # noqa: E402

nan = float('nan')


def close_list(test, got, exp, places=9):
    got = list(got)
    test.assertEqual(len(got), len(exp), (got, exp))
    for i, (g, e) in enumerate(zip(got, exp)):
        if e != e:
            test.assertTrue(g != g, 'index %d: expected na, got %r (%r)' % (i, g, got))
        else:
            test.assertFalse(g != g, 'index %d: expected %r, got na (%r)' % (i, e, got))
            test.assertAlmostEqual(g, e, places=places, msg='index %d: %r vs %r' % (i, got, exp))


def weekdays(start, n):
    d = datetime.date.fromisoformat(start)
    out = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


NOVOL = -1000   # row volume code for a real zero-volume (v3 NONE) candle: 1000 + NOVOL = 0


def bars_from(rows, dates=None):
    """rows = [(o, h, l, c[, v]), ...]. Volume = 1000 + v (default 1000), so every candle trades (v3) unless
    v == NOVOL ; v is the test's signal channel (VOL_ENTRY: v >= 1, VOL_EXIT: v <= -1)."""
    if dates is None:
        dates = weekdays('2026-01-05', len(rows))
    return {'date': list(dates),
            'open': [float(r[0]) for r in rows], 'high': [float(r[1]) for r in rows],
            'low': [float(r[2]) for r in rows], 'close': [float(r[3]) for r in rows],
            'volume': [1000.0 + float(r[4]) if len(r) > 4 else 1000.0 for r in rows]}


# =============================================================================================
class TestIndicators(unittest.TestCase):

    def test_sma(self):
        close_list(self, I.sma([1, 2, 3, 4, 5], 3), [nan, nan, 2, 3, 4])
        close_list(self, I.sma([1, 2], 3), [nan, nan])

    def test_ema(self):
        # alpha = 0.5; seed idx2 = (2+4+6)/3 = 4; idx3 = .5*10+.5*4 = 7; idx4 = .5*2+.5*7 = 4.5
        close_list(self, I.ema([2, 4, 6, 10, 2], 3), [nan, nan, 4, 7, 4.5])

    def test_rma(self):
        # seed idx1 = 1.5; idx2 = (1.5*1+3)/2 = 2.25; idx3 = (2.25+4)/2 = 3.125
        close_list(self, I.rma([1, 2, 3, 4], 2), [nan, 1.5, 2.25, 3.125])

    def test_wma(self):
        # denom 6: idx2 = (3*3+2*2+1*1)/6 = 14/6 ; idx3 = (3*4+2*3+1*2)/6 = 20/6
        close_list(self, I.wma([1, 2, 3, 4], 3), [nan, nan, 14 / 6, 20 / 6])

    def test_rsi(self):
        # changes +1,-1,+2,+1 ; up rma2: .5, 1.25, 1.125 ; down rma2: .5, .25, .125
        # rsi: 100-100/(1+1)=50 ; 100-100/6 ; 100-100/10=90
        close_list(self, I.rsi([10, 11, 10, 12, 13], 2), [nan, nan, 50, 100 - 100 / 6, 90])

    def test_rsi_edges(self):
        close_list(self, I.rsi([1, 2, 3, 4], 2), [nan, nan, 100, 100])      # all gains: down == 0
        close_list(self, I.rsi([4, 3, 2, 1], 2), [nan, nan, 0, 0])          # all losses: up == 0
        close_list(self, I.rsi([5, 5, 5, 5], 2), [nan, nan, 100, 100])      # flat: down == 0 checked first

    def test_macd(self):
        # x = 1,3,2,6,4,8 ; EMA2 (a=2/3): 2, 2, 14/3, 38/9, 182/27 (idx1..5); EMA3 (a=.5): 2, 4, 4, 6 (idx2..5)
        # line idx2..5: 0, 2/3, 2/9, 20/27 ; signal EMA2 seeded at idx3 = 1/3, then 7/27, 47/81
        x = [1, 3, 2, 6, 4, 8]
        r = I.macd(x, 2, 3, 2)
        close_list(self, r['line'], [nan, nan, 0, 2 / 3, 2 / 9, 20 / 27])
        close_list(self, r['signal'], [nan, nan, nan, 1 / 3, 7 / 27, 47 / 81])
        close_list(self, r['hist'], [nan, nan, nan, 1 / 3, -1 / 27, 13 / 81])
        b = bars_from([(v, v, v, v) for v in x])
        close_list(self, I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'MACD',
                                              'params': {'fast': 2, 'slow': 3, 'signal': 2},
                                              'output': 'signal'}), [nan, nan, nan, 1 / 3, 7 / 27, 47 / 81])

    def test_bb(self):
        # n=3,k=2 at idx2: window 1,2,6 basis 3, dev = sqrt((4+1+9)/3)
        dev = math.sqrt(14 / 3)
        r = I.bb([1, 2, 6], 3, 2)
        close_list(self, r['mid'], [nan, nan, 3])
        close_list(self, r['upper'], [nan, nan, 3 + 2 * dev])
        close_list(self, r['lower'], [nan, nan, 3 - 2 * dev])
        close_list(self, r['percentB'], [nan, nan, (6 - (3 - 2 * dev)) / (4 * dev)])
        close_list(self, r['bandwidth'], [nan, nan, 4 * dev / 3 * 100])
        # flat -> upper == lower -> percentB na ; basis 0 -> bandwidth na
        r = I.bb([0, 0], 2, 2)
        close_list(self, r['percentB'], [nan, nan])
        close_list(self, r['bandwidth'], [nan, nan])
        close_list(self, r['upper'], [nan, 0])

    ATR_BARS = [(9, 10, 8, 9), (10, 12, 9, 11), (11, 11, 10, 10), (12, 15, 12, 14), (13, 14, 11, 11.5),
                (11, 12, 9, 9.5)]

    def test_atr(self):
        # tr: 2, 3, 1, 5, 3, 3 ; rma2: 2.5, 1.75, 3.375, 3.1875, 3.09375
        b = bars_from(self.ATR_BARS)
        close_list(self, I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'ATR', 'params': {'period': 2}}),
                   [nan, 2.5, 1.75, 3.375, 3.1875, 3.09375])

    def test_supertrend(self):
        # factor 1, period 2, by hand:
        # i1: hl2 10.5 ub 13 lb 8 -> first -> TV dir 1 -> st=ub 13 (app -1)
        # i2: ub 12.25 (<13) lb 8.75 ; prevST==prevUB -> close 10 > 12.25? no -> st 12.25 (app -1)
        # i3: ub 16.875 kept 12.25 ; lb 10.125 ; close 14 > 12.25 -> TV -1 -> st = lb 10.125 (app +1)
        # i4: lb 9.3125 -> kept 10.125 ; ub 15.6875 (close[1] 14 > 12.25) ; close 11.5 < 10.125? no -> 10.125 (+1)
        # i5: ub 13.59375 (<15.6875) ; lb kept 10.125 ; close 9.5 < 10.125 -> TV 1 -> st 13.59375 (app -1)
        b = bars_from(self.ATR_BARS)
        op = {'kind': 'INDICATOR', 'indicator': 'SUPERTREND', 'params': {'period': 2, 'multiplier': 1}}
        close_list(self, I.operand_column(b, op), [nan, 13, 12.25, 10.125, 10.125, 13.59375])
        close_list(self, I.operand_column(b, dict(op, output='direction')), [nan, -1, -1, 1, 1, -1])

    DMI_BARS = [(9, 10, 8, 9), (10, 12, 9, 11), (10, 11, 7, 8), (9, 13, 8, 12), (12, 13, 6, 7)]

    def test_dmi_adx(self):
        # +DM: -,2,0,2,0  -DM: -,0,2,0,2  tr(na first): -,3,4,5,7
        # rma2 tr: 3.5, 4.25, 5.625 ; +: 1, 1.5, .75 ; -: 1, .5, 1.25  (idx2..4)
        # plus = 100/3.5, 600/17, 40/3 ; minus = 100/3.5, 200/17, 200/9
        # dx = 0, .5, .25 ; adx (smoothing 2) = 100*rma: idx3 25, idx4 25
        b = bars_from(self.DMI_BARS)
        close_list(self, I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'DMI', 'params': {'period': 2}}),
                   [nan, nan, 100 / 3.5, 600 / 17, 40 / 3])
        close_list(self, I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'DMI', 'params': {'period': 2},
                                              'output': 'minus'}), [nan, nan, 100 / 3.5, 200 / 17, 200 / 9])
        close_list(self, I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'ADX',
                                              'params': {'period': 2, 'smoothing': 2}}), [nan, nan, nan, 25, 25])

    def test_dmi_fixnan(self):
        # flat start: trur == 0 -> 0/0 -> na and nothing to carry yet; later values defined
        b = bars_from([(5, 5, 5, 5)] * 3 + [(5, 7, 5, 6)])
        # idx2: trur rma2 over tr[1..2] = 0 -> na ; idx3: tr 2, +DM 2 -> rma: tr 1, +DM 1 -> 100
        close_list(self, I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'DMI', 'params': {'period': 2}}),
                   [nan, nan, nan, 100])
        self.assertEqual(I._fixnan([nan, 1, nan, nan, 2, nan])[1:], [1, 1, 1, 2, 2])

    def test_highest_lowest(self):
        b = bars_from([(1, 1, 1, 1), (5, 5, 5, 5), (3, 3, 3, 3), (2, 2, 2, 2), (4, 4, 4, 4)])
        close_list(self, I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'HIGHEST', 'params': {'period': 2}}),
                   [nan, nan, 5, 5, 3])   # previous 2 values, current excluded
        close_list(self, I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'LOWEST', 'params': {'period': 2}}),
                   [nan, nan, 1, 3, 2])

    def test_roc(self):
        close_list(self, I.roc([10, 0, 12, 15], 2), [nan, nan, 20, nan])     # x[n] == 0 -> na
        close_list(self, I.roc([10, 0, 12, 15], 1), [nan, -100, nan, 25])

    def test_ma_and_multiplier(self):
        # RSI(2) of 10,11,10,12,13 = na,na,50,83.33,90 ; SMA2 of that = na,na,na,66.67,86.67
        b = bars_from([(v, v, v, v) for v in [10, 11, 10, 12, 13]])
        op = {'kind': 'INDICATOR', 'indicator': 'RSI', 'params': {'period': 2}, 'ma': {'type': 'SMA', 'period': 2}}
        r = 100 - 100 / 6
        close_list(self, I.operand_column(b, op), [nan, nan, nan, (50 + r) / 2, (r + 90) / 2])
        # multiplier after ma: SMA2(close)=na,10.5,10.5,11,12.5 ; ma SMA2 = na,na,10.5,10.75,11.75 ; x10
        op = {'kind': 'INDICATOR', 'indicator': 'SMA', 'params': {'period': 2}, 'ma': {'type': 'SMA', 'period': 2},
              'multiplier': 10}
        close_list(self, I.operand_column(b, op), [nan, nan, 105, 107.5, 117.5])
        # WMA as ma
        op = {'kind': 'INDICATOR', 'indicator': 'SMA', 'params': {'period': 2}, 'ma': {'type': 'WMA', 'period': 2}}
        close_list(self, I.operand_column(b, op), [nan, nan, 10.5, (10.5 + 2 * 11) / 3, (11 + 2 * 12.5) / 3])

    def test_na_ignored_mid_series(self):
        close_list(self, I.sma([1, nan, 3, 5], 2), [nan, nan, 2, 4])
        close_list(self, I.sma([1, nan, 2, 3, nan, 4], 2), [nan, nan, 1.5, 2.5, nan, 3.5])
        # EMA over a line with leading na (like MACD): seeds on first 3 defined values
        close_list(self, I.ema([nan, nan, 2, 4, 6, 10], 3), [nan, nan, nan, nan, 4, 7])
        close_list(self, I.wma([1, nan, 2, 3], 2), [nan, nan, 5 / 3, 8 / 3])

    def test_defaults_and_price(self):
        b = bars_from([(i, i + 1, i - 1, i, 100 + i) for i in range(1, 31)])
        self.assertEqual(I.operand_column(b, {'kind': 'PRICE', 'field': 'volume'})[0], 1101)
        sma = I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'SMA'})
        self.assertTrue(sma[18] != sma[18])
        self.assertAlmostEqual(sma[19], 10.5)              # default period 20, source close
        hi = I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'HIGHEST'})
        self.assertAlmostEqual(hi[20], 21)                 # default source high, previous 20 bars: 2..21
        bbu = I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'BB'})
        bbm = I.operand_column(b, {'kind': 'INDICATOR', 'indicator': 'BB', 'output': 'mid'})
        self.assertGreater(bbu[25], bbm[25])               # default output = upper


# =============================================================================================
class TestWeekly(unittest.TestCase):

    def test_weekly_build(self):
        dates = ['2025-12-29', '2025-12-30', '2026-01-02',                 # year-crossing week (Thu 1st holiday)
                 '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08',   # Friday 9th holiday -> ends Thursday
                 '2026-01-12', '2026-01-13']                               # last week, partial
        rows = [(10, 12, 9, 11, 1), (11, 13, 10, 12, 2), (12, 12, 8, 9, 3),
                (9, 10, 7, 8, 4), (8, 15, 8, 14, 5), (14, 14, 13, 13, 6), (13, 16, 12, 15, 7),
                (15, 15, 14, 14, 8), (14, 17, 14, 16, 9)]
        b = bars_from(rows, dates)
        w = build_weekly(b, '2026-01-13')
        self.assertEqual(w['date'], ['2026-01-02', '2026-01-08', '2026-01-13'])
        self.assertEqual(w['open'], [10, 9, 15])
        self.assertEqual(w['high'], [13, 16, 17])
        self.assertEqual(w['low'], [8, 7, 14])
        self.assertEqual(w['close'], [9, 15, 16])
        self.assertEqual(w['volume'], [3006, 4022, 2017])   # (1+2+3)+3000, (4+..+7)+4000, (8+9)+2000
        self.assertEqual(w['lastIdx'], [2, 6, 8])
        self.assertEqual(w['complete'], [True, True, False])
        self.assertEqual(build_weekly(b, '2026-01-15')['complete'][-1], False)
        self.assertEqual(build_weekly(b, '2026-01-16')['complete'][-1], True)    # Friday of that week
        # last week cut short by a holiday: data ends Thursday 2026-01-08
        b2 = bars_from(rows[:7], dates[:7])
        self.assertEqual(build_weekly(b2, '2026-01-08')['complete'], [True, False])
        self.assertEqual(build_weekly(b2, '2026-01-09')['complete'], [True, True])

    def test_weekly_checks(self):
        dates = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-12', '2026-01-13']
        b = bars_from([(1, 1, 1, 1)] * 6, dates)
        s = StrategySeries('X', b, '1w', '2026-01-13', {})
        self.assertEqual(s.k_of_daily, [-1, -1, -1, 0, -1, -1])
        self.assertEqual(s.n_checks, 1)
        s = StrategySeries('X', b, '1w', '2026-01-16', {})
        self.assertEqual(s.k_of_daily, [-1, -1, -1, 0, -1, 1])


# =============================================================================================
def C(left, op, right, cid='c'):
    return {'type': 'CONDITION', 'id': cid, 'left': left, 'op': op, 'right': right}


def P(field, barsAgo=None):
    d = {'kind': 'PRICE', 'field': field}
    if barsAgo is not None:
        d['barsAgo'] = barsAgo
    return d


def N(v):
    return {'kind': 'NUMBER', 'value': v}


def G(t, *kids):
    return {'type': t, 'id': 'g', 'children': list(kids)}


VOL_ENTRY = C(P('volume'), 'GTE', N(1001))   # volume column used as a signal channel (offset 1000)
VOL_EXIT = C(P('volume'), 'LTE', N(999))


def strat(entry, exit_cond=None, trigger='WHEN_TRUE', tf='1d', tgt=None, sl=None, ts=None, base='AVERAGE',
          max_bars=None, pyr=None, sizing=('QUANTITY', 1)):
    return {'name': 't', 'timeframe': tf,
            'entry': {'when': G('AND', entry), 'trigger': trigger},
            'exit': {'targetPct': tgt, 'stopLossPct': sl, 'trailingStopPct': ts, 'priceBase': base,
                     'when': G('OR', exit_cond) if exit_cond else None, 'maxBars': max_bars},
            'pyramid': pyr or {'enabled': False, 'maType': 'SMA', 'maPeriod': 20, 'maxAdds': None},
            'sizing': {'mode': sizing[0], 'value': sizing[1]}}


def rules(fill='NEXT_OPEN', trig='TOUCH', charges=False, slip=0):
    return {'fill': fill, 'stopTrigger': trig, 'charges': charges, 'slippagePct': slip}


def run(defn, stocks, frm=None, to=None, capital=100000, maxpos=None, end=None, rl=None):
    alld = sorted({d for _, b in stocks for d in b['date']})
    return simulate(defn, stocks, frm or alld[0], to or alld[-1], capital, maxpos, end or alld[-1],
                    rl or rules())


class TestEvaluate(unittest.TestCase):

    def test_tristate_groups(self):
        b = bars_from([(1, 1, 1, 1, 0)] * 3)
        s = StrategySeries('X', b, '1d', b['date'][-1], {})
        T = C(N(2), 'GT', N(1))
        F = C(N(1), 'GT', N(2))
        U = C(P('close', barsAgo=5), 'GT', N(1))
        self.assertIs(s.compile_group(G('AND', T, U))(1), None)
        self.assertIs(s.compile_group(G('AND', F, U))(1), False)
        self.assertIs(s.compile_group(G('AND', T, T))(1), True)
        self.assertIs(s.compile_group(G('AND'))(1), None)
        self.assertIs(s.compile_group(G('OR', T, U))(1), True)
        self.assertIs(s.compile_group(G('OR', F, U))(1), None)
        self.assertIs(s.compile_group(G('OR', F, F))(1), False)
        self.assertIs(s.compile_group(G('OR'))(1), None)
        self.assertIs(s.compile_group(G('AND', G('OR', F, T), C(N(1), 'GTE', N(1)), C(N(1), 'LTE', N(1))))(1), True)

    def test_tolerant_comparisons(self):
        from evaluate import gt, gte, lt, lte
        a, b = 1.0 + 1e-12, 1.0                       # tie within 1e-9 * max(1,|a|,|b|)
        self.assertEqual((gt(a, b), gte(a, b), lt(a, b), lte(a, b)), (False, True, False, True))
        self.assertEqual((gt(b, a), gte(b, a), lt(b, a), lte(b, a)), (False, True, False, True))
        a, b = 1e6 + 1e-4, 1e6                        # tol = 1e-3 at this scale -> still a tie
        self.assertEqual((gt(a, b), lt(b, a), gte(b, a), lte(a, b)), (False, False, True, True))
        a, b = 1.0 + 2e-9, 1.0                        # beyond tol -> strict
        self.assertEqual((gt(a, b), gte(a, b), lt(a, b), lte(a, b)), (True, True, False, False))
        # condition level: a line equal to its threshold up to the last digits
        x = [50.0, 50.0 + 1e-13, 50.0 - 1e-13, 50.0 + 1e-13]
        b2 = bars_from([(v, v, v, v) for v in x])
        s = StrategySeries('X', b2, '1d', b2['date'][-1], {})
        ca = s.compile_group(C(P('close'), 'CROSSES_ABOVE', N(50)))
        gt_ = s.compile_group(C(P('close'), 'GT', N(50)))
        lte_ = s.compile_group(C(P('close'), 'LTE', N(50)))
        self.assertEqual([ca(k) for k in range(4)], [None, False, False, False])
        self.assertEqual([gt_(k) for k in range(4)], [False] * 4)
        self.assertEqual([lte_(k) for k in range(4)], [True] * 4)
        # a real cross after a near-tie still fires (prev 50+1e-13 counts as <= 50)
        b3 = bars_from([(v, v, v, v) for v in [50.0 + 1e-13, 51.0]])
        s3 = StrategySeries('X', b3, '1d', b3['date'][-1], {})
        self.assertIs(s3.compile_group(C(P('close'), 'CROSSES_ABOVE', N(50)))(1), True)
        # flat stock: RSI is constant 100 and equals its own SMA up to float noise -> no cross either way
        flat = bars_from([(7, 7, 7, 7)] * 40)
        s4 = StrategySeries('X', flat, '1d', flat['date'][-1], {})
        rsi = {'kind': 'INDICATOR', 'indicator': 'RSI', 'params': {'period': 14}}
        rsi_ma = dict(rsi, ma={'type': 'SMA', 'period': 5})
        up = s4.compile_group(C(rsi, 'CROSSES_ABOVE', rsi_ma))
        eq = s4.compile_group(C(rsi, 'GTE', rsi_ma))
        self.assertTrue(all(up(k) is not True for k in range(40)))
        self.assertIs(eq(30), True)

    def test_crosses_and_barsago(self):
        b = bars_from([(v, v, v, v) for v in [5, 10, 10, 12, 9]])
        s = StrategySeries('X', b, '1d', b['date'][-1], {})
        ca = s.compile_group(C(P('close'), 'CROSSES_ABOVE', N(10)))
        cb = s.compile_group(C(P('close'), 'CROSSES_BELOW', N(10)))
        self.assertEqual([ca(k) for k in range(5)], [None, False, False, True, False])  # 10 is not > 10
        self.assertEqual([cb(k) for k in range(5)], [None, False, False, False, True])
        lag = s.compile_group(C(P('close', barsAgo=1), 'CROSSES_ABOVE', N(10)))
        self.assertEqual([lag(k) for k in range(5)], [None, None, False, False, True])


class TestSimulation(unittest.TestCase):

    def test_charges_and_round2(self):
        self.assertEqual(round2(1.005), 1.0)          # 100.49999999999999 -> 100
        self.assertEqual(round2(0.125), 0.13)
        self.assertEqual(round2(-0.125), -0.12)       # half toward +inf
        self.assertEqual(round2(-0.001), 0.0)
        # v2 DELIVERY (exchange 0.00307%), value 10000:
        #   BUY  = 10 + .307 + .01 + 1.5 + .18*.317 (.05706) = 11.87406 -> 11.87
        #   SELL = 10 + .307 + .01 + 15.34 + .05706 = 25.71406 -> 25.71
        # v2 INTRADAY, value 10000: brokerage min(3, 20) = 3 ; GST .18*(3+.307+.01) = .59706
        #   BUY  = 3 + .307 + .01 + .3 (stamp .003%) + .59706 = 4.21406 -> 4.21
        #   SELL = 3 + 2.5 (STT .025%) + .307 + .01 + .59706 = 6.41406 -> 6.41
        # INTRADAY BUY 100000: brokerage capped at 20 ; 20 + 3.07 + .1 + 3 + .18*23.17 (4.1706) = 30.3406 -> 30.34
        from simulate import delivery_charges, intraday_charges
        self.assertEqual(delivery_charges('BUY', 10000), 11.87)
        self.assertEqual(delivery_charges('SELL', 10000), 25.71)
        self.assertEqual(intraday_charges('BUY', 10000), 4.21)
        self.assertEqual(intraday_charges('SELL', 10000), 6.41)
        self.assertEqual(intraday_charges('BUY', 100000), 30.34)
        # buy 13753.74: 13.75374 + .4222398 + .0137537 + 2.063061 + .0784788 = 16.3313 -> 16.33
        self.assertEqual(order_charges('BUY', 13753.74, True), 16.33)
        self.assertEqual(order_charges('SELL', 13361.62, False), 0)

    CROSS_ROWS = [(99, 100, 98, 99), (99, 102, 98, 101), (102, 104, 101, 103), (103, 103, 99, 99.5),
                  (98, 99, 97, 98)]

    def test_cross_entry_exit_next_open(self):
        d = strat(C(P('close'), 'CROSSES_ABOVE', N(100)), C(P('close'), 'CROSSES_BELOW', N(100)),
                  sizing=('QUANTITY', 10))
        b = bars_from(self.CROSS_ROWS)
        r = run(d, [('AAA', b)], rl=rules(charges=True, slip=0.1))
        self.assertEqual(len(r['trades']), 1)
        t = r['trades'][0]
        D = b['date']
        # v2: buy d2 open ceil2(102*1.001 = 102.102) = 102.11 x10 = 1021.1 ;
        #     charges 1.0211 + .0313478 + .0010211 + .153165 + .0058264 = 1.21246 -> 1.21
        #     sell d4 open floor2(98*0.999 = 97.902) = 97.90 x10 = 979.0 ;
        #     charges .979 + .0300553 + .000979 + 15.34 + .0055862 = 16.3556205 -> 16.36
        self.assertEqual((t['entryDate'], t['exitDate'], t['exitReason']), (D[2], D[4], 'EXIT_RULE'))
        self.assertEqual([f['price'] for f in t['fills']], [102.11, 97.9])
        self.assertEqual([f['charges'] for f in t['fills']], [1.21, 16.36])
        self.assertEqual([f['signalDate'] for f in t['fills']], [D[1], D[3]])
        # gross 979 - 1021.1 = -42.1 ; charges 17.57 ; net -59.67 ; return -59.67/1021.1 = -5.8437%
        self.assertEqual((t['avgPrice'], t['exitPrice'], t['invested'], t['grossPnl'], t['charges'], t['netPnl'],
                          t['returnPct'], t['holdingDays'], t['quantity']),
                         (102.11, 97.9, 1021.1, -42.1, 17.57, -59.67, -5.84, 2, 10))
        # curve: d2 = 100000-1021.1-1.21 + 10*103 = 100007.69 ; d3 = 98977.69+995 ; last = cash
        #        = 98977.69 + 979 - 16.36 = 99940.33
        self.assertEqual([p['equity'] for p in r['curve']], [100000, 100000, 100007.69, 99972.69, 99940.33])

    def test_fill_at_close(self):
        d = strat(C(P('close'), 'CROSSES_ABOVE', N(100)), C(P('close'), 'CROSSES_BELOW', N(100)),
                  sizing=('QUANTITY', 10))
        b = bars_from(self.CROSS_ROWS)
        r = run(d, [('AAA', b)], rl=rules(fill='CLOSE', slip=2))
        t = r['trades'][0]
        D = b['date']
        # buy d1 close 101*1.02 = 103.02 ; sell d3 close 99.5*.98 = 97.51 ; gross 975.1 - 1030.2 = -55.1
        self.assertEqual((t['entryDate'], t['exitDate']), (D[1], D[3]))
        self.assertEqual([f['price'] for f in t['fills']], [103.02, 97.51])
        self.assertEqual([f['signalDate'] for f in t['fills']], [D[1], D[3]])
        self.assertEqual(t['grossPnl'], -55.1)

    def _entry_then(self, day2, sl=None, tgt=None, ts=None, slip=0, trig='TOUCH', extra=()):
        # d0 signal ; d1 buy at open 100 ; d2.. per test
        rows = [(100, 100, 100, 100, 1), (100, 100, 99, 100, 0), day2] + list(extra)
        b = bars_from(rows)
        d = strat(VOL_ENTRY, sl=sl, tgt=tgt, ts=ts)
        r = run(d, [('AAA', b)], rl=rules(slip=slip, trig=trig))
        return r, b['date']

    def test_stop_loss_gap_and_touch(self):
        r, D = self._entry_then((94, 96, 93, 95, 0), sl=5)
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice']), (D[2], 'STOP_LOSS', 94))   # gap: at open
        r, D = self._entry_then((97, 98, 94, 96, 0), sl=5)
        self.assertEqual((r['trades'][0]['exitReason'], r['trades'][0]['exitPrice']), ('STOP_LOSS', 95))  # touch
        # with 1% slippage: buy 101, stop 95.95 ; gap sell 94*.99 = 93.06 ; touch sell 95.95*.99 = 94.9905
        r, D = self._entry_then((94, 96, 93, 95, 0), sl=5, slip=1)
        self.assertEqual(r['trades'][0]['exitPrice'], 93.06)
        r, D = self._entry_then((97, 98, 94, 96, 0), sl=5, slip=1)
        self.assertEqual(r['trades'][0]['exitPrice'], 94.99)
        self.assertEqual(r['trades'][0]['fills'][0]['stopAfter'], 95.95)

    def test_target_gap_and_touch(self):
        r, D = self._entry_then((112, 113, 111, 112, 0), tgt=10, slip=1)   # buy 101, target 111.1 ; gap -> open
        t = r['trades'][0]
        self.assertEqual((t['exitReason'], t['exitPrice']), ('TARGET', 112))
        r, D = self._entry_then((105, 112, 104, 106, 0), tgt=10, slip=1)   # touch -> 111.1, no slippage
        self.assertEqual((r['trades'][0]['exitReason'], r['trades'][0]['exitPrice']), ('TARGET', 111.1))

    def test_stop_and_target_same_day(self):
        r, D = self._entry_then((100, 115, 90, 100, 0), sl=5, tgt=10)
        self.assertEqual((r['trades'][0]['exitReason'], r['trades'][0]['exitPrice']), ('STOP_LOSS', 95))

    def test_trailing_stop(self):
        # d1 high 100 -> hw 100 ; d2 high 120 (stop 95 untouched, low 105) -> hw 120 ; d3 low 107 <= 108
        r, D = self._entry_then((106, 120, 105, 118, 0), sl=5, ts=10, extra=[(110, 111, 107, 109, 0)])
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice']), (D[3], 'TRAILING_STOP', 108))
        # exact tie stop-loss 10% == trailing 10% at entry (hw = first fill) -> later in order wins
        r, D = self._entry_then((100, 100, 89, 95, 0), sl=10, ts=10)
        t = r['trades'][0]
        self.assertEqual((t['exitReason'], t['exitPrice']), ('TRAILING_STOP', 90))

    def test_stop_trigger_close(self):
        # CLOSE trigger: d2 low 90 under stop 95 but close 96 -> nothing ; d3 close 94 -> pending -> d4 open 93
        r, D = self._entry_then((97, 98, 90, 96, 0), sl=5, trig='CLOSE',
                                extra=[(96, 97, 93, 94, 0), (93, 94, 92, 93, 0)])
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice'], t['fills'][-1]['signalDate']),
                         (D[4], 'STOP_LOSS', 93, D[3]))

    PYR_ROWS = [(100, 100, 100, 100, 0),            # before `from`
                (100, 100, 100, 100, 1),            # d0 signal (MA2=100)
                (100, 102, 99, 102, 0),             # d1 buy 100 ; MA 101 >= 100, close >= MA -> ADD due (stop 101)
                (103, 106, 102, 106, 0),            # d2 ADD @103 stop 101 ; MA 104 >= 103 -> ADD due (stop 104)
                (107, 110, 106, 110, 0),            # d3 ADD @107 stop 104 ; MA 108 >= 107 (maxAdds 2 -> not due)
                (109, 109, 103, 104, 0)]            # d4 low 103 <= 104 -> PYRAMID_STOP @104

    def test_pyramiding(self):
        b = bars_from(self.PYR_ROWS)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': 2}
        r = run(strat(VOL_ENTRY, pyr=pyr), [('AAA', b)], frm=D[1])
        t = r['trades'][0]
        self.assertEqual([(f['date'], f['kind'], f['price'], f['stopAfter']) for f in t['fills']],
                         [(D[2], 'ENTRY', 100, None), (D[3], 'ADD', 103, 101), (D[4], 'ADD', 107, 104),
                          (D[5], 'EXIT', 104, None)])
        self.assertEqual((t['exitReason'], t['quantity'], t['adds'], t['avgPrice'], t['grossPnl']),
                         ('PYRAMID_STOP', 3, 2, 103.33, 2))
        # no cap: 3rd add due at d3 (stop 108) -> d4 buys at open 109 then low 103 <= 108 -> sold at 108
        pyr['maxAdds'] = None
        r = run(strat(VOL_ENTRY, pyr=pyr), [('AAA', b)], frm=D[1])
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['quantity'], t['adds'], t['exitPrice']),
                         (D[5], 'PYRAMID_STOP', 4, 3, 108))
        self.assertEqual(t['fills'][3]['stopAfter'], 108)

    def test_pyramid_not_due_when_ma_below_last_buy(self):
        rows = [(100, 100, 100, 100, 0), (100, 100, 100, 100, 1), (105, 106, 99, 104, 0), (104, 105, 103, 104, 0)]
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': None}
        r = run(strat(VOL_ENTRY, pyr=pyr), [('AAA', b)], frm=D[1])
        # buy @105 on d2; MA d2 = 102 < 105, d3 MA = 104 < 105 -> no adds ; END at d3 close
        t = r['trades'][0]
        self.assertEqual((t['adds'], t['exitReason'], t['exitPrice'], t['exitDate']), (0, 'END', 104, D[3]))

    def test_time_exit(self):
        rows = [(100, 100, 100, 100, 1)] + [(100 + i, 101 + i, 99 + i, 100 + i, 0) for i in range(1, 6)]
        b = bars_from(rows)
        D = b['date']
        r = run(strat(VOL_ENTRY, max_bars=2), [('AAA', b)])
        t = r['trades'][0]
        # signal k0 ; buy d1 ; check k2: 2-0 >= 2 -> pending ; sell d3 open 103
        self.assertEqual((t['entryDate'], t['exitDate'], t['exitReason'], t['exitPrice']), (D[1], D[3], 'TIME', 103))

    def test_cash_shortage_skip(self):
        rows_a = [(100, 100, 100, 100, 1)] * 5
        vol_b = [1, 1, 0, 1, 1]
        rows_b = [(100, 100, 100, 100, v) for v in vol_b]
        a, bb = bars_from(rows_a), bars_from(rows_b)
        D = a['date']
        r = run(strat(VOL_ENTRY), [('BBB', bb), ('AAA', a)], capital=150)
        # AAA buys d1 (cash 50); BBB fails d1 (cash) and d2 (same category -> not recorded);
        # d2 has no BBB signal -> marker reset ; d3 signal -> d4 fails again -> recorded ;
        # d4 also signals -> pending ENTRY at the end -> 'end' skip dated d4
        self.assertEqual(r['skipped'], [{'symbol': 'BBB', 'date': D[1], 'kind': 'ENTRY', 'category': 'cash'},
                                        {'symbol': 'BBB', 'date': D[4], 'kind': 'ENTRY', 'category': 'cash'},
                                        {'symbol': 'BBB', 'date': D[4], 'kind': 'ENTRY', 'category': 'end'}])
        self.assertEqual([t['symbol'] for t in r['trades']], ['AAA'])

    def test_max_positions_incl_pending(self):
        a = bars_from([(100, 100, 100, 100, 1)] * 3)
        b = bars_from([(50, 50, 50, 50, 1)] * 3)
        D = a['date']
        r = run(strat(VOL_ENTRY), [('BBB', b), ('AAA', a)], maxpos=1)
        # d0: AAA pending ; BBB: 0 held + 1 pending >= 1 -> skip max ; later repeats deduped
        self.assertEqual(r['skipped'], [{'symbol': 'BBB', 'date': D[0], 'kind': 'ENTRY', 'category': 'max'}])
        self.assertEqual([t['symbol'] for t in r['trades']], ['AAA'])
        # fill at close: AAA buys at d0 close ; BBB buy -> holding 1 >= 1 -> skip max
        r = run(strat(VOL_ENTRY), [('BBB', b), ('AAA', a)], maxpos=1, rl=rules(fill='CLOSE'))
        self.assertEqual(r['skipped'], [{'symbol': 'BBB', 'date': D[0], 'kind': 'ENTRY', 'category': 'max'}])

    def test_end_handling(self):
        # pending EXIT at the end -> sold at last close, its reason/signal date, no slippage
        rows = [(100, 100, 100, 100, 1), (101, 102, 100, 101, 0), (102, 103, 101, 102, -1)]
        b = bars_from(rows)
        D = b['date']
        r = run(strat(VOL_ENTRY, VOL_EXIT), [('AAA', b)], rl=rules(slip=1))
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice'], t['fills'][-1]['signalDate']),
                         (D[2], 'EXIT_RULE', 102, D[2]))
        self.assertEqual(r['curve'][-1]['equity'], 99999.99)      # 100000 - 102.01 + 102
        # CCC's data ends at d2 -> its END sale is dated d2 at its own last close; AAA's at d3
        a = bars_from([(100, 100, 100, 100, 1)] * 4)
        c = bars_from([(10, 10, 10, 10, 0), (10, 10, 10, 10, 1), (11, 11.5, 10.5, 11, 0)])
        D = a['date']
        r = run(strat(VOL_ENTRY), [('AAA', a), ('CCC', c)], to=D[3])
        self.assertEqual([(t['symbol'], t['exitDate'], t['exitReason'], t['exitPrice']) for t in r['trades']],
                         [('AAA', D[3], 'END', 100), ('CCC', D[2], 'END', 11)])
        self.assertEqual(r['curve'][-1]['equity'], 100000)
        r = run(strat(VOL_ENTRY), [('AAA', a), ('CCC', c)], to=D[2])
        self.assertEqual([(t['symbol'], t['exitDate'], t['exitReason']) for t in r['trades']],
                         [('AAA', D[2], 'END'), ('CCC', D[2], 'END')])
        self.assertEqual(r['skipped'], [])
        # pending ENTRY at the last check -> skip category "end" dated with the signal date
        r = run(strat(VOL_ENTRY), [('CCC', c)], to=D[1])
        self.assertEqual(r['trades'], [])
        self.assertEqual(r['skipped'], [{'symbol': 'CCC', 'date': D[1], 'kind': 'ENTRY', 'category': 'end'}])
        self.assertEqual(len(r['curve']), 2)

    def test_becomes_true_vs_when_true(self):
        vols = [0, 1, 1, 1, 0, 1]
        b = bars_from([(100, 100, 100, 100, v) for v in vols])
        D = b['date']
        # fill CLOSE + maxBars 1: TIME exit fills at the close -> soldAtClose blocks that day's entry
        r = run(strat(VOL_ENTRY, max_bars=1), [('AAA', b)], rl=rules(fill='CLOSE'))
        self.assertEqual([(t['entryDate'], t['exitReason']) for t in r['trades']],
                         [(D[1], 'TIME'), (D[3], 'TIME'), (D[5], 'END')])
        r = run(strat(VOL_ENTRY, max_bars=1, trigger='BECOMES_TRUE'), [('AAA', b)], rl=rules(fill='CLOSE'))
        self.assertEqual([(t['entryDate'], t['exitReason']) for t in r['trades']], [(D[1], 'TIME'), (D[5], 'END')])

    def test_reentry_same_day_after_open_or_intraday_exit(self):
        # NEXT_OPEN: pending EXIT fills at d2 open ; d2 close has an entry signal -> new pending ENTRY -> d3 buy
        rows = [(100, 100, 100, 100, 1), (101, 102, 100, 101, -1), (102, 103, 101, 102, 1), (103, 104, 102, 103, 0)]
        b = bars_from(rows)
        D = b['date']
        r = run(strat(VOL_ENTRY, VOL_EXIT), [('AAA', b)])
        self.assertEqual([(t['entryDate'], t['exitDate'], t['exitReason']) for t in r['trades']],
                         [(D[1], D[2], 'EXIT_RULE'), (D[3], D[3], 'END')])
        # intraday stop in step 2 (d2 low 90 <= 95) and a signal at d2's close -> re-entry d3
        rows = [(100, 100, 100, 100, 1), (100, 100, 100, 100, 0), (99, 99, 90, 92, 1), (93, 94, 92, 93, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, sl=5), [('AAA', b)])
        self.assertEqual([(t['entryDate'], t['exitDate'], t['exitReason']) for t in r['trades']],
                         [(D[1], D[2], 'STOP_LOSS'), (D[3], D[3], 'END')])
        # fill CLOSE: intraday stop d1 then signal at d1's close -> buys again at d1 close
        rows = [(100, 100, 100, 100, 1), (99, 99, 90, 92, 1), (93, 94, 92, 93, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, sl=5), [('AAA', b)], rl=rules(fill='CLOSE'))
        self.assertEqual([(t['entryDate'], t['exitDate'], t['exitReason'], t['avgPrice']) for t in r['trades']],
                         [(D[0], D[1], 'STOP_LOSS', 100), (D[1], D[2], 'END', 92)])
        # fill CLOSE: a 3a exit filled at the close blocks the same-day entry (soldAtClose)
        rows = [(100, 100, 100, 100, 1), (100, 100, 100, 100, 0), (100, 100, 100, 100, -1)]
        b = bars_from(rows)
        d = strat(VOL_ENTRY, VOL_EXIT)
        d['entry']['when'] = {'type': 'OR', 'id': 'o', 'children': [VOL_ENTRY, VOL_EXIT]}  # TRUE on exit day too
        r = run(d, [('AAA', b)], rl=rules(fill='CLOSE'))
        self.assertEqual([(t['entryDate'], t['exitDate'], t['exitReason']) for t in r['trades']],
                         [(D[0], D[2], 'EXIT_RULE')])

    def test_percent_sizing(self):
        a = bars_from([(90, 90, 90, 90, 1), (100, 101, 99, 100, 0)])
        b = bars_from([(50, 50, 50, 50, 1), (50, 50, 50, 50, 0)])
        r = run(strat(VOL_ENTRY, sizing=('PERCENT', 50)), [('AAA', a), ('BBB', b)], capital=10000)
        # AAA: floor(5000/100) = 50 -> cash 5000 ; BBB: equity = 5000 + 50*90 (AAA lastClose) = 9500 -> 4750/50 = 95
        self.assertEqual([(t['symbol'], t['quantity']) for t in r['trades']], [('AAA', 50), ('BBB', 95)])
        r = run(strat(VOL_ENTRY, sizing=('PERCENT', 50)), [('AAA', a)], capital=10000, rl=rules(slip=1))
        self.assertEqual(r['trades'][0]['quantity'], 49)            # floor(5000/101)
        r = run(strat(VOL_ENTRY, sizing=('AMOUNT', 1000)), [('AAA', a)], capital=10000, rl=rules(slip=1))
        self.assertEqual(r['trades'][0]['quantity'], 9)             # floor(1000/101)

    def test_capital_null(self):
        a = bars_from([(100, 100, 100, 100, 1), (100, 100, 100, 100, 0), (100, 105, 100, 103, 0)])
        r = run(strat(VOL_ENTRY, sizing=('QUANTITY', 10)), [('AAA', a)], capital=None)
        self.assertEqual([p['equity'] for p in r['curve']], [0, 0, 30])   # cash -1000 + 10*100 ; last = cash
        t = r['trades'][0]
        self.assertEqual((t['quantity'], t['netPnl']), (10, 30))
        r = run(strat(VOL_ENTRY, sizing=('PERCENT', 10)), [('AAA', a)], capital=None)
        self.assertEqual(r['trades'], [])                                   # equity 0 -> 0 shares
        self.assertEqual(r['skipped'][0]['category'], 'size')

    def test_weekly_simulation(self):
        # week 1 Mon-Fri, week 2 ends Thursday (Fri holiday), week 3 partial (incomplete)
        dates = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
                 '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15',
                 '2026-01-19', '2026-01-20']
        closes = [90, 91, 92, 93, 94, 95, 99, 104, 105, 106, 107]
        b = bars_from([(c, c + 0.5, c - 0.5, c) for c in closes], dates)
        d = strat(C(P('close'), 'GT', N(100)), tf='1w')
        r = run(d, [('AAA', b)], end='2026-01-20')
        t = r['trades'][0]
        # check k1 at Thu 2026-01-15 (weekly close 105 > 100) -> pending -> Monday open 106
        self.assertEqual((t['entryDate'], t['fills'][0]['signalDate'], t['fills'][0]['price'], t['exitReason']),
                         ('2026-01-19', '2026-01-15', 106, 'END'))


class TestV2(unittest.TestCase):
    """One hand-worked test (or more) per SPEC v2 rule."""

    # ---- rule 1: candle repair on load -------------------------------------------------------
    def test_repair_on_load(self):
        from evaluate import daily_bars
        raw = {'date': ['2026-01-05', '2026-01-06', '2026-01-07'],
               'open': [105, 98, 100], 'high': [104, 101, 99], 'low': [100, 99, 101], 'close': [103, 100, 100],
               'volume': [1, 2, 3]}
        b = daily_bars(raw)
        # row0 open 105 above high 104 -> high 105 ; row1 open 98 below low 99 -> low 98 ;
        # row2 high 99 < low 101 (bad tick) -> high = max(100,99,101,100) = 101, low = min(...) = 99
        self.assertEqual(list(b['high']), [105, 101, 101])
        self.assertEqual(list(b['low']), [100, 98, 99])
        self.assertEqual(list(b['open']), [105, 98, 100])
        self.assertEqual(list(b['close']), [103, 100, 100])

    # ---- rule 2: charges -- intraday re-charge -----------------------------------------------
    def test_intraday_whole_position(self):
        # d0 signal ; d1 buy 100 @ open 100 (DELIVERY 11.87) ; same day low 94 <= stop 95 -> sold at 95
        # re-charge: INTRADAY(BUY, 10000) = 4.21 (cash += 7.66) ; sale INTRADAY(SELL, 9500):
        #   2.85 + 2.375 + .29165 + .0095 + .18*3.15115 (.567207) = 6.093357 -> 6.09
        rows = [(100, 100, 100, 100, 1), (100, 101, 94, 96, 0)]
        b = bars_from(rows)
        D = b['date']
        r = run(strat(VOL_ENTRY, sl=5, sizing=('QUANTITY', 100)), [('AAA', b)], rl=rules(charges=True))
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice']), (D[1], 'STOP_LOSS', 95))
        self.assertEqual([f['charges'] for f in t['fills']], [4.21, 6.09])
        self.assertEqual((t['charges'], t['netPnl']), (10.3, -510.3))
        # cash: 100000 - 10000 - 11.87 + 7.66 + 9500 - 6.09 = 99489.70
        self.assertEqual(r['curve'][-1]['equity'], 99489.7)

    def test_intraday_partial(self):
        # PYR rows, but d3's low is 100: ENTRY 100x100 on d2 (DELIVERY 11.87), ADD 100x103 at d3 open
        # (DELIVERY 12.23), then d3 low 100 <= pyramid stop 101 -> sell 200 @ floor2(101) = 101 the same day.
        # todayQty = 100 (the ADD): ADD re-charged INTRADAY(BUY, 10300) =
        #   3.09 + .31621 + .0103 + .309 + .18*3.41651 (.6149718) = 4.34048 -> 4.34
        # sale = round2(INTRADAY(SELL, 10100) + DELIVERY(SELL, 10100))
        #   INTRADAY: 3.03 + 2.525 + .31007 + .0101 + .18*3.35017 (.6030306) = 6.4782 -> 6.48
        #   DELIVERY: 10.1 + .31007 + .0101 + 15.34 + .18*.32017 (.0576306) = 25.8178 -> 25.82  => 32.30
        rows = list(self._pyr_rows())
        rows[3] = (103, 106, 100, 106, 0)
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': 2}
        r = run(strat(VOL_ENTRY, pyr=pyr, sizing=('QUANTITY', 100)), [('AAA', b)], frm=D[1], rl=rules(charges=True))
        t = r['trades'][0]
        self.assertEqual([(f['date'], f['kind'], f['price'], f['charges']) for f in t['fills']],
                         [(D[2], 'ENTRY', 100, 11.87), (D[3], 'ADD', 103, 4.34), (D[3], 'EXIT', 101, 32.3)])
        # charges 11.87 + 4.34 + 32.30 = 48.51 ; gross 20200 - 20300 = -100 ; net -148.51
        self.assertEqual((t['exitReason'], t['quantity'], t['charges'], t['netPnl']),
                         ('PYRAMID_STOP', 200, 48.51, -148.51))
        self.assertEqual(r['curve'][-1]['equity'], 99851.49)       # 100000 - 148.51

    @staticmethod
    def _pyr_rows():
        return TestSimulation.PYR_ROWS

    # ---- rule 3: whole paise -------------------------------------------------------------------
    def test_ceil2_floor2(self):
        from simulate import ceil2, floor2
        self.assertEqual(ceil2(288.3), 288.3)          # 28830.000000000004 -> -1e-6 keeps it at 28830
        self.assertEqual(floor2(0.29), 0.29)           # 28.999999999999996 -> +1e-6 keeps it at 29
        self.assertEqual(ceil2(100.333), 100.34)
        self.assertEqual(floor2(99.667), 99.66)
        self.assertEqual(ceil2(102.102), 102.11)

    def test_whole_paise_fills_and_target(self):
        # slip 0.333%: buy ceil2(100*1.00333 = 100.333) = 100.34 ; target 7% = ceil2(107.3638) = 107.37
        rows = [(100, 100, 100, 100, 1), (100, 101, 99, 100, 0), (104, 107.37, 103, 107, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, tgt=7), [('AAA', b)], rl=rules(slip=0.333))
        t = r['trades'][0]
        self.assertEqual((t['fills'][0]['price'], t['exitReason'], t['exitPrice']), (100.34, 'TARGET', 107.37))
        # stop 3%: 100.34*0.97 = 97.3298 ; touched by low 97 -> floor2(97.3298*0.99667 = 97.0056918) = 97.00
        rows = [(100, 100, 100, 100, 1), (100, 101, 99, 100, 0), (99, 100, 97, 98, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, sl=3), [('AAA', b)], rl=rules(slip=0.333))
        t = r['trades'][0]
        self.assertEqual((t['fills'][0]['stopAfter'], t['exitReason'], t['exitPrice']), (97.33, 'STOP_LOSS', 97.0))
        # same stop without slippage: still a market sell -> floor2(97.3298) = 97.32
        r = run(strat(VOL_ENTRY, sl=3), [('AAA', b)], rl=rules(slip=0))
        self.assertEqual(r['trades'][0]['exitPrice'], 97.0)        # buy 100 -> stop 97.0 exactly
        # END valuation: no slippage, raw last close
        rows = [(100, 100, 100, 100, 1), (100, 101, 99, 100.55, 0)]
        r = run(strat(VOL_ENTRY), [('AAA', bars_from(rows))], rl=rules(slip=0.333))
        self.assertEqual((r['trades'][0]['exitReason'], r['trades'][0]['exitPrice']), ('END', 100.55))

    # ---- rule 4: price-rule tolerance ----------------------------------------------------------
    def test_touch_stop_tolerance(self):
        # stop = 120*(1-3/100) = 116.39999999999999 ; low 116.4 -> exact rule would NOT touch, v2 does
        self.assertFalse(116.4 <= 120 * (1 - 3 / 100))
        rows = [(120, 120, 120, 120, 1), (120, 121, 119, 120, 0), (118, 119, 116.4, 117, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, sl=3), [('AAA', b)])
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice']), (b['date'][2], 'STOP_LOSS', 116.4))

    def test_target_tolerance_and_ceil2(self):
        # target = ceil2(100*1.09 = 109.00000000000001) = 109.0 ; high 109 reaches it
        self.assertFalse(109 >= 100 * (1 + 9 / 100))
        rows = [(100, 100, 100, 100, 1), (100, 101, 99, 100, 0), (105, 109, 104, 106, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, tgt=9), [('AAA', b)])
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice']), (b['date'][2], 'TARGET', 109))

    def test_close_stop_tolerance(self):
        # stop = 120*(1-21/100) = 94.80000000000001 ; close 94.8 -> exact `close < stop` is TRUE, v2 below() is not
        self.assertTrue(94.8 < 120 * (1 - 21 / 100))
        rows = [(120, 120, 120, 120, 1), (120, 121, 119, 120, 0), (95, 96, 94, 94.8, 0), (94.8, 95.5, 94.5, 95, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, sl=21), [('AAA', b)], rl=rules(trig='CLOSE'))
        t = r['trades'][0]
        self.assertEqual((t['exitReason'], t['exitDate'], t['exitPrice']), ('END', b['date'][3], 95))

    def test_pyramid_tolerance(self):
        # buy at 100.01 ; d3 MA2 = (100.0 + 100.02)/2 = 100.00999999999999 < 100.01 in floats -> v2 treats as equal
        self.assertTrue((100.0 + 100.02) / 2 < 100.01)
        rows = [(100, 100, 100, 100, 0),                 # before from
                (100, 100.5, 99.5, 100, 1),              # d1 signal
                (100.01, 100.3, 99.8, 100.0, 0),         # d2 buy @100.01 ; MA 100 < 100.01 -> not due
                (100.0, 100.1, 99.95, 100.02, 0),        # d3 MA 100.00999.. ~ 100.01, close >= MA -> ADD due
                (100.05, 100.2, 100.03, 100.1, 0)]       # d4 ADD @100.05 (stop 100.01) ; low 100.03 holds
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': 1}
        r = run(strat(VOL_ENTRY, pyr=pyr), [('AAA', b)], frm=D[1])
        t = r['trades'][0]
        self.assertEqual([(f['date'], f['kind'], f['price'], f['stopAfter']) for f in t['fills']],
                         [(D[2], 'ENTRY', 100.01, None), (D[4], 'ADD', 100.05, 100.01), (D[4], 'EXIT', 100.1, None)])

    # ---- rule 5: share count tolerance -----------------------------------------------------------
    def test_amount_shares_tolerance(self):
        # 300.03 / 100.01 = 2.9999999999999996 -> floor would give 2 ; v2 gives 3
        self.assertEqual(math.floor(300.03 / 100.01), 2)
        rows = [(100, 100, 100, 100, 1), (100.01, 100.5, 99.5, 100.2, 0)]
        r = run(strat(VOL_ENTRY, sizing=('AMOUNT', 300.03)), [('AAA', bars_from(rows))])
        self.assertEqual(r['trades'][0]['quantity'], 3)
        from simulate import shares_from
        self.assertEqual((shares_from(2.9999999999999996), shares_from(2.99), shares_from(-0.5)), (3, 2, -1))

    # ---- rule 6: step 1 (lapsed / circuit / locked-down exit / gap) -------------------------------
    def test_lapsed_order(self):
        # BBB signals d0 but has no candle on d1 (the market's next day) -> at d2 the ENTRY lapses
        dates = weekdays('2026-01-05', 4)
        a = bars_from([(100, 101, 99, 100, 0)] * 4, dates)
        bb = bars_from([(50, 51, 49, 50, 1), (50, 51, 49, 50, 0), (50, 51, 49, 50, 0)], [dates[0], dates[2], dates[3]])
        r = run(strat(VOL_ENTRY), [('AAA', a), ('BBB', bb)])
        self.assertEqual(r['trades'], [])
        self.assertEqual(r['skipped'], [{'symbol': 'BBB', 'date': dates[2], 'kind': 'ENTRY', 'category': 'lapsed'}])

    def test_circuit_up_entry_at_open(self):
        # d1 is one price all day (110) above d0's close 100 -> locked UP -> pending ENTRY skipped "circuit"
        rows = [(100, 101.37, 99, 100, 1), (110, 110, 110, 110, 0), (111, 112, 110, 111, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY), [('AAA', b)])
        self.assertEqual(r['trades'], [])
        self.assertEqual(r['skipped'], [{'symbol': 'AAA', 'date': b['date'][1], 'kind': 'ENTRY', 'category': 'circuit'}])

    def test_exit_waits_on_locked_down(self):
        # d2 exit signal -> pending ; d3 locked DOWN (90 all day < 101) -> stays pending ; d4 sells at open 91
        rows = [(100, 101.37, 99, 100, 1), (100, 101, 99, 100, 0), (101, 102, 100, 101, -1), (90, 90, 90, 90, 0),
                (91, 92, 89, 91, 0)]
        b = bars_from(rows)
        D = b['date']
        r = run(strat(VOL_ENTRY, VOL_EXIT), [('AAA', b)])
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice'], t['fills'][-1]['signalDate']),
                         (D[4], 'EXIT_RULE', 91, D[2]))

    def test_add_gap(self):
        # PYR rows with d3 opening at 101 = the ADD's stopAfter -> SKIP "gap" ; d3's own check re-arms the ADD
        # (MA 104 >= 100, close 106) -> d4 ADD @107 stop 104 (adds 1) ; d4 check: MA 108 >= 107, close 110 ->
        # ADD due (adds 1 < 2) -> d5 ADD @109 stop 108 (109 > 108, no gap) ; d5 low 103 <= 108 -> PYRAMID_STOP @108
        rows = list(TestSimulation.PYR_ROWS)
        rows[3] = (101, 106, 100.5, 106, 0)
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': 2}
        r = run(strat(VOL_ENTRY, pyr=pyr), [('AAA', b)], frm=D[1])
        self.assertEqual(r['skipped'], [{'symbol': 'AAA', 'date': D[3], 'kind': 'ADD', 'category': 'gap'}])
        t = r['trades'][0]
        self.assertEqual([(f['date'], f['kind'], f['price']) for f in t['fills']],
                         [(D[2], 'ENTRY', 100), (D[4], 'ADD', 107), (D[5], 'ADD', 109), (D[5], 'EXIT', 108)])

    # ---- rule 7: locked DOWN in step 2 / step 3 ; locked UP at the close ---------------------------
    def test_no_stop_sale_on_locked_down(self):
        # stop 95 ; d2 locked DOWN at 90 -> no stop sale ; d3 opens 91 <= 95 -> sold at open 91
        rows = [(100, 100.37, 100, 100, 1), (100, 101, 99, 100, 0), (90, 90, 90, 90, 0), (91, 92, 89, 91, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, sl=5), [('AAA', b)])
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice']), (b['date'][3], 'STOP_LOSS', 91))

    def test_close_exit_does_nothing_on_locked_down(self):
        # fill CLOSE: buy d0 close 100 ; d1 locked DOWN with exit signal -> nothing ; d2 exit -> sold at close 91
        rows = [(100, 101.37, 99, 100, 1), (90, 90, 90, 90, -1), (91, 92, 90, 91, -1)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, VOL_EXIT), [('AAA', b)], rl=rules(fill='CLOSE'))
        t = r['trades'][0]
        self.assertEqual((t['entryDate'], t['exitDate'], t['exitReason'], t['exitPrice']),
                         (b['date'][0], b['date'][2], 'EXIT_RULE', 91))

    def test_close_fill_entry_and_add_on_locked_up(self):
        # ENTRY: d1 locked UP (110 all day > 100) with a signal -> SKIP circuit ; d2 buys at close 111
        rows = [(100, 101.37, 99, 100, 0), (110, 110, 110, 110, 1), (111, 112, 110, 111, 1)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY), [('AAA', b)], rl=rules(fill='CLOSE'))
        self.assertEqual(r['skipped'], [{'symbol': 'AAA', 'date': b['date'][1], 'kind': 'ENTRY', 'category': 'circuit'}])
        self.assertEqual((r['trades'][0]['entryDate'], r['trades'][0]['fills'][0]['price']), (b['date'][2], 111))
        # ADD: buy d1 close 100 ; d2 locked UP 110: MA2 105 >= 100, close >= MA -> due -> SKIP circuit ;
        # d3: MA (110+112)/2 = 111 >= 100, close 112 -> ADD at close 112 with stop 111
        rows = [(100, 100.37, 100, 100, 0), (100, 100.5, 99.5, 100, 1), (110, 110, 110, 110, 0), (111, 112, 110, 112, 0)]
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': 1}
        r = run(strat(VOL_ENTRY, pyr=pyr), [('AAA', b)], frm=D[1], rl=rules(fill='CLOSE'))
        self.assertEqual(r['skipped'], [{'symbol': 'AAA', 'date': D[2], 'kind': 'ADD', 'category': 'circuit'}])
        self.assertEqual([(f['date'], f['kind'], f['price'], f['stopAfter']) for f in r['trades'][0]['fills']],
                         [(D[1], 'ENTRY', 100, None), (D[3], 'ADD', 112, 111), (D[3], 'EXIT', 112, None)])

    # ---- rule 8: max positions at signal time ---------------------------------------------------
    def test_max_positions_counts_pending_exit_as_free(self):
        # maxPositions 1: AAA holds and gets a pending EXIT on d2 ; BBB signals d2 -> 1 - 1 + 0 = 0 < 1 -> pending
        # d3: EXIT pass sells AAA at the open, then BBB buys (holding 0 < 1)
        a = bars_from([(100, 101, 99, 100, 1), (100, 101, 99, 100, 0), (100, 101, 99, 100, -1), (100, 101, 99, 100, 0)])
        bb = bars_from([(50, 51, 49, 50, 0), (50, 51, 49, 50, 0), (50, 51, 49, 50, 1), (50, 51, 49, 50, 0)])
        D = a['date']
        r = run(strat(VOL_ENTRY, VOL_EXIT), [('AAA', a), ('BBB', bb)], maxpos=1)
        self.assertEqual(r['skipped'], [])
        self.assertEqual([(t['symbol'], t['entryDate'], t['exitDate'], t['exitReason']) for t in r['trades']],
                         [('AAA', D[1], D[3], 'EXIT_RULE'), ('BBB', D[3], D[3], 'END')])

    # ---- rule 9: END lists a pending ADD ----------------------------------------------------------
    def test_end_pending_add(self):
        # PYR rows cut after d2: ENTRY @100 on d2 and an ADD due at d2's close (the last date)
        rows = list(TestSimulation.PYR_ROWS)[:3]
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': 2}
        r = run(strat(VOL_ENTRY, pyr=pyr), [('AAA', b)], frm=D[1])
        self.assertEqual(r['skipped'], [{'symbol': 'AAA', 'date': D[2], 'kind': 'ADD', 'category': 'end'}])
        t = r['trades'][0]
        self.assertEqual((t['exitReason'], t['exitDate'], t['exitPrice'], t['adds']), ('END', D[2], 102, 0))


class TestV3(unittest.TestCase):
    """Hand-worked tests for SPEC v3 (zero-volume NONE candles, noBuy / noSell, STUCK)."""

    def test_none_checked_before_circuit(self):
        # d1 is one price all day (110 > 100) AND has zero volume -> NONE wins -> "no-trades", not "circuit"
        rows = [(100, 101, 99, 100, 1), (110, 110, 110, 110, NOVOL), (111, 112, 110, 111, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY), [('AAA', b)])
        self.assertEqual(r['trades'], [])
        self.assertEqual(r['skipped'], [{'symbol': 'AAA', 'date': b['date'][1], 'kind': 'ENTRY', 'category': 'no-trades'}])

    def test_exit_waits_on_none(self):
        # d2 exit signal -> pending ; d3 NONE -> stays pending ; d4 sells at open 104 (signal date stays d2)
        rows = [(100, 101, 99, 100, 1), (100, 101, 99, 100, 0), (101, 102, 100, 101, -1),
                (102, 103, 101, 102, NOVOL), (104, 105, 103, 104, 0)]
        b = bars_from(rows)
        D = b['date']
        r = run(strat(VOL_ENTRY, VOL_EXIT), [('AAA', b)])
        t = r['trades'][0]
        self.assertEqual((t['exitDate'], t['exitReason'], t['exitPrice'], t['fills'][-1]['signalDate']),
                         (D[4], 'EXIT_RULE', 104, D[2]))

    def test_add_at_open_on_none(self):
        # PYR rows with d3 NONE: the pending ADD (stop 101) is skipped "no-trades" ; d3 is still a check, so the
        # ADD re-arms (MA 104 >= 100, close 106) -> d4 ADD @107 ; d4 re-arms (MA 108) -> d5 ADD @109 stop 108 ;
        # d5 low 103 <= 108 -> PYRAMID_STOP @108. d3's NONE candle (low 100 < 101) sells nothing.
        rows = list(TestSimulation.PYR_ROWS)
        rows[3] = (103, 106, 100, 106, NOVOL)
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': 2}
        r = run(strat(VOL_ENTRY, pyr=pyr), [('AAA', b)], frm=D[1])
        self.assertEqual(r['skipped'], [{'symbol': 'AAA', 'date': D[3], 'kind': 'ADD', 'category': 'no-trades'}])
        self.assertEqual([(f['date'], f['kind'], f['price']) for f in r['trades'][0]['fills']],
                         [(D[2], 'ENTRY', 100), (D[4], 'ADD', 107), (D[5], 'ADD', 109), (D[5], 'EXIT', 108)])

    def test_step2_skips_none_candle(self):
        # trailing 10% from the 100 fill. d2 is NONE with high 150 and low 85:
        #   no stop sale (85 <= 90 ignored) and highWater stays 100 (stop stays 90)
        # d3 (120,121,118,119): stop 90 untouched -> END at 119. (With hw = 150 the stop would be 135 and d3
        # would gap-sell at 120 ; without the NONE skip d2 would sell at 90.)
        rows = [(100, 100, 100, 100, 1), (100, 100, 99, 100, 0), (100, 150, 85, 120, NOVOL), (120, 121, 118, 119, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, ts=10), [('AAA', b)])
        t = r['trades'][0]
        self.assertEqual((t['exitReason'], t['exitDate'], t['exitPrice']), ('END', b['date'][3], 119))
        # target 10% (110): NONE d2 with high 115 does not fill ; d3 high 112 does (at 110)
        rows = [(100, 100, 100, 100, 1), (100, 100, 99, 100, 0), (105, 115, 104, 108, NOVOL), (108, 112, 107, 111, 0)]
        b = bars_from(rows)
        r = run(strat(VOL_ENTRY, tgt=10), [('AAA', b)])
        t = r['trades'][0]
        self.assertEqual((t['exitReason'], t['exitDate'], t['exitPrice']), ('TARGET', b['date'][3], 110))

    def test_close_fill_stuck_on_none_blocks_add(self):
        # fill CLOSE, SMA2 pyramid: buy d1 close 100. d2 is NONE with an exit signal (VOL_EXIT: volume 0 <= 999):
        # noSell -> STUCK: no sale and NO add, although the add is due (MA 105 >= 100, close 110 >= 105).
        # d3 normal, no exit signal: MA (110+111)/2 = 110.5 >= 100, close 111 -> ADD at close 111 (stop 110.5)
        rows = [(100, 100, 100, 100, 0), (100, 100.5, 99.5, 100, 1), (110, 111, 109, 110, NOVOL),
                (111, 112, 110, 111, 0)]
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': 1}
        r = run(strat(VOL_ENTRY, VOL_EXIT, pyr=pyr), [('AAA', b)], frm=D[1], rl=rules(fill='CLOSE'))
        self.assertEqual(r['skipped'], [])
        self.assertEqual([(f['date'], f['kind'], f['price'], f['stopAfter']) for f in r['trades'][0]['fills']],
                         [(D[1], 'ENTRY', 100, None), (D[3], 'ADD', 111, 110.5), (D[3], 'EXIT', 111, None)])
        self.assertEqual(r['trades'][0]['exitReason'], 'END')

    def test_close_fill_stuck_on_locked_down_blocks_add(self):
        # resolves v2 ambiguity A8. fill CLOSE, SMA3 pyramid, data starts at d0 (SMA3 first defined at d2).
        # d0 buy at close 100 ; d1 close 150 (SMA3 na) ; d2 locked DOWN at 140 (< 150) with an exit signal:
        # SMA3 = (100+150+140)/3 = 130 >= 100 and close 140 >= 130 -> the add WOULD be due, but the stock is STUCK.
        # d3: no exit signal ; SMA3 = (150+140+141)/3 = 143.67 > close 141 -> not due -> END at 141.
        rows = [(100, 101.37, 99, 100, 1), (150, 151, 149, 150, 0), (140, 140, 140, 140, -1), (141, 142, 140, 141, 0)]
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 3, 'maxAdds': 3}
        r = run(strat(VOL_ENTRY, VOL_EXIT, pyr=pyr), [('AAA', b)], rl=rules(fill='CLOSE'))
        t = r['trades'][0]
        self.assertEqual([(f['date'], f['kind'], f['price']) for f in t['fills']],
                         [(D[0], 'ENTRY', 100), (D[3], 'EXIT', 141)])
        self.assertEqual((t['exitReason'], r['skipped']), ('END', []))

    def test_close_fill_entry_and_add_on_none(self):
        # ENTRY (close > 105): d1 NONE -> SKIP "no-trades" ; d2 buys at close 111
        rows = [(100, 101, 99, 100), (110, 111, 109, 110, NOVOL), (111, 112, 110, 111)]
        b = bars_from(rows)
        r = run(strat(C(P('close'), 'GT', N(105))), [('AAA', b)], rl=rules(fill='CLOSE'))
        self.assertEqual(r['skipped'], [{'symbol': 'AAA', 'date': b['date'][1], 'kind': 'ENTRY', 'category': 'no-trades'}])
        self.assertEqual((r['trades'][0]['entryDate'], r['trades'][0]['fills'][0]['price']), (b['date'][2], 111))
        # ADD: buy d1 close 100 ; d2 NONE, add due (MA2 105 >= 100, close 110) -> SKIP "no-trades" (kind ADD) ;
        # d3: MA 110.5, close 111 -> ADD at close 111
        rows = [(100, 100, 100, 100, 0), (100, 100.5, 99.5, 100, 1), (110, 111, 109, 110, NOVOL),
                (111, 112, 110, 111, 0)]
        b = bars_from(rows)
        D = b['date']
        pyr = {'enabled': True, 'maType': 'SMA', 'maPeriod': 2, 'maxAdds': 1}
        r = run(strat(VOL_ENTRY, pyr=pyr), [('AAA', b)], frm=D[1], rl=rules(fill='CLOSE'))
        self.assertEqual(r['skipped'], [{'symbol': 'AAA', 'date': D[2], 'kind': 'ADD', 'category': 'no-trades'}])
        self.assertEqual([(f['date'], f['kind'], f['price']) for f in r['trades'][0]['fills']],
                         [(D[1], 'ENTRY', 100), (D[3], 'ADD', 111), (D[3], 'EXIT', 111)])


class TestV4(unittest.TestCase):
    """Hand-worked tests for SPEC v4 (COARSE blocks of 40 are never circuit-locked)."""

    @staticmethod
    def _cycle(closes, n, tick):
        """n candles cycling through closes: o = c, h = c + tick, l = c - tick."""
        return [(c, c + tick, c - tick, c) for c in (closes[i % len(closes)] for i in range(n))]

    def test_coarse_mask_blocks(self):
        from simulate import coarse_mask
        rows = []
        # block 0 (0-39): Rs 10 in 0.5 steps; values 9..11.5 (6 distinct); step 5 no, 1 no (10.5), 0.5 yes;
        #   sorted closes[20] = 10.5 -> 0.5/10.5*100 = 4.76 >= 0.2 -> COARSE. One close is 0.1*105 =
        #   10.500000000000002 (float noise): |x/0.5 - 21| ~ 4e-15 < 1e-6 still counts as a multiple.
        b0 = self._cycle([10, 10.5, 11, 10.5, 10, 9.5], 40, 0.5)
        b0[7] = (0.1 * 105, 11.0, 10.0, 0.1 * 105)
        rows += b0
        # block 1 (40-79): Rs 10000 in 5 steps -> FIRST step found is 5 -> 5/10000*100 = 0.05 < 0.2 -> not coarse
        #   (a smaller step would only give a smaller ratio)
        rows += self._cycle([10000, 10005, 10010, 10005, 9995, 9990], 40, 5)
        # block 2 (80-119): one-price days on 4 distinct values (20, 20.5, 21, 21.5) -> < 5 distinct -> skipped
        rows += [(c, c, c, c) for c in ([20, 20.5, 21, 21.5] * 10)]
        # block 3 (120-159): Rs 50 in 0.25 steps (50.25 rules out 0.5) -> step 0.25 ; closes[20] = 50.25 ->
        #   0.25/50.25*100 = 0.4975 >= 0.2 -> COARSE
        rows += self._cycle([50, 50.25, 50.5, 50.25, 50, 49.75], 40, 0.25)
        # block 4 (160-164): short last block, paise prices -> no step fits -> not coarse
        rows += [(100.13, 100.27, 99.91, 100.13)] * 5
        b = bars_from(rows, weekdays('2020-01-06', len(rows)))
        self.assertEqual(coarse_mask(b), [True] * 40 + [False] * 40 + [False] * 40 + [True] * 40 + [False] * 5)

    def test_coarse_block_is_never_locked(self):
        # AAA: coarse Rs 10 block (0.5 steps). d0 signal ; d1 one price 10.5 (> 10) would be locked UP in v3
        # -> v4 fills the ENTRY at 10.5 ; d2 one price 9.5 (< 10.5) would be locked DOWN -> v4 lets the 5% stop
        # (10.5*0.95 = 9.975) fire: open 9.5 <= 9.975 -> STOP_LOSS at open 9.5.
        tail = [(o, h, l, c, 0) for o, h, l, c in self._cycle([10, 10.5, 11, 10.5, 10, 9.5], 37, 0.5)]
        a_rows = [(10, 10.5, 9.5, 10, 1), (10.5, 10.5, 10.5, 10.5, 0), (9.5, 9.5, 9.5, 9.5, 0)] + tail
        # BBB: same coarse block but d1 also has zero volume -> NONE still applies -> "no-trades"
        b_rows = [(10, 10.5, 9.5, 10, 1), (10.5, 10.5, 10.5, 10.5, NOVOL), (9.5, 9.5, 9.5, 9.5, 0)] + tail
        a, b = bars_from(a_rows), bars_from(b_rows)
        D = a['date']
        from simulate import coarse_mask
        self.assertTrue(all(coarse_mask(a)) and all(coarse_mask(b)))
        r = run(strat(VOL_ENTRY, sl=5), [('AAA', a), ('BBB', b)])
        self.assertEqual([(t['symbol'], t['entryDate'], t['exitDate'], t['exitReason'], t['exitPrice'])
                          for t in r['trades']], [('AAA', D[1], D[2], 'STOP_LOSS', 9.5)])
        self.assertEqual(r['trades'][0]['fills'][0]['price'], 10.5)
        self.assertEqual(r['skipped'], [{'symbol': 'BBB', 'date': D[1], 'kind': 'ENTRY', 'category': 'no-trades'}])


class TestV5(unittest.TestCase):
    def test_bb_flat_window_has_zero_width(self):
        # 20 identical closes: every deviation is 0 (or float dust ≤ 1e-10) → upper == lower == mid, %B na, width 0
        bars = {'close': [38.39] * 20}
        op = {'kind': 'INDICATOR', 'indicator': 'BB', 'params': {'period': 20, 'stdDev': 2}}
        up = I.operand_column(bars, dict(op, output='upper'))[-1]
        mid = I.operand_column(bars, dict(op, output='mid'))[-1]
        self.assertEqual(up, mid)
        self.assertTrue(math.isnan(I.operand_column(bars, dict(op, output='percentB'))[-1]))
        self.assertEqual(I.operand_column(bars, dict(op, output='bandwidth'))[-1], 0)


class TestV6(unittest.TestCase):
    def test_stop_label_tie_within_tolerance(self):
        # trailing 55.49 × 0.9 and a pyramid stop of 49.940999999999995 are the same price: the later (pyramid) wins
        import simulate as S
        self.assertTrue(S.at_least(49.940999999999995, 55.49 * 0.9))
        self.assertTrue(S.at_least(55.49 * 0.9, 49.940999999999995))


DATA_DIR = os.path.join(os.environ.get('EQUITY_VERIFY_DIR') or os.path.expanduser('~/.cache/algo-hunt-verify'), 'data')


class TestSmoke(unittest.TestCase):
    DATA = DATA_DIR

    @unittest.skipUnless(os.path.isfile(os.path.join(DATA_DIR, 'MARUTI.json')), 'candles not downloaded yet')
    def test_reference_case_and_speed(self):
        import run as R
        case = json.loads(SMOKE_CASE)
        case['dataDir'] = self.DATA
        out = R.run_case(case, HERE)
        tr = {(t['symbol'], t['entryDate']): t for t in out['trades']}
        m = tr[('MARUTI', '2026-06-29')]
        # v1 reference was 13361.63 / 29.19 ; v2: floor2(13375*0.999 = 13361.625) = 13361.62 and the new
        # exchange rate: 13.36162 + .4102017 + .0133616 + 15.34 + .0762414 = 29.2014 -> 29.20
        self.assertEqual((m['fills'][0]['price'], m['fills'][0]['charges'], m['exitDate'], m['exitPrice'],
                          m['fills'][-1]['charges']), (13753.74, 16.33, '2026-08-31', 13361.62, 29.2))
        l = tr[('LTF', '2026-06-22')]
        self.assertEqual([(f['date'], f['kind'], f['price']) for f in l['fills']],
                         [('2026-06-22', 'ENTRY', 288.59), ('2026-08-10', 'ADD', 308.31),
                          ('2026-09-24', 'EXIT', 278.72)])
        self.assertEqual(l['exitReason'], 'PYRAMID_STOP')
        # dataFrom: rows limited to dataFrom <= date <= endDate
        bars, _ = R.load_slice(self.DATA, 'M&M', '2024-01-01', '2026-10-14')
        self.assertTrue(bars['date'][0] >= '2024-01-01' and bars['date'][-1] <= '2026-10-14')
        out_df = R.run_case(dict(case, dataFrom='2025-01-01'), HERE)
        self.assertTrue(isinstance(out_df['trades'], list) and out_df['curve'][0]['date'] >= '2025-10-20')
        # speed: 10 stocks x full history, daily SMA cross + pyramiding, fresh caches
        R._slices.clear()
        syms = ['ADANIENT', 'AXISBANK', 'HDFCBANK', 'INFY', 'ITC', 'LT', 'M&M', 'MARUTI', 'RELIANCE', 'TCS']
        case2 = dict(case, symbols=syms, **{'from': '2003-01-01', 'to': '2026-10-14'})
        case2['definition'] = json.loads(json.dumps(case['definition']).replace('"1w"', '"1d"'))
        t0 = time.time()
        out2 = R.run_case(case2, HERE)
        el = time.time() - t0
        print('\n  [speed] 10 stocks x full daily history (cold): %.2fs, %d trades, %d curve points'
              % (el, len(out2['trades']), len(out2['curve'])), file=sys.stderr)
        self.assertLess(el, 10)


SMOKE_CASE = '''{"id":"smoke1","definition":{"name":"x","timeframe":"1w","entry":{"when":{"type":"AND","id":"e","children":[{"type":"CONDITION","id":"e1","left":{"kind":"PRICE","field":"close"},"op":"CROSSES_ABOVE","right":{"kind":"INDICATOR","indicator":"SMA","params":{"period":20}}}]},"trigger":"WHEN_TRUE"},"exit":{"targetPct":250,"stopLossPct":null,"trailingStopPct":null,"priceBase":"AVERAGE","when":{"type":"OR","id":"x","children":[{"type":"CONDITION","id":"x1","left":{"kind":"PRICE","field":"close"},"op":"CROSSES_BELOW","right":{"kind":"INDICATOR","indicator":"SMA","params":{"period":20}}}]},"maxBars":null},"pyramid":{"enabled":true,"maType":"SMA","maPeriod":20,"maxAdds":10},"sizing":{"mode":"QUANTITY","value":1}},"symbols":["MARUTI","LTF"],"dataDir":"data","from":"2025-10-20","to":"2026-10-14","capital":500000,"maxPositions":null,"endDate":"2026-10-14","rules":{"fill":"NEXT_OPEN","stopTrigger":"TOUCH","charges":true,"slippagePct":0.1}}'''


if __name__ == '__main__':
    unittest.main(verbosity=1)
