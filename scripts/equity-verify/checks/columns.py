"""
Compare the production engine's indicator values with the reference implementation's, candle by candle:
  python3 checks/columns.py COLUMNS.jsonl DATA_DIR END   (exit 1 if any differs by more than 1e-9 relative)
END = the candles' last date (the engine side was cut there too).
"""
import collections
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'oracle'))
from evaluate import daily_bars, build_weekly  # noqa: E402
from indicators import operand_column  # noqa: E402

DATA, END = sys.argv[2], sys.argv[3]
bars = {}
worst = collections.defaultdict(lambda: [0.0, '', 0, 0])  # label -> [max rel diff, where, values, na mismatches]
n = 0
for line in open(sys.argv[1]):
    r = json.loads(line); n += 1
    key = (r['symbol'], r['tf'])
    if key not in bars:
        raw = json.load(open(os.path.join(DATA, r['symbol'].replace('&', '_AND_') + '.json')))
        d = daily_bars(raw, None, END)
        bars[(r['symbol'], '1d')] = d
        bars[(r['symbol'], '1w')] = build_weekly(d, END)
    o = operand_column(bars[key], r['operand'])
    e = r['values']
    label = f"{r['tf']} {json.dumps(r['operand'], separators=(',', ':'))}"
    w = worst[label]
    if len(o) != len(e):
        w[1] = f"LENGTH {r['symbol']} {len(e)} vs {len(o)}"; w[0] = math.inf; continue
    for i, (a, b) in enumerate(zip(e, o)):
        bn = b is None or (isinstance(b, float) and math.isnan(b))
        if a is None or bn:
            if (a is None) != bn: w[3] += 1; w[1] = w[1] or f"NA {r['symbol']} i={i} engine {a} oracle {b}"
            continue
        w[2] += 1
        rel = abs(a - b) / max(1.0, abs(a), abs(b))
        if rel > w[0]: w[0] = rel; w[1] = f"{r['symbol']} {bars[key]['date'][i]} engine {a} oracle {b}"
bad = [(label, w) for label, w in worst.items() if w[0] > 1e-9 or w[3]]
values = sum(w[2] for w in worst.values())
print(f"columns: {n} indicator columns, {values} values — " + ('all match' if not bad else f"{len(bad)} columns differ") + f" (largest gap {max((w[0] for w in worst.values()), default=0):.1e} relative)")
for label, (m, where, cnt, nas) in bad:
    print(f"  max rel diff {m:.1e}  na-mismatch {nas}  {label}  {where}")
sys.exit(1 if bad else 0)
