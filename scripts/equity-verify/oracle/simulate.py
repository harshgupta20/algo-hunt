"""Reference equity backtest simulation (SPEC section 4, v2)."""
import datetime
import math

from evaluate import StrategySeries, has_condition, TRUE


def round2(x):
    """JavaScript Math.round(x*100)/100 (half rounds toward +infinity)."""
    y = x * 100
    r = math.ceil(y)
    if r - 0.5 > y:
        r -= 1
    out = r / 100
    return 0.0 if out == 0 else out


def ceil2(x):
    """v2 whole paise, rounded up: ceil(x*100 - 1e-6)/100."""
    out = math.ceil(x * 100 - 1e-6) / 100
    return 0.0 if out == 0 else out


def floor2(x):
    """v2 whole paise, rounded down: floor(x*100 + 1e-6)/100."""
    out = math.floor(x * 100 + 1e-6) / 100
    return 0.0 if out == 0 else out


# v2 price-rule tolerance (same tol as conditions)
def _tol(a, b):
    return 1e-9 * max(1.0, abs(a), abs(b))


def at_least(a, b):
    return not (b - a > _tol(a, b))


def at_most(a, b):
    return not (a - b > _tol(a, b))


def below(a, b):
    return b - a > _tol(a, b)


# v2 charges
def delivery_charges(side, value):
    stt = value * 0.001
    exch = value * 0.0000307
    sebi = value * 10 / 1e7
    stamp = value * 0.00015 if side == 'BUY' else 0.0
    dp = 15.34 if side == 'SELL' else 0.0
    gst = 0.18 * (exch + sebi)
    return round2(stt + exch + sebi + stamp + dp + gst)


def intraday_charges(side, value):
    brokerage = min(value * 0.0003, 20)
    stt = value * 0.00025 if side == 'SELL' else 0.0
    exch = value * 0.0000307
    sebi = value * 10 / 1e7
    stamp = value * 0.00003 if side == 'BUY' else 0.0
    gst = 0.18 * (brokerage + exch + sebi)
    return round2(brokerage + stt + exch + sebi + stamp + gst)


def order_charges(side, value, enabled):
    """DELIVERY charges of one order (kept for tests/back-compat)."""
    return delivery_charges(side, value) if enabled else 0


def shares_from(n):
    """v2 AMOUNT/PERCENT share count: floor(n + 1e-9*max(1, n))."""
    return math.floor(n + 1e-9 * max(1.0, n))


COARSE_STEPS = (5, 1, 0.5, 0.25, 0.1)
COARSE_BLOCK = 40


