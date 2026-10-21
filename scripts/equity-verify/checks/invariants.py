"""
Rules every correct backtest obeys, whatever the strategy — checked on the production engine's output alone:
  python3 checks/invariants.py CASES.json ENGINE.json        (exit 1 if any rule breaks)

Money adds up (final value = capital + Σ net P&L; net = gross − charges; invested = Σ shares × price), prices are
whole paise inside the day's real range (± slippage), next-open fills come at the next candle's open, charges follow
Zerodha's schedule (intraday for a lot bought and sold the same day), no overlapping positions in a stock, never more
stocks held than allowed, cash never negative, exits only for configured reasons.
"""
import collections
import datetime
import json
import math
import sys

cases = {c['id']: c for c in json.load(open(sys.argv[1]))}
outs = json.load(open(sys.argv[2]))
files = {}


def candles(c, sym):
    """{date: (open, high, low, close, volume)} with bad ticks repaired like the engine, and the date list."""
    key = (c['dataDir'], sym)
    if key not in files:
        j = json.load(open(f"{c['dataDir']}/{sym.replace('&', '_AND_')}.json"))
        rows = {}
        for i, d in enumerate(j['date']):
            o, h, l, cl = j['open'][i], j['high'][i], j['low'][i], j['close'][i]
            rows[d] = (o, max(o, h, l, cl), min(o, h, l, cl), cl, j['volume'][i])
        files[key] = rows, j['date']
    return files[key]


def r2(x):
    return math.floor(x * 100 + 0.5) / 100


def ceil2(x):
    return math.ceil(x * 100 - 1e-6) / 100


def floor2(x):
    return math.floor(x * 100 + 1e-6) / 100


def charges(side, value, intraday=False):
    if value <= 0:
        return 0
    ex = value * 0.0000307
    sebi = value * 10 / 1e7
    if intraday:
        brk = min(value * 0.0003, 20)
        stt = value * 0.00025 if side == 'SELL' else 0
        stamp = value * 0.00003 if side == 'BUY' else 0
        return r2(brk + stt + ex + sebi + stamp + 0.18 * (brk + ex + sebi))
    stt = value * 0.001
    stamp = value * 0.00015 if side == 'BUY' else 0
    dp = 15.34 if side == 'SELL' else 0
    return r2(stt + ex + sebi + stamp + dp + 0.18 * (ex + sebi))


problems = collections.Counter()
examples = {}


def bad(kind, cid, msg):
    problems[kind] += 1
    examples.setdefault(kind, f"{cid}: {msg}")


