"""Reference indicators (TradingView Pine v5 semantics) for the equity backtest oracle.

Pure standard library. na = float('nan'). See SPEC.md section 1.

Public API:
    operand_column(bars, operand) -> list[float]
    normalize_operand(operand) -> dict   (defaults filled in; used for cache keys)

Rule for na values inside a source series (SPEC "ma" rule): na values are ignored. Every
single-source indicator is computed on the compressed series of non-na values and scattered
back, so the output at a bar whose source is na is na and the computation continues after it.
Columns may be lists or array('d').
"""
import math

NAN = float('nan')
PRICE_FIELDS = ('open', 'high', 'low', 'close', 'volume')


def isnan(x):
    return x != x


# ---------------------------------------------------------------------------------------------
# indicator table: params defaults, sources (default first), outputs (default first)
SPECS = {
    'SMA': ({'period': 20}, ('close', 'open', 'high', 'low', 'volume'), None),
    'EMA': ({'period': 20}, ('close', 'open', 'high', 'low', 'volume'), None),
    'WMA': ({'period': 20}, ('close', 'open', 'high', 'low', 'volume'), None),
    'RSI': ({'period': 14}, ('close', 'open', 'high', 'low'), None),
    'MACD': ({'fast': 12, 'slow': 26, 'signal': 9}, ('close',), ('line', 'signal', 'hist')),
    'BB': ({'period': 20, 'stdDev': 2}, ('close',), ('upper', 'mid', 'lower', 'percentB', 'bandwidth')),
    'ATR': ({'period': 14}, None, None),
    'SUPERTREND': ({'period': 10, 'multiplier': 3}, None, ('value', 'direction')),
    'ADX': ({'period': 14, 'smoothing': 14}, None, None),
    'DMI': ({'period': 14}, None, ('plus', 'minus')),
    'HIGHEST': ({'period': 20}, ('high', 'close', 'low', 'open', 'volume'), None),
    'LOWEST': ({'period': 20}, ('low', 'close', 'high', 'open', 'volume'), None),
    'ROC': ({'period': 10}, ('close', 'volume'), None),
}
INT_PARAMS = {'period', 'fast', 'slow', 'signal', 'smoothing'}


# ---------------------------------------------------------------------------------------------
# na-ignoring wrapper
def _na_ignoring(fn):
    """Run fn on the non-na values of src and scatter the result(s) back (na at na bars)."""
    def wrapped(src, *args):
        n = len(src)
        idx = [i for i in range(n) if src[i] == src[i]]
        if len(idx) == n:
            return fn(src, *args)
        res = fn([src[i] for i in idx], *args)
        if isinstance(res, dict):
            return {k: _scatter(n, idx, v) for k, v in res.items()}
        return _scatter(n, idx, res)
    wrapped.dense = fn
    return wrapped


def _scatter(n, idx, vals):
    out = [NAN] * n
    for j, i in enumerate(idx):
        out[i] = vals[j]
    return out


def _check_period(n):
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        raise ValueError('period must be an integer >= 1, got %r' % (n,))


# ---------------------------------------------------------------------------------------------
# dense (no-na) building blocks
def _sma_d(x, n):
    _check_period(n)
    N = len(x)
    out = [NAN] * N
    for i in range(n - 1, N):
        out[i] = sum(x[i - n + 1:i + 1]) / n
    return out


def _ema_d(x, n):
    _check_period(n)
    N = len(x)
    out = [NAN] * N
    if N < n:
        return out
    alpha = 2 / (n + 1)
    e = sum(x[:n]) / n
    out[n - 1] = e
    for i in range(n, N):
        e = alpha * x[i] + (1 - alpha) * e
        out[i] = e
    return out


def _rma_d(x, n):
    _check_period(n)
    N = len(x)
    out = [NAN] * N
    if N < n:
        return out
    r = sum(x[:n]) / n
    out[n - 1] = r
    for i in range(n, N):
        r = (r * (n - 1) + x[i]) / n
        out[i] = r
    return out


def _wma_d(x, n):
    _check_period(n)
    N = len(x)
    out = [NAN] * N
    denom = n * (n + 1) / 2
    w = list(range(1, n + 1))  # oldest .. newest  (newest weight n, i.e. j=0)
    for i in range(n - 1, N):
        out[i] = sum([a * b for a, b in zip(w, x[i - n + 1:i + 1])]) / denom
    return out


def _rsi_d(x, n):
    _check_period(n)
    N = len(x)
    out = [NAN] * N
    if N < 2:
        return out
    gains = []
    losses = []
    for i in range(1, N):
        ch = x[i] - x[i - 1]
        gains.append(ch if ch > 0 else 0.0)
        losses.append(-ch if -ch > 0 else 0.0)
    up = _rma_d(gains, n)
    dn = _rma_d(losses, n)
    for j in range(len(up)):
        u = up[j]
        d = dn[j]
        if u != u or d != d:
            continue
        if d == 0:
            v = 100.0
        elif u == 0:
            v = 0.0
        else:
            v = 100 - 100 / (1 + u / d)
        out[j + 1] = v
    return out


