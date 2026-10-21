"""
Download daily candles for every stock in universe.json from Yahoo Finance (independent of Kite) into OUT_DIR,
one JSON file per stock (& → _AND_), ending at a FIXED date so runs are reproducible:
  python3 checks/fetch_yahoo.py UNIVERSE.json OUT_DIR [END yyyy-mm-dd]      (skips files already there)
Yahoo's split-adjusted prices are rounded to paise; its quirks (zero-volume filler days, the odd bad tick) are kept —
they exercise the engine's data handling.
"""
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request

universe, out_dir = sys.argv[1], sys.argv[2]
end = sys.argv[3] if len(sys.argv) > 3 else '2026-10-16'
period2 = int((datetime.datetime.fromisoformat(end) + datetime.timedelta(days=1)).replace(tzinfo=datetime.timezone.utc).timestamp())
os.makedirs(out_dir, exist_ok=True)
ok = failed = 0
for s in json.load(open(universe)):
    out = os.path.join(out_dir, s.replace('&', '_AND_') + '.json')
    if os.path.exists(out):
        ok += 1
        continue
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(s + '.NS')}?period1=0&period2={period2}&interval=1d"
    try:
        j = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30))['chart']['result'][0]
        q = j['indicators']['quote'][0]
        rows = {}
        for i, t in enumerate(j.get('timestamp') or []):
            o, h, l, c, v = q['open'][i], q['high'][i], q['low'][i], q['close'][i], q['volume'][i]
            if None in (o, h, l, c) or min(o, h, l, c) <= 0:
                continue
            d = datetime.datetime.fromtimestamp(t + 19800, datetime.timezone.utc).strftime('%Y-%m-%d')
            if d <= end:
                rows[d] = (round(o, 2), round(h, 2), round(l, 2), round(c, 2), v or 0)
        ds = sorted(rows)
        with open(out, 'w') as f:
            json.dump({'symbol': s, 'date': ds, **{k: [rows[d][n] for d in ds] for n, k in enumerate(['open', 'high', 'low', 'close', 'volume'])}}, f)
        ok += 1
    except Exception as e:  # keep going; the run reports which stocks are missing
        failed += 1
        print(f'  {s}: {e}', file=sys.stderr)
    time.sleep(0.4)
print(f'candles: {ok} stocks ready, {failed} failed')
sys.exit(1 if failed else 0)
