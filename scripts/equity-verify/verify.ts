/**
 * Proves the equity backtest right — run it after ANY change to src/server/equity/engine/ or the equity rules:
 *
 *   npm run verify:equity                          # ~5 minutes: 5 profiles × 400 random strategies
 *   npm run verify:equity -- --quick               # ~1 minute: 5 profiles × 80
 *   npm run verify:equity -- --cases 2000 --seed 7 --profiles mixed,edge
 *   npm run verify:equity -- --fetch-kite          # first fetch real Kite candles for the "kite" profile
 *
 * 1. the reference implementation's own tests (oracle/test_oracle.py — hand-worked numbers);
 * 2. random strategies covering every builder input (cases.ts), run by the PRODUCTION engine and by the reference
 *    implementation written from SPEC.md alone → every trade, order, charge, skipped signal and daily value must
 *    be identical (checks/compare.py);
 * 3. rules every correct backtest obeys — money adds up, real prices, Zerodha charges… (checks/invariants.py);
 * 4. every results-page figure recomputed independently (checks/figures.py);
 * 5. every indicator value, candle by candle, against the reference implementation (checks/columns.py).
 * Exit code 1 if anything differs. Candles (Yahoo, and Kite with --fetch-kite) live in $EQUITY_VERIFY_DIR
 * (default ~/.cache/algo-hunt-verify), never in git; they end on a fixed date so runs are reproducible.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_END, fileOf, generateCases, type Profile } from './cases';
import { engineFigures, runEngine, writeColumns } from './engine';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.EQUITY_VERIFY_DIR || path.join(os.homedir(), '.cache', 'algo-hunt-verify');
const DATA = path.join(DIR, 'data');
const KDATA = path.join(DIR, 'kdata');
const RUNS = path.join(DIR, 'runs');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const quick = flag('quick');
const count = Number(option('cases', quick ? '80' : '400'));
const seed = Number(option('seed', '1'));
const profiles = option('profiles', 'mixed,product,small,edge,kite').split(',') as Profile[];

const env = { ...process.env, EQUITY_VERIFY_DIR: DIR, PYTHONDONTWRITEBYTECODE: '1' };
const results: Array<{ step: string; ok: boolean; line: string }> = [];

/** Run a command; its last lines are the step's summary. */
function run(step: string, cmd: string, cmdArgs: string[], opts: { quiet?: boolean } = {}): boolean {
  const t0 = Date.now();
  const r = spawnSync(cmd, cmdArgs, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const ok = r.status === 0;
  const lines = out.split('\n');
  const shown = ok || opts.quiet ? lines.slice(-1) : lines.slice(-25);
  console.log(`${ok ? '✓' : '✗'} ${step} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n    ${shown.join('\n    ')}`);
  results.push({ step, ok, line: shown[0] ?? '' });
  return ok;
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, JSON.stringify(value));
}

function main() {
  fs.mkdirSync(RUNS, { recursive: true });
  if (spawnSync('python3', ['--version']).status !== 0) {
    console.error('python3 is needed for the reference implementation (standard library only).');
    process.exit(1);
  }
  const universe = JSON.parse(fs.readFileSync(path.join(KIT, 'universe.json'), 'utf8')) as string[];
  if (universe.some((s) => !fs.existsSync(fileOf(DATA, s)))) run('download candles (Yahoo, independent of Kite)', 'python3', [path.join(KIT, 'checks', 'fetch_yahoo.py'), path.join(KIT, 'universe.json'), DATA]);
  if (flag('fetch-kite')) run('fetch candles from Kite', 'npx', ['tsx', path.join(KIT, 'kite-fetch.ts')]);
  const have = universe.filter((s) => fs.existsSync(fileOf(DATA, s)));
  if (have.length < universe.length * 0.9) {
    console.error(`Only ${have.length} of ${universe.length} stocks' candles are available — check the network and run again.`);
    process.exit(1);
  }

  run('reference implementation: its own hand-worked tests', 'python3', [path.join(KIT, 'oracle', 'test_oracle.py')], { quiet: true });

  profiles.forEach((profile, i) => {
    const kite = profile === 'kite';
    const kiteStocks = kite && fs.existsSync(KDATA) ? fs.readdirSync(KDATA).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5).replace(/_AND_/g, '&')) : [];
    if (kite && !kiteStocks.length) {
      console.log('– kite profile skipped: no Kite candles yet (run with --fetch-kite while logged in to Kite)');
      return;
    }
    const t0 = Date.now();
    const cases = generateCases({ seed: seed * 100 + i, count, profile, dataDir: kite ? KDATA : DATA, universe: kite ? kiteStocks : have });
    const files = { cases: path.join(RUNS, `${profile}-cases.json`), engine: path.join(RUNS, `${profile}-engine.json`), oracle: path.join(RUNS, `${profile}-oracle.json`) };
    writeJson(files.cases, cases);
    writeJson(files.engine, runEngine(cases));
    console.log(`· ${profile}: ${cases.length} strategies through the production engine (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    if (run(`${profile}: reference implementation`, 'python3', [path.join(KIT, 'oracle', 'run.py'), files.cases, files.oracle], { quiet: true }))
      run(`${profile}: engine = reference, order by order`, 'python3', [path.join(KIT, 'checks', 'compare.py'), files.cases, files.engine, files.oracle]);
    run(`${profile}: invariants`, 'python3', [path.join(KIT, 'checks', 'invariants.py'), files.cases, files.engine]);
  });

  const figureCases = generateCases({ seed: seed * 100 + 99, count: quick ? 60 : 300, profile: 'mixed', dataDir: DATA, universe: have });
  const figures = path.join(RUNS, 'figures.json');
  writeJson(figures, engineFigures(figureCases));
  run('results-page figures recomputed independently', 'python3', [path.join(KIT, 'checks', 'figures.py'), figures]);

  const step = Math.max(1, Math.floor(have.length / (quick ? 5 : 20)));
  const columns = path.join(RUNS, 'columns.jsonl');
  writeColumns(DATA, have.filter((_, i) => i % step === 0), columns);
  run('indicator values, candle by candle', 'python3', [path.join(KIT, 'checks', 'columns.py'), columns, DATA, DATA_END]);

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n✗ ${failed.length} of ${results.length} checks FAILED: ${failed.map((r) => r.step).join(' · ')}` : `\n✓ all ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