checked = 0
for o in outs:
    c = cases[o['id']]
    if 'error' in o:
        bad('engine error', o['id'], o['error'][:200])
        continue
    checked += 1
    rules = c['rules']
    slip = rules['slippagePct'] / 100
    trades = o['trades']
    if c['capital'] is not None and o['curve']:
        final = o['curve'][-1]['equity']
        expect = c['capital'] + sum(t['netPnl'] for t in trades)
        if abs(final - expect) > 0.011 * max(1, len(trades)):
            bad('final value != capital + net P&L', o['id'], f"final {final} vs {expect:.2f}")
    held_by_day = collections.Counter()
    by_sym = collections.defaultdict(list)
    for t in trades:
        by_sym[t['symbol']].append(t)
        bars, dates = candles(c, t['symbol'])
        idx = {d: i for i, d in enumerate(dates)}
        buys = [f for f in t['fills'] if f['side'] == 'BUY']
        sells = [f for f in t['fills'] if f['side'] == 'SELL']
        qty = sum(f['quantity'] for f in buys)
        if len(sells) != 1 or t['fills'][-1]['side'] != 'SELL':
            bad('a trade must end with exactly one sale', o['id'], t['symbol'])
            continue
        sale = sells[0]
        if abs(t['netPnl'] - (t['grossPnl'] - t['charges'])) > 0.011:
            bad('net != gross − charges', o['id'], t['symbol'])
        if abs(t['charges'] - sum(f['charges'] for f in t['fills'])) > 0.011 * len(t['fills']):
            bad('trade charges != sum of its orders', o['id'], t['symbol'])
        if qty != t['quantity'] or sale['quantity'] != qty:
            bad('shares bought != shares sold', o['id'], t['symbol'])
        if t['adds'] != len(buys) - 1:
            bad('adds != buys − 1', o['id'], t['symbol'])
        if abs(sum(f['quantity'] * f['price'] for f in buys) - t['invested']) > 0.011:
            bad('invested != Σ shares × price', o['id'], t['symbol'])
        if abs(t['avgPrice'] - t['invested'] / qty) > 0.011:
            bad('average != invested / shares', o['id'], t['symbol'])
        if abs(t['grossPnl'] - (qty * t['exitPrice'] - t['invested'])) > 0.021:
            bad('gross != shares × sale price − invested', o['id'], t['symbol'])
        if abs(t['returnPct'] - t['netPnl'] / t['invested'] * 100) > 0.011 + 0.5 / t['invested']:
            bad('return % != net / invested', o['id'], t['symbol'])
        if t['holdingDays'] != (datetime.date.fromisoformat(t['exitDate']) - datetime.date.fromisoformat(t['entryDate'])).days:
            bad('holding days wrong', o['id'], t['symbol'])
        if t['entryDate'] != buys[0]['date'] or t['exitDate'] != sale['date']:
            bad('trade dates != order dates', o['id'], t['symbol'])
        # the period's last close values a position still held (or one whose sale waited to the end)
        end_valued = t['exitReason'] == 'END' or 'at the last close' in sale.get('reason', '')
        for f in t['fills']:
            if abs(f['price'] * 100 - round(f['price'] * 100)) > 1e-6:
                bad('price not in whole paise', o['id'], f"{t['symbol']} {f['date']} {f['price']}")
            if not c['from'] <= f['date'] <= c['to']:
                bad('order outside the period', o['id'], f"{t['symbol']} {f['date']}")
            if f['date'] not in bars:
                bad('order on a day without a candle', o['id'], f"{t['symbol']} {f['date']}")
                continue
            op, hi, lo, cl, vol = bars[f['date']]
            if not (lo * (1 - slip) - 0.011 <= f['price'] <= hi * (1 + slip) + 0.011) and not (f is sale and end_valued):
                bad("price outside the day's range (± slippage)", o['id'], f"{t['symbol']} {f['date']} {f['side']} {f['price']} not in [{lo}, {hi}]")
            if rules['charges']:
                if f['side'] == 'BUY':
                    want = charges('BUY', f['quantity'] * f['price'], f['date'] == sale['date'])
                else:
                    tq = sum(b['quantity'] for b in buys if b['date'] == f['date'])
                    dq = f['quantity'] - tq
                    want = charges('SELL', dq * f['price']) if tq == 0 else charges('SELL', tq * f['price'], True) if dq == 0 \
                        else r2(charges('SELL', tq * f['price'], True) + charges('SELL', dq * f['price']))
                if abs(f['charges'] - want) > 0.011:
                    bad("charges != Zerodha's schedule", o['id'], f"{t['symbol']} {f['side']} {f['date']} {f['charges']} vs {want}")
            elif f['charges'] != 0:
                bad('charges while charges are off', o['id'], t['symbol'])
            if f['signalDate'] > f['date']:
                bad('order before its signal', o['id'], t['symbol'])
            if rules['fill'] == 'NEXT_OPEN' and f['signalDate'] != f['date'] and not (f is sale and end_valued):
                si, fi = idx.get(f['signalDate']), idx.get(f['date'])
                # a sale may wait through candles nobody could sell on (lower circuit / zero volume)
                waited = f['side'] == 'SELL' and si is not None and fi is not None and all(
                    bars[dates[k]][1] == bars[dates[k]][2] or not bars[dates[k]][4] > 0 for k in range(si + 1, fi))
                if (si is None or fi != si + 1) and not waited:
                    bad('next-open order not filled at the next candle', o['id'], f"{t['symbol']} signal {f['signalDate']} order {f['date']}")
                want = ceil2(op * (1 + slip)) if f['side'] == 'BUY' else floor2(op * (1 - slip))
                if abs(f['price'] - want) > 0.0001:
                    bad("next-open order not at the open (± slippage)", o['id'], f"{t['symbol']} {f['date']} {f['price']} vs open {op}")
        ex = c['definition']['exit']
        configured = {'STOP_LOSS': ex['stopLossPct'], 'TRAILING_STOP': ex['trailingStopPct'], 'TARGET': ex['targetPct'],
                      'PYRAMID_STOP': c['definition']['pyramid']['enabled'], 'TIME': ex['maxBars'], 'EXIT_RULE': ex['when']}
        if t['exitReason'] in configured and configured[t['exitReason']] in (None, False):
            bad('exit reason not configured', o['id'], f"{t['symbol']} {t['exitReason']}")
        for d in dates:
            if t['entryDate'] <= d < t['exitDate']:
                held_by_day[d] += 1
    for sym, ts in by_sym.items():
        ts = sorted(ts, key=lambda t: t['entryDate'])
        for a, b in zip(ts, ts[1:]):
            if b['entryDate'] < a['exitDate']:
                bad('overlapping positions in one stock', o['id'], f"{sym} {a['entryDate']}..{a['exitDate']} and {b['entryDate']}")
    if c['maxPositions'] is not None and held_by_day and max(held_by_day.values()) > c['maxPositions']:
        bad('more stocks held than the maximum', o['id'], f"{max(held_by_day.values())} > {c['maxPositions']}")
    max_adds = c['definition']['pyramid']['maxAdds']
    if max_adds is not None and any(t['adds'] > max_adds for t in trades):
        bad('more adds than max adds', o['id'], '')
    if c['capital'] is not None:
        events = []
        for t in trades:
            for f in t['fills']:
                v = f['quantity'] * f['price']
                events.append((f['date'], 0 if f['side'] == 'SELL' else 1, (v - f['charges']) if f['side'] == 'SELL' else -(v + f['charges'])))
        cash = c['capital']
        worst = cash
        for _, _, delta in sorted(events):
            cash += delta
            worst = min(worst, cash)
        if worst < -0.011 * max(1, len(trades)):
            bad('cash went negative', o['id'], f"lowest {worst:.2f}")
    ds = [p['date'] for p in o['curve']]
    if ds != sorted(set(ds)) or (ds and (ds[0] < c['from'] or ds[-1] > c['to'])):
        bad('daily values not unique / sorted / inside the period', o['id'], '')

print(f"invariants: {checked} backtests, {sum(len(o.get('trades', [])) for o in outs)} trades — " + ('all hold' if not problems else f"{sum(problems.values())} broken"))
for k, n in problems.most_common():
    print(f"  {n:6}  {k}\n          e.g. {examples[k]}")
sys.exit(1 if problems else 0)
