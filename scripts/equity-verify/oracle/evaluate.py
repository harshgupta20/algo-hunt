"""Strategy candles, checks and tri-state condition evaluation (SPEC sections 0 and 3)."""
import datetime
import json
from array import array

from indicators import NAN, normalize_operand, column_from_normalized

TRUE, FALSE, UNKNOWN = True, False, None


# ---------------------------------------------------------------------------------------------
# Tolerant comparisons for CONDITIONS (SPEC §3): floating-point ties count as equal.
# tol(a, b) = 1e-9 * max(1, |a|, |b|). The price rules use the same tolerance (simulate.py at_least / at_most).
def _tol(a, b):
    return 1e-9 * max(1.0, abs(a), abs(b))


def gt(a, b):
    return a - b > _tol(a, b)


def gte(a, b):
    return a - b >= -_tol(a, b)


def lt(a, b):
    return b - a > _tol(a, b)


def lte(a, b):
    return a - b <= _tol(a, b)


CMP = {'GT': gt, 'GTE': gte, 'LT': lt, 'LTE': lte}


# ---------------------------------------------------------------------------------------------
# candles
def daily_bars(raw, date_from=None, date_to=None):
    """Daily bars dict from a data file dict, keeping date_from <= date <= date_to (bounds optional).
    v2 repair on load: high = max(o,h,l,c), low = min(o,h,l,c) (both from the ORIGINAL four values)."""
    dates = raw['date']
    keep = [i for i, d in enumerate(dates)
            if (date_from is None or d >= date_from) and (date_to is None or d <= date_to)]
    out = {'date': [dates[i] for i in keep]}
    O = [float(raw['open'][i]) for i in keep]
    H = [float(raw['high'][i]) for i in keep]
    L = [float(raw['low'][i]) for i in keep]
    C = [float(raw['close'][i]) for i in keep]
    out['open'] = array('d', O)     # compact float64 storage
    out['high'] = array('d', [max(o, h, l, c) for o, h, l, c in zip(O, H, L, C)])
    out['low'] = array('d', [min(o, h, l, c) for o, h, l, c in zip(O, H, L, C)])
    out['close'] = array('d', C)
    out['volume'] = array('d', [float(raw['volume'][i]) for i in keep])
    return out


def build_weekly(bars, end_date):
    """Monday-Sunday weeks (by date). Returns bars dict + 'lastIdx' (daily index of last day) + 'complete'."""
    w = {'date': [], 'open': [], 'high': [], 'low': [], 'close': [], 'volume': [], 'lastIdx': [], 'complete': []}
    mondays = []
    cur = None
    D, O, H, L, C, V = bars['date'], bars['open'], bars['high'], bars['low'], bars['close'], bars['volume']
    for i, d in enumerate(D):
        dt = datetime.date.fromisoformat(d)
        mon = dt - datetime.timedelta(days=dt.weekday())
        if mon != cur:
            cur = mon
            mondays.append(mon)
            w['date'].append(d)
            w['open'].append(O[i])
            w['high'].append(H[i])
            w['low'].append(L[i])
            w['close'].append(C[i])
            w['volume'].append(V[i])
            w['lastIdx'].append(i)
        else:
            w['date'][-1] = d
            if H[i] > w['high'][-1]:
                w['high'][-1] = H[i]
            if L[i] < w['low'][-1]:
                w['low'][-1] = L[i]
            w['close'][-1] = C[i]
            w['volume'][-1] += V[i]
            w['lastIdx'][-1] = i
    n = len(mondays)
    w['complete'] = [True] * n
    if n:
        friday = (mondays[-1] + datetime.timedelta(days=4)).isoformat()
        w['complete'][-1] = end_date >= friday
    return w