def coarse_mask(bars, block=COARSE_BLOCK):
    """v4: per loaded candle, True if it lies in a COARSE block (rounded history -> never circuit-locked)."""
    O, H, L, C = bars['open'], bars['high'], bars['low'], bars['close']
    n = len(C)
    mask = [False] * n
    for start in range(0, n, block):
        end = min(n, start + block)
        vals = []
        for i in range(start, end):
            vals.extend((O[i], H[i], L[i], C[i]))
        if len(set(vals)) < 5:
            continue
        found = None
        for step in COARSE_STEPS:
            if all(abs(x / step - round(x / step)) < 1e-6 for x in vals):
                found = step
                break
        if found is None:
            continue
        closes = sorted(C[start:end])
        median = closes[len(closes) // 2]
        if median > 0 and found / median * 100 >= 0.2:
            for i in range(start, end):
                mask[i] = True
    return mask


def _days_between(a, b):
    return (datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days


class Position:
    __slots__ = ('qty', 'buyValue', 'charges', 'firstPrice', 'lastBuyPrice', 'adds', 'pyramidStop',
                 'highWater', 'entryCheck', 'entryDate', 'fills')

    def __init__(self, px, entry_check, date):
        self.qty = 0
        self.buyValue = 0.0
        self.charges = 0
        self.firstPrice = px
        self.lastBuyPrice = px
        self.adds = 0
        self.pyramidStop = None
        self.highWater = px
        self.entryCheck = entry_check
        self.entryDate = date
        self.fills = []


class Stock:
    __slots__ = ('sym', 'dates', 'o', 'h', 'l', 'c', 'v', 'coarse', 'n', 'ptr', 'lastClose', 'lastDate', 'pos',
                 'pending',
                 'soldAtClose', 'skipMark', 'series', 'k_of_daily', 'entry_fn', 'exit_fn', 'ma_fn', 'entry_memo')


def simulate(definition, stocks, date_from, date_to, capital, max_positions, end_date, rules, colcaches=None):
    """stocks: list of (symbol, daily_bars) with daily_bars already limited (and repaired) for the case.
    colcaches: optional {symbol: dict-like} indicator column caches (per data slice)."""
    tf = definition.get('timeframe', '1d')
    entry_def = definition.get('entry') or {}
    exit_def = definition.get('exit') or {}
    pyr = definition.get('pyramid') or {}
    sizing = definition.get('sizing') or {}

    trigger = entry_def.get('trigger', 'WHEN_TRUE')
    if trigger not in ('WHEN_TRUE', 'BECOMES_TRUE'):
        raise ValueError('unknown trigger %r' % (trigger,))
    tgt_pct = exit_def.get('targetPct')
    sl_pct = exit_def.get('stopLossPct')
    ts_pct = exit_def.get('trailingStopPct')
    price_base = exit_def.get('priceBase') or 'AVERAGE'
    if price_base not in ('AVERAGE', 'FIRST_BUY'):
        raise ValueError('unknown priceBase %r' % (price_base,))
    exit_group = exit_def.get('when')
    if not has_condition(exit_group):
        exit_group = None
    max_bars = exit_def.get('maxBars')
    pyr_on = bool(pyr.get('enabled'))
    max_adds = pyr.get('maxAdds')
    size_mode = sizing.get('mode')
    size_val = sizing.get('value')
    if size_mode not in ('AMOUNT', 'QUANTITY', 'PERCENT'):
        raise ValueError('unknown sizing mode %r' % (size_mode,))

    fill = rules.get('fill', 'NEXT_OPEN')
    if fill not in ('NEXT_OPEN', 'CLOSE'):
        raise ValueError('unknown fill %r' % (fill,))
    at_close = fill == 'CLOSE'
    stop_trigger = rules.get('stopTrigger', 'TOUCH')
    if stop_trigger not in ('TOUCH', 'CLOSE'):
        raise ValueError('unknown stopTrigger %r' % (stop_trigger,))
    touch_rule = stop_trigger == 'TOUCH'
    charges_on = bool(rules.get('charges'))
    slip = (rules.get('slippagePct') or 0) / 100

    def delivery(side, value):
        return delivery_charges(side, value) if charges_on else 0

    def intraday(side, value):
        return intraday_charges(side, value) if charges_on else 0

    # ---- per-stock setup (alphabetical) -------------------------------------------------------
    seen = set()
    sts = []
    for sym, bars in sorted(stocks, key=lambda t: t[0]):
        if sym in seen:
            continue
        seen.add(sym)
        s = Stock()
        s.sym = sym
        s.dates = bars['date']
        s.o, s.h, s.l, s.c = bars['open'], bars['high'], bars['low'], bars['close']
        s.v = bars['volume']
        s.n = len(s.dates)
        cache = {} if colcaches is None else colcaches.setdefault(sym, {})
        s.coarse = cache.get(('__coarse__',))
        if s.coarse is None:
            s.coarse = coarse_mask(bars)
            cache[('__coarse__',)] = s.coarse
        s.series = StrategySeries(sym, bars, tf, end_date, cache)
        s.k_of_daily = s.series.k_of_daily
        s.entry_fn = s.series.compile_group(entry_def.get('when') or {'type': 'AND', 'children': []})
        s.exit_fn = s.series.compile_group(exit_group) if exit_group is not None else None
        if pyr_on:
            s.ma_fn = s.series.reader({'kind': 'INDICATOR', 'indicator': pyr.get('maType'),
                                       'params': {'period': pyr.get('maPeriod')}, 'source': 'close'})
        else:
            s.ma_fn = None
        s.entry_memo = {}
        p = 0
        while p < s.n and s.dates[p] < date_from:
            p += 1
        s.ptr = p
        s.lastClose = s.c[p - 1] if p > 0 else None
        s.lastDate = None
        s.pos = None
        s.pending = None
        s.soldAtClose = None
        s.skipMark = {'ENTRY': None, 'ADD': None}
        sts.append(s)

    cal = sorted({d for s in sts for d in s.dates[s.ptr:] if d <= date_to})
    next_market_day = {cal[i]: cal[i + 1] for i in range(len(cal) - 1)}   # v2 market calendar

    cash = 0.0 if capital is None else float(capital)
    trades = []
    skipped = []
    curve = []

    # ---- helpers ----------------------------------------------------------------------------------
    def day_state(s):
        """Today's candle: 'NONE' (v3: volume not > 0, checked first), 'UP' / 'DOWN' (v2 circuit lock) or None."""
        i = s.ptr
        if not (s.v[i] > 0):
            return 'NONE'
        if s.coarse[i]:
            return None                            # v4: coarse (rounded) history is never circuit-locked
        if i >= 1 and s.h[i] == s.l[i]:
            c, pc = s.c[i], s.c[i - 1]
            if c > pc:
                return 'UP'
            if c < pc:
                return 'DOWN'
        return None

    def no_buy_category(s):
        """v3 noBuy: the skip category ('circuit' for UP, 'no-trades' for NONE) or None."""
        st = day_state(s)
        return 'no-trades' if st == 'NONE' else 'circuit' if st == 'UP' else None

    def no_sell(s):
        return day_state(s) in ('DOWN', 'NONE')

    def entry_value(s, k):
        m = s.entry_memo
        if k in m:
            return m[k]
        v = s.entry_fn(k)
        m[k] = v
        return v

    def entry_signal(s, k):
        if entry_value(s, k) is not TRUE:
            return False
        if trigger == 'WHEN_TRUE' or k == 0:
            return True
        return entry_value(s, k - 1) is not TRUE

    def base_of(p):
        return p.buyValue / p.qty if price_base == 'AVERAGE' else p.firstPrice

    def active_stop(p):
        best = None
        why = None
        if sl_pct is not None:
            best = base_of(p) * (1 - sl_pct / 100)
            why = 'STOP_LOSS'
        if ts_pct is not None:
            v = p.highWater * (1 - ts_pct / 100)
            if best is None or at_least(v, best):      # v6: a tie within the tolerance -> the later wins
                best, why = v, 'TRAILING_STOP'
        if p.pyramidStop is not None:
            v = p.pyramidStop
            if best is None or at_least(v, best):
                best, why = v, 'PYRAMID_STOP'
        return best, why

    def target_of(p):
        if tgt_pct is None:
            return None
        return ceil2(base_of(p) * (1 + tgt_pct / 100))

    def holding_count():
        return sum(1 for s in sts if s.pos is not None)

    def pending_count(kind):
        return sum(1 for s in sts if s.pending is not None and s.pending['type'] == kind)

    def equity_now():
        eq = cash
        for s in sts:
            if s.pos is not None:
                eq += s.pos.qty * s.lastClose
        return eq

    def skip(s, date, kind, category):
        if s.skipMark[kind] != category:
            s.skipMark[kind] = category
            skipped.append({'symbol': s.sym, 'date': date, 'kind': kind, 'category': category})

    def shares(px):
        if size_mode == 'QUANTITY':
            return math.floor(size_val)
        if size_mode == 'AMOUNT':
            return shares_from(size_val / px)
        return shares_from((equity_now() * size_val / 100) / px)

    def buy(s, raw, date, kind, signal_date, signal_check, stop_after=None):
        nonlocal cash
        px = ceil2(raw * (1 + slip))
        q = shares(px)
        if q < 1:
            skip(s, date, kind, 'size')
            return
        if kind == 'ENTRY' and max_positions is not None and holding_count() >= max_positions:
            skip(s, date, kind, 'max')
            return
        value = q * px
        ch = delivery('BUY', value)
        if capital is not None and value + ch > cash + 1e-9:
            skip(s, date, kind, 'cash')
            return
        cash -= value + ch
        s.skipMark[kind] = None
        if kind == 'ENTRY' or s.pos is None:
            s.pos = Position(px, signal_check, date)
        else:
            p = s.pos
            p.adds += 1
            p.lastBuyPrice = px
            if stop_after is not None:
                p.pyramidStop = stop_after
        p = s.pos
        p.qty += q
        p.buyValue += value
        p.charges += ch
        st, _ = active_stop(p)
        p.fills.append({'date': date, 'side': 'BUY', 'kind': kind, 'quantity': q, 'price': round2(px),
                        'charges': ch, 'signalDate': signal_date,
                        'stopAfter': None if st is None else round2(st)})

    def sell(s, raw, date, reason, signal_date, slippage):
        nonlocal cash
        p = s.pos
        px = floor2(raw * (1 - slip)) if slippage else raw
        qty = p.qty
        value = qty * px
        # v2: buys dated today are re-charged as intraday
        today_qty = 0
        for f in p.fills:
            if f['side'] == 'BUY' and f['date'] == date:
                today_qty += f['quantity']
                new = intraday('BUY', f['quantity'] * f['price'])
                old = f['charges']
                cash += old - new
                p.charges += new - old
                f['charges'] = new
        if today_qty == 0:
            ch = delivery('SELL', value)
        elif today_qty == qty:
            ch = intraday('SELL', value)
        else:
            ch = round2(intraday('SELL', today_qty * px) + delivery('SELL', (qty - today_qty) * px)) \
                if charges_on else 0
        cash += value - ch
        p.charges += ch
        p.fills.append({'date': date, 'side': 'SELL', 'kind': 'EXIT', 'quantity': qty, 'price': round2(px),
                        'charges': ch, 'signalDate': signal_date, 'stopAfter': None})
        net = value - p.buyValue - p.charges
        trades.append({
            'symbol': s.sym, 'entryDate': p.entryDate, 'exitDate': date, 'exitReason': reason,
            'quantity': qty, 'adds': p.adds, 'avgPrice': round2(p.buyValue / qty),
            'exitPrice': round2(px), 'invested': round2(p.buyValue), 'grossPnl': round2(value - p.buyValue),
            'charges': round2(p.charges), 'netPnl': round2(net), 'returnPct': round2(net / p.buyValue * 100),
            'holdingDays': _days_between(p.entryDate, date), 'fills': p.fills})
        s.pos = None   # sell() marks nothing else; only a 3a exit filled at the close sets soldAtClose

    def open_order_blocked(s, pd, date, kind, open_px):
        """v2 step-1 checks for ADD/ENTRY. Returns True (after recording the skip) if it must not fill."""
        nm = next_market_day.get(pd['signalDate'])
        if nm is not None and nm != date:
            skip(s, date, kind, 'lapsed')
            return True
        cat = no_buy_category(s)
        if cat is not None:
            skip(s, date, kind, cat)
            return True
        if kind == 'ADD' and at_most(open_px, pd['stopAfter']):
            skip(s, date, kind, 'gap')
            return True
        return False

    # ---- the calendar -----------------------------------------------------------------------------
    for date in cal:
        today = [s for s in sts if s.ptr < s.n and s.dates[s.ptr] == date]

        # Step 1: pending orders fill at today's open (three passes)
        if not at_close:
            for s in today:
                pd = s.pending
                if pd is not None and pd['type'] == 'EXIT':
                    if s.pos is None:
                        s.pending = None
                    elif no_sell(s):
                        pass                       # locked DOWN or NONE (v3): stays pending
                    else:
                        s.pending = None
                        sell(s, s.o[s.ptr], date, pd['reason'], pd['signalDate'], True)
            for s in today:
                pd = s.pending
                if pd is not None and pd['type'] == 'ADD':
                    s.pending = None
                    if s.pos is None:
                        continue
                    o = s.o[s.ptr]
                    if not open_order_blocked(s, pd, date, 'ADD', o):
                        buy(s, o, date, 'ADD', pd['signalDate'], pd['check'], pd['stopAfter'])
            for s in today:
                pd = s.pending
                if pd is not None and pd['type'] == 'ENTRY':
                    s.pending = None
                    if s.pos is not None:
                        continue
                    o = s.o[s.ptr]
                    if not open_order_blocked(s, pd, date, 'ENTRY', o):
                        buy(s, o, date, 'ENTRY', pd['signalDate'], pd['check'])

        # Step 2: during the day
        for s in today:
            p = s.pos
            if p is None:
                continue
            state = day_state(s)
            if state == 'NONE':
                continue                           # v3: no stop, no target, no highWater update
            i = s.ptr
            o, h, l = s.o[i], s.h[i], s.l[i]
            stop, why = active_stop(p)
            tgt = target_of(p)
            touch = touch_rule and state != 'DOWN'
            if touch and stop is not None and at_most(o, stop):
                sell(s, o, date, why, date, True)
            elif tgt is not None and at_least(o, tgt):
                sell(s, o, date, 'TARGET', date, False)
            elif touch and stop is not None and at_most(l, stop):
                sell(s, stop, date, why, date, True)
            elif tgt is not None and at_least(h, tgt):
                sell(s, tgt, date, 'TARGET', date, False)
            if s.pos is not None and h > p.highWater:
                p.highWater = h

        # Step 3: at the close
        for s in today:
            s.lastClose = s.c[s.ptr]
        checked = [s for s in today if s.k_of_daily[s.ptr] >= 0]

        # 3a exits
        stuck = set()                              # v3: at-close exit blocked by noSell -> no add either
        for s in checked:
            p = s.pos
            if p is None or s.pending is not None:
                continue
            k = s.k_of_daily[s.ptr]
            c = s.c[s.ptr]
            reason = None
            if not touch_rule:
                stop, why = active_stop(p)
                if stop is not None and below(c, stop):
                    reason = why
            if reason is None and s.exit_fn is not None and s.exit_fn(k) is TRUE:
                reason = 'EXIT_RULE'
            if reason is None and max_bars is not None and k - p.entryCheck >= max_bars:
                reason = 'TIME'
            if reason is not None:
                if at_close:
                    if no_sell(s):                     # v3: STUCK for this close
                        stuck.add(s.sym)
                    else:
                        sell(s, c, date, reason, date, True)
                        s.soldAtClose = date
                else:
                    s.pending = {'type': 'EXIT', 'signalDate': date, 'check': k, 'reason': reason}

        # 3b pyramiding (v2: tolerant)
        if pyr_on:
            for s in checked:
                p = s.pos
                if p is None or s.pending is not None or s.sym in stuck:
                    continue
                k = s.k_of_daily[s.ptr]
                c = s.c[s.ptr]
                ma = s.ma_fn(k)
                due = (ma == ma and at_least(ma, p.lastBuyPrice) and at_least(c, ma)
                       and (max_adds is None or p.adds < max_adds))
                if not due:
                    s.skipMark['ADD'] = None
                    continue
                if at_close:
                    cat = no_buy_category(s)
                    if cat is not None:
                        skip(s, date, 'ADD', cat)
                    else:
                        buy(s, c, date, 'ADD', date, k, ma)
                else:
                    s.pending = {'type': 'ADD', 'signalDate': date, 'check': k, 'stopAfter': ma}

        # 3c new buys
        for s in checked:
            if s.pos is not None or s.pending is not None or s.soldAtClose == date:
                continue
            k = s.k_of_daily[s.ptr]
            if not entry_signal(s, k):
                s.skipMark['ENTRY'] = None
                continue
            if at_close:
                cat = no_buy_category(s)
                if cat is not None:
                    skip(s, date, 'ENTRY', cat)
                else:
                    buy(s, s.c[s.ptr], date, 'ENTRY', date, k)
            else:
                if max_positions is not None and \
                        holding_count() - pending_count('EXIT') + pending_count('ENTRY') >= max_positions:
                    skip(s, date, 'ENTRY', 'max')
                    continue
                s.pending = {'type': 'ENTRY', 'signalDate': date, 'check': k}

        # Step 4
        for s in today:
            s.ptr += 1
            s.lastDate = date
        curve.append({'date': date, 'equity': round2(equity_now())})

    # ---- end of the period --------------------------------------------------------------------
    for s in sts:
        pd = s.pending
        if pd is not None and pd['type'] in ('ENTRY', 'ADD'):
            skipped.append({'symbol': s.sym, 'date': pd['signalDate'], 'kind': pd['type'], 'category': 'end'})
        if s.pos is not None and s.lastClose is not None:
            d = s.lastDate or date_to
            if pd is not None and pd['type'] == 'EXIT':
                sell(s, s.lastClose, d, pd['reason'], pd['signalDate'], False)
            else:
                sell(s, s.lastClose, d, 'END', d, False)
        s.pending = None
    if curve:
        curve[-1]['equity'] = round2(cash)

    return {'trades': trades, 'skipped': skipped, 'curve': curve}
