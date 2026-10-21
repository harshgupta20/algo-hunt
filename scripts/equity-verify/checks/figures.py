"""
Recompute every results-page figure independently from a backtest's daily account values and trades — final value,
net P&L, return, CAGR, max drawdown (% and ₹), monthly / yearly returns, win rate, profit factor, average win / loss,
expectancy, holding days, best / worst trade, charges, adds, exposure, per-stock totals — and compare:
  python3 checks/figures.py FIGURES.json        (exit 1 on any difference)
"""
import json, sys, math, datetime, collections
rows = json.load(open(sys.argv[1]))
def close(a, b, tol):
    if a is None or b is None: return a is None and b is None
    return abs(a - b) <= tol
bad = collections.Counter(); ex = {}
def flag(k, cid, msg):
    bad[k] += 1; ex.setdefault(k, f"{cid}: {msg}")
for r in rows:
    f, cap, curve, trades = r['figures'], r['capital'], r['curve'], r['trades']
    if not curve: continue
    final = curve[-1]['equity']
    start = cap if cap is not None else 0
    if not close(f['netPnl'], final - start, 0.011): flag('net P&L', r['id'], (f['netPnl'], final - start))
    if cap is not None:
        if not close(f['returnPct'], (final - cap) / cap * 100, 0.011): flag('return %', r['id'], (f['returnPct'], (final - cap) / cap * 100))
        peak = cap; mdd = 0; mdda = 0
        for p in curve:
            peak = max(peak, p['equity']); mdd = min(mdd, (p['equity'] - peak) / peak * 100 if peak > 0 else 0); mdda = min(mdda, p['equity'] - peak)
        if not close(f['maxDrawdownPct'], round(mdd, 2), 0.011): flag('max drawdown %', r['id'], (f['maxDrawdownPct'], mdd))
        if not close(f['maxDrawdown'], round(mdda, 2), 0.011): flag('max drawdown ₹', r['id'], (f['maxDrawdown'], mdda))
        d0 = datetime.date.fromisoformat(curve[0]['date']); d1 = datetime.date.fromisoformat(curve[-1]['date'])
        years = (d1 - d0).days / 365.25
        cagr = None if years < 30 / 365.25 or final <= 0 else ((final / cap) ** (1 / years) - 1) * 100
        if not close(f['cagrPct'], None if cagr is None else round(cagr, 2), 0.011): flag('CAGR', r['id'], (f['cagrPct'], cagr))
        for key, n in (('monthly', 7), ('yearly', 4)):
            want = []; prev = cap
            for i, p in enumerate(curve):
                k = p['date'][:n]
                if i == len(curve) - 1 or curve[i + 1]['date'][:n] != k:
                    want.append((k, round((p['equity'] / prev - 1) * 100, 2) if prev > 0 else 0)); prev = p['equity']
            got = [(m['month' if key == 'monthly' else 'year'], m['returnPct']) for m in f[key]]
            if [g[0] for g in got] != [w[0] for w in want] or any(not close(g[1], w[1], 0.011) for g, w in zip(got, want)):
                flag(f'{key} returns', r['id'], next(((g, w) for g, w in zip(got, want) if g != w), (len(got), len(want))))
    s = f['stats']; nets = [t['netPnl'] for t in trades]
    wins = [t for t in trades if t['netPnl'] > 0]; losses = [t for t in trades if t['netPnl'] <= 0]
    gp = sum(t['netPnl'] for t in wins); gl = -sum(t['netPnl'] for t in losses)
    want = {
        'trades': len(trades), 'wins': len(wins), 'losses': len(losses),
        'winRate': round(len(wins) / len(trades) * 100, 2) if trades else 0,
        'profitFactor': round(gp / gl, 2) if gl > 0 else (None if gp > 0 else 0),
        'expectancy': round(sum(nets) / len(nets), 2) if nets else 0,
        'avgHoldingDays': round(sum(t['holdingDays'] for t in trades) / len(trades), 2) if trades else 0,
        'bestTrade': round(max(nets), 2) if nets else 0, 'worstTrade': round(min(nets), 2) if nets else 0,
        'charges': round(sum(t['charges'] for t in trades), 2), 'adds': sum(t['adds'] for t in trades),
        'avgWinPct': round(sum(t['returnPct'] for t in wins) / len(wins), 2) if wins else None,
        'avgLossPct': round(sum(t['returnPct'] for t in losses) / len(losses), 2) if losses else None,
    }
    for k, v in want.items():
        if not close(s[k], v, 0.011 if k not in ('charges',) else 0.011 * max(1, len(trades))): flag(f'stats.{k}', r['id'], (s[k], v))
    # exposure: days whose close found at least one stock held
    held = 0
    for p in curve:
        d = p['date']
        if any(t['entryDate'] <= d < t['exitDate'] or (t['endSale'] and t['entryDate'] <= d <= t['exitDate']) for t in trades): held += 1
    if not close(s['exposurePct'], round(held / len(curve) * 100, 2), 0.011): flag('stats.exposurePct', r['id'], (s['exposurePct'], held / len(curve) * 100))
    by = collections.defaultdict(list)
    for t in trades: by[t['symbol']].append(t)
    for ps in f['perSymbol']:
        ts = by.get(ps['symbol'], [])
        if ps['trades'] != len(ts) or not close(ps['netPnl'], round(sum(t['netPnl'] for t in ts), 2), 0.011 * max(1, len(ts))): flag('per-stock totals', r['id'], ps['symbol'])
print(f"figures: {len(rows)} backtests recomputed — " + ('all match' if not bad else f"{sum(bad.values())} differ"))
for k, n in bad.most_common():
    print(f"  {n:5} {k}: e.g. {ex[k]}")
sys.exit(1 if bad else 0)