def _bb_d(x, n, k):
    _check_period(n)
    N = len(x)
    up = [NAN] * N
    mid = [NAN] * N
    lo = [NAN] * N
    pb = [NAN] * N
    bw = [NAN] * N
    for i in range(n - 1, N):
        win = x[i - n + 1:i + 1]
        basis = sum(win) / n
        # TradingView ta.stdev: a deviation within 1e-10 counts as 0 (a flat window has zero width) — SPEC v5
        dev = math.sqrt(sum([(v - basis) * (v - basis) for v in win if abs(v - basis) > 1e-10]) / n)
        u = basis + k * dev
        l = basis - k * dev
        up[i] = u
        mid[i] = basis
        lo[i] = l
        pb[i] = NAN if u == l else (x[i] - l) / (u - l)
        bw[i] = NAN if basis == 0 else (u - l) / basis * 100
    return {'upper': up, 'mid': mid, 'lower': lo, 'percentB': pb, 'bandwidth': bw}


def _highest_d(x, n):
    _check_period(n)
    N = len(x)
    out = [NAN] * N
    for i in range(n, N):
        out[i] = max(x[i - n:i])
    return out


def _lowest_d(x, n):
    _check_period(n)
    N = len(x)
    out = [NAN] * N
    for i in range(n, N):
        out[i] = min(x[i - n:i])
    return out


def _roc_d(x, n):
    _check_period(n)
    N = len(x)
    out = [NAN] * N
    for i in range(n, N):
        p = x[i - n]
        if p == 0:
            continue
        out[i] = 100 * (x[i] - p) / p
    return out


def _macd_d(x, fast, slow, sig):
    ef = _ema_d(x, fast)
    es = _ema_d(x, slow)
    line = [a - b for a, b in zip(ef, es)]          # na if either na
    signal = ema(line, sig)                          # na-ignoring: seeds on first `sig` defined values
    hist = [a - b for a, b in zip(line, signal)]
    return {'line': line, 'signal': signal, 'hist': hist}


sma = _na_ignoring(_sma_d)
ema = _na_ignoring(_ema_d)
rma = _na_ignoring(_rma_d)
wma = _na_ignoring(_wma_d)
rsi = _na_ignoring(_rsi_d)
bb = _na_ignoring(_bb_d)
highest = _na_ignoring(_highest_d)
lowest = _na_ignoring(_lowest_d)
roc = _na_ignoring(_roc_d)
macd = _na_ignoring(_macd_d)

MA_FUNCS = {'SMA': sma, 'EMA': ema, 'WMA': wma}


# ---------------------------------------------------------------------------------------------
# whole-candle indicators
def true_range(h, l, c, first_na=False):
    N = len(h)
    tr = [NAN] * N
    if N == 0:
        return tr
    tr[0] = NAN if first_na else h[0] - l[0]
    for i in range(1, N):
        pc = c[i - 1]
        tr[i] = max(h[i] - l[i], abs(h[i] - pc), abs(l[i] - pc))
    return tr


def atr(h, l, c, n):
    return rma(true_range(h, l, c), n)


def supertrend(h, l, c, n, factor):
    """Returns {'value', 'direction'}; direction in THIS APP's convention (+1 up, -1 down)."""
    N = len(h)
    a = atr(h, l, c, n)
    val = [NAN] * N
    dirn = [NAN] * N
    prev_lb = NAN   # previous FINAL bands (na during warm-up -> nz -> 0)
    prev_ub = NAN
    prev_st = NAN
    for i in range(N):
        ai = a[i]
        if ai != ai:
            prev_lb = prev_ub = prev_st = NAN
            continue
        src = (h[i] + l[i]) / 2
        ub = src + factor * ai
        lb = src - factor * ai
        p_lb = 0.0 if prev_lb != prev_lb else prev_lb
        p_ub = 0.0 if prev_ub != prev_ub else prev_ub
        c1 = c[i - 1] if i > 0 else NAN          # comparisons with na are false
        lb = lb if (lb > p_lb or c1 < p_lb) else p_lb
        ub = ub if (ub < p_ub or c1 > p_ub) else p_ub
        if i == 0 or a[i - 1] != a[i - 1]:
            d = 1
        elif prev_st == p_ub:
            d = -1 if c[i] > ub else 1
        else:
            d = 1 if c[i] < lb else -1
        st = lb if d == -1 else ub
        val[i] = st
        dirn[i] = float(-d)                       # TradingView -1 (up) -> app +1
        prev_lb, prev_ub, prev_st = lb, ub, st
    return {'value': val, 'direction': dirn}


def _div(a, b):
    if a != a or b != b or b == 0:
        return NAN
    return a / b


def _fixnan(xs):
    out = []
    last = NAN
    for v in xs:
        if v == v:
            last = v
        out.append(last)
    return out


