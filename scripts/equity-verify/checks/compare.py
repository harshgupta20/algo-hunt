"""
Diff the production engine's output against the reference implementation's, case by case — every trade (dates,
reason, shares, adds, prices, money), every order (date, side, kind, shares, signal date, price, charges, stop),
every skipped signal and every day's account value:
  python3 checks/compare.py CASES.json ENGINE.json ORACLE.json [--show N]     (exit 1 unless all identical)
"""
import json, sys, collections

cases = {c['id']: c for c in json.load(open(sys.argv[1]))}
eng = {o['id']: o for o in json.load(open(sys.argv[2]))}
orc = {o['id']: o for o in json.load(open(sys.argv[3]))}
show = int(sys.argv[sys.argv.index('--show') + 1]) if '--show' in sys.argv else 5

MONEY = ['avgPrice', 'exitPrice', 'invested', 'grossPnl', 'charges', 'netPnl', 'returnPct']
EXACT = ['symbol', 'entryDate', 'exitDate', 'exitReason', 'quantity', 'adds', 'holdingDays']
FILL_EXACT = ['date', 'side', 'kind', 'quantity', 'signalDate']
FILL_MONEY = ['price', 'charges', 'stopAfter']

def close(a, b, tol=0.011):
    if a is None or b is None: return a is None and b is None
    return abs(a - b) <= tol + 1e-9 * max(abs(a), abs(b))

def trade_key(t): return (t['exitDate'], t['symbol'], t['entryDate'])

def diff_case(e, o):
    if 'error' in e or 'error' in o:
        return 'error', f"engine: {e.get('error', '')[:300]} | oracle: {o.get('error', '')[:300]}"
    et = sorted(e['trades'], key=trade_key); ot = sorted(o['trades'], key=trade_key)
    for i in range(max(len(et), len(ot))):
        a = et[i] if i < len(et) else None; b = ot[i] if i < len(ot) else None
        if a is None or b is None:
            return 'trade count', f"engine {len(et)} trades, oracle {len(ot)}; first unmatched: {json.dumps({k: (a or b)[k] for k in EXACT})} ({'engine only' if a else 'oracle only'})"
        for k in EXACT:
            if a[k] != b[k]:
                return f'trade.{k}', f"trade {i}: engine {json.dumps({x: a[x] for x in EXACT})}\n          oracle {json.dumps({x: b[x] for x in EXACT})}"
        for k in MONEY:
            tol = 0.011 if k != 'returnPct' else 0.011 + 0.5 / max(a['invested'], 1e-9)
            if not close(a[k], b[k], tol if k not in ('invested', 'grossPnl', 'charges', 'netPnl') else 0.011 * (1 + a['adds'])):
                return f'trade.{k}', f"{a['symbol']} {a['entryDate']}→{a['exitDate']}: engine {k}={a[k]} oracle {b[k]}"
        if len(a['fills']) != len(b['fills']):
            return 'fill count', f"{a['symbol']} {a['entryDate']}: engine {len(a['fills'])} fills, oracle {len(b['fills'])}"
        for fa, fb in zip(a['fills'], b['fills']):
            for k in FILL_EXACT:
                if fa[k] != fb[k]:
                    return f'fill.{k}', f"{a['symbol']}: engine {json.dumps({x: fa[x] for x in FILL_EXACT + FILL_MONEY})}\n          oracle {json.dumps({x: fb[x] for x in FILL_EXACT + FILL_MONEY})}"
            for k in FILL_MONEY:
                if not close(fa[k], fb[k]):
                    return f'fill.{k}', f"{a['symbol']} {fa['date']} {fa['side']}: engine {k}={fa[k]} oracle {fb[k]}"
    es = sorted((s['symbol'], s['date'], s['kind'], s['category']) for s in e['skipped'])
    os_ = sorted((s['symbol'], s['date'], s['kind'], s['category']) for s in o['skipped'])
    if es != os_:
        only_e = sorted(set(es) - set(os_))[:3]; only_o = sorted(set(os_) - set(es))[:3]
        return 'skipped', f"engine only {only_e} | oracle only {only_o}"
    ec = e['curve']; oc = o['curve']
    if len(ec) != len(oc):
        return 'curve length', f"engine {len(ec)} oracle {len(oc)}"
    for pa, pb in zip(ec, oc):
        if pa['date'] != pb['date'] or not close(pa['equity'], pb['equity'], 0.02):
            return 'curve', f"{pa['date']}: engine {pa['equity']} oracle {pb['equity']} (oracle date {pb['date']})"
    return None, None

kinds = collections.Counter(); samples = collections.defaultdict(list)
ok = 0; trades = 0
for cid, e in eng.items():
    o = orc.get(cid)
    if o is None:
        kinds['missing in oracle'] += 1; continue
    trades += len(e.get('trades', []))
    k, msg = diff_case(e, o)
    if k is None: ok += 1
    else:
        kinds[k] += 1
        if len(samples[k]) < show: samples[k].append(f"{cid}: {msg}")
print(f"compare: {ok}/{len(eng)} backtests identical ({trades} trades)")
for k, n in kinds.most_common():
    print(f"  {n:5}  {k}")
    for s in samples[k]: print(f"         {s}")
sys.exit(0 if ok == len(eng) and eng else 1)