# ---------------------------------------------------------------------------------------------
class StrategySeries:
    """Per-stock strategy candles + checks + compiled conditions.

    check k <-> daily index check_daily[k]; own index of check k == k (daily: daily index; weekly:
    weekly candle index -- only the last weekly candle can be incomplete, so complete weeks are 0..K-1).
    colcache: dict-like (get / []=) for this stock's data slice; also holds the weekly bars.
    """

    def __init__(self, symbol, daily, timeframe, end_date, colcache):
        self.symbol = symbol
        self.timeframe = timeframe
        self.colcache = colcache
        n = len(daily['date'])
        if timeframe == '1d':
            self.bars = daily
            self.k_of_daily = list(range(n))
            self.n_checks = n
        elif timeframe == '1w':
            wkey = ('__weekly__', end_date)
            wk = colcache.get(wkey)
            if wk is None:
                wk = build_weekly(daily, end_date)
                colcache[wkey] = wk
            self.bars = wk
            self.k_of_daily = [-1] * n
            k = 0
            for wi, li in enumerate(wk['lastIdx']):
                if wk['complete'][wi]:
                    # complete weeks are contiguous from 0, so k == wi
                    assert k == wi
                    self.k_of_daily[li] = wi
                    k += 1
            self.n_checks = k
        else:
            raise ValueError('unknown timeframe %r' % (timeframe,))

    def column(self, operand):
        op = normalize_operand(operand)
        key = (self.symbol, self.timeframe, json.dumps(op, sort_keys=True))
        col = self.colcache.get(key)
        if col is None:
            col = array('d', column_from_normalized(self.bars, op))   # nan kept; compact storage
            self.colcache[key] = col
        return col

    def reader(self, operand):
        """function(k) -> float value of operand at check k."""
        if operand.get('kind') == 'NUMBER':
            v = float(operand['value'])
            return lambda k: v
        col = self.column(operand)
        ba = int(operand.get('barsAgo') or 0)
        n = len(col)

        def rd(k):
            i = k - ba
            return col[i] if 0 <= i < n else NAN
        return rd

    def compile_group(self, g):
        t = g.get('type')
        if t == 'CONDITION':
            return self._compile_cond(g)
        if t not in ('AND', 'OR'):
            raise ValueError('unknown group type %r' % (t,))
        kids = [self.compile_group(c) for c in (g.get('children') or [])]
        if t == 'AND':
            def f_and(k):
                if not kids:
                    return UNKNOWN
                unk = False
                for c in kids:
                    v = c(k)
                    if v is FALSE:
                        return FALSE
                    if v is UNKNOWN:
                        unk = True
                return UNKNOWN if unk else TRUE
            return f_and

        def f_or(k):
            if not kids:
                return UNKNOWN
            unk = False
            for c in kids:
                v = c(k)
                if v is TRUE:
                    return TRUE
                if v is UNKNOWN:
                    unk = True
            return UNKNOWN if unk else FALSE
        return f_or

    def _compile_cond(self, c):
        op = c.get('op')
        lf = self.reader(c['left'])
        rf = self.reader(c['right'])
        if op in CMP:
            cmp = CMP[op]

            def f_cmp(k):
                L = lf(k)
                R = rf(k)
                if L != L or R != R:
                    return UNKNOWN
                return cmp(L, R)
            return f_cmp
        if op in ('CROSSES_ABOVE', 'CROSSES_BELOW'):
            above = op == 'CROSSES_ABOVE'

            def f_cross(k):
                L = lf(k)
                R = rf(k)
                if L != L or R != R or k < 1:
                    return UNKNOWN
                pl = lf(k - 1)
                pr = rf(k - 1)
                if pl != pl or pr != pr:
                    return UNKNOWN
                if above:
                    return gt(L, R) and lte(pl, pr)
                return lt(L, R) and gte(pl, pr)
            return f_cross
        raise ValueError('unknown op %r' % (op,))


def has_condition(g):
    if not g:
        return False
    if g.get('type') == 'CONDITION':
        return True
    return any(has_condition(c) for c in (g.get('children') or []))