def dmi(h, l, c, n, smoothing=None):
    """Returns {'plus', 'minus', 'adx'(if smoothing)} per ta.dmi."""
    N = len(h)
    plus_dm = [NAN] * N
    minus_dm = [NAN] * N
    for i in range(1, N):
        up = h[i] - h[i - 1]
        down = -(l[i] - l[i - 1])
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0
    trur = rma(true_range(h, l, c, first_na=True), n)
    rp = rma(plus_dm, n)
    rm = rma(minus_dm, n)
    plus = _fixnan([_div(100 * a, b) for a, b in zip(rp, trur)])
    minus = _fixnan([_div(100 * a, b) for a, b in zip(rm, trur)])
    res = {'plus': plus, 'minus': minus}
    if smoothing is not None:
        dx = []
        for p, m in zip(plus, minus):
            s = p + m
            dx.append(abs(p - m) / (1 if s == 0 else s))   # na propagates if p/m na
        r = rma(dx, smoothing)
        res['adx'] = [100 * v for v in r]
    return res


# ---------------------------------------------------------------------------------------------
def _num(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError('bad numeric param %r' % (v,))
    return v


def normalize_operand(operand):
    """Canonical INDICATOR/PRICE operand with all defaults filled in (barsAgo dropped)."""
    kind = operand.get('kind')
    if kind == 'PRICE':
        f = operand.get('field')
        if f not in PRICE_FIELDS:
            raise ValueError('unknown price field %r' % (f,))
        return {'kind': 'PRICE', 'field': f}
    if kind != 'INDICATOR':
        raise ValueError('operand kind %r has no column' % (kind,))
    ind = operand.get('indicator')
    if ind not in SPECS:
        raise ValueError('unknown indicator %r' % (ind,))
    defaults, sources, outputs = SPECS[ind]
    given = operand.get('params') or {}
    params = {}
    for k, dv in defaults.items():
        v = given.get(k)
        if v is None:
            v = dv
        v = _num(v)
        if k in INT_PARAMS and isinstance(v, float) and v.is_integer():
            v = int(v)
        params[k] = v
    out = {'kind': 'INDICATOR', 'indicator': ind, 'params': params}
    if sources is not None:
        src = operand.get('source') or sources[0]
        if src not in PRICE_FIELDS:
            raise ValueError('unknown source %r' % (src,))
        out['source'] = src
    if outputs is not None:
        o = operand.get('output') or outputs[0]
        if o not in outputs:
            raise ValueError('unknown output %r for %s' % (o, ind))
        out['output'] = o
    ma = operand.get('ma')
    if ma:
        t = ma.get('type') or 'SMA'
        if t not in MA_FUNCS:
            raise ValueError('unknown ma type %r' % (t,))
        p = ma.get('period')
        if isinstance(p, float) and p.is_integer():
            p = int(p)
        out['ma'] = {'type': t, 'period': p}
    m = operand.get('multiplier')
    if m is not None:
        out['multiplier'] = _num(m)
    return out


def _base_line(bars, op):
    ind = op['indicator']
    p = op['params']
    if ind in ('SMA', 'EMA', 'WMA'):
        return MA_FUNCS[ind](bars[op['source']], p['period'])
    if ind == 'RSI':
        return rsi(bars[op['source']], p['period'])
    if ind == 'MACD':
        return macd(bars[op['source']], p['fast'], p['slow'], p['signal'])[op['output']]
    if ind == 'BB':
        return bb(bars[op['source']], p['period'], p['stdDev'])[op['output']]
    if ind == 'ATR':
        return atr(bars['high'], bars['low'], bars['close'], p['period'])
    if ind == 'SUPERTREND':
        return supertrend(bars['high'], bars['low'], bars['close'], p['period'], p['multiplier'])[op['output']]
    if ind == 'ADX':
        return dmi(bars['high'], bars['low'], bars['close'], p['period'], p['smoothing'])['adx']
    if ind == 'DMI':
        return dmi(bars['high'], bars['low'], bars['close'], p['period'])[op['output']]
    if ind == 'HIGHEST':
        return highest(bars[op['source']], p['period'])
    if ind == 'LOWEST':
        return lowest(bars[op['source']], p['period'])
    if ind == 'ROC':
        return roc(bars[op['source']], p['period'])
    raise ValueError('unknown indicator %r' % (ind,))


def column_from_normalized(bars, op):
    if op['kind'] == 'PRICE':
        return [float(v) for v in bars[op['field']]]
    line = _base_line(bars, op)
    ma = op.get('ma')
    if ma:
        line = MA_FUNCS[ma['type']](line, ma['period'])
    m = op.get('multiplier')
    if m is not None:
        line = [v * m for v in line]
    return list(line)


def operand_column(bars, operand):
    """One float per candle of `bars` (nan where undefined). barsAgo is NOT applied here."""
    return column_from_normalized(bars, normalize_operand(operand))
