"""CLI: python3 -I oracle/run.py CASES.json OUT.json [--base DIR]

CASES.json = list of {id, definition, symbols, dataDir, from, to, capital, maxPositions, endDate, rules,
dataFrom?}. Candle rows kept: date <= endDate and (date >= dataFrom when dataFrom is given).
OUT.json = list of {id, trades, skipped, curve, error?}. One failing case never stops the batch.
A relative dataDir is resolved against --base (default: the current directory).
"""
import json
import os
import sys
import time
import traceback
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from evaluate import daily_bars  # noqa: E402
from simulate import simulate  # noqa: E402


class LRU(OrderedDict):
    """Bounded dict; .get/[]= refresh recency."""

    def __init__(self, cap):
        super().__init__()
        self.cap = cap

    def get(self, key, default=None):
        if key in self:
            self.move_to_end(key)
            return self[key]
        return default

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        self.move_to_end(key)
        while len(self) > self.cap:
            self.popitem(last=False)


# Caches survive across cases of one batch (indicator columns are pure functions of the data slice).
_slices = LRU(150)     # (path, dataFrom, endDate) -> (daily bars, per-slice column LRU)
COLS_PER_SLICE = 16    # indicator columns (array('d')) kept per slice; weekly bars count as one


def _load_raw(path):
    with open(path) as f:
        return json.load(f)


def load_slice(data_dir, symbol, data_from, end_date):
    path = os.path.join(data_dir, symbol.replace('&', '_AND_') + '.json')
    key = (os.path.abspath(path), data_from, end_date)
    hit = _slices.get(key)
    if hit is None:
        raw = _load_raw(path)
        hit = (daily_bars(raw, data_from, end_date), LRU(COLS_PER_SLICE))
        _slices[key] = hit
    return hit


def run_case(case, base_dir):
    data_dir = case.get('dataDir') or 'data'
    if not os.path.isabs(data_dir):
        data_dir = os.path.join(base_dir, data_dir)
    end_date = case['endDate']
    data_from = case.get('dataFrom')
    stocks = []
    caches = {}
    for sym in case['symbols']:
        bars, cache = load_slice(data_dir, sym, data_from, end_date)
        stocks.append((sym, bars))
        caches[sym] = cache
    res = simulate(case['definition'], stocks, case['from'], case['to'], case.get('capital'),
                   case.get('maxPositions'), end_date, case.get('rules') or {}, caches)
    return {'id': case.get('id'), **res}


def main(argv):
    if len(argv) < 3:
        print('usage: python3 -I oracle/run.py CASES.json OUT.json [--base DIR]', file=sys.stderr)
        return 2
    cases_path, out_path = argv[1], argv[2]
    base_dir = os.getcwd()
    if '--base' in argv:
        base_dir = argv[argv.index('--base') + 1]
    with open(cases_path) as f:
        cases = json.load(f)
    out = []
    t0 = time.time()
    n_err = 0
    for case in cases:
        try:
            out.append(run_case(case, base_dir))
        except Exception as e:  # never crash the batch
            n_err += 1
            out.append({'id': case.get('id') if isinstance(case, dict) else None, 'trades': [], 'skipped': [],
                        'curve': [], 'error': '%s: %s' % (type(e).__name__, e),
                        'traceback': traceback.format_exc(limit=3)})
    text = json.dumps(out)  # one-shot dumps uses the C encoder (json.dump to a file does not)
    with open(out_path, 'w') as f:
        f.write(text)
    print('cases %d  errors %d  %.2fs' % (len(cases), n_err, time.time() - t0), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
