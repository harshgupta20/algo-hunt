/**
 * Backtest a strategy on products with money: the alerts it would have sent over past candles (the same
 * evaluation as Compare), each traded exactly like a paper trade (simulate.ts), the exits found on the traded
 * contract's 1-minute Kite candles.
 *
 * Any number of products and any period: candles come product by product through Kite's request queue (the
 * cost is only waiting), through the candle cache so a re-run is quick; a job reports progress and can cancel.
 * Contracts are those listed today with their strikes fixed at the start of the period, and Kite has no
 * candles for expired contracts (each product notes where its data starts) — the Options backtest
 * (optionsBacktest.ts) replays expired contracts from Upstox instead.
 */
import type { BacktestJob, BacktestProduct, BacktestRequest, BacktestResult, CompareProductResult, StrategyDefinition, V2Instrument, V2Strategy } from '@/shared/v2';
import { nodeText, paperGroups, resolveRules } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import { calendars, dateStartMs, type MarketCalendar } from '../calendar/MarketCalendar';
import { CandleCache, type CandleStats } from '../data/CandleCache';
import type { V2DataProvider } from '../data/DataProvider';
import { exitDefinition, type V2Tools } from '../debug/tools';
import type { RawCandle } from '../engine/candles';
import type { V2Store } from '../persistence/V2Store';
import { exitKey, ruleFor as ruleOf, simulate, type SimAlert } from './simulate';
import { breakdowns, paperStats, spark } from './summary';

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface BacktestDeps {
  store: V2Store;
  provider: V2DataProvider;
  tools: V2Tools;
  now: () => number;
  /** Candles kept between runs (default: only within this run). */
  cache?: CandleCache;
}

/** A run as a job: progress, cancelling and the Kite / cache counts. */
export interface BacktestRun {
  /** Throws when the job was cancelled. */
  checkpoint(): void;
  progress(p: Pick<BacktestJob, 'phase' | 'done' | 'total' | 'current'>): void;
  stats: CandleStats;
}

export async function runBacktest(deps: BacktestDeps, strategy: V2Strategy, req: BacktestRequest, run?: BacktestRun): Promise<BacktestResult> {
  const d: StrategyDefinition = strategy.definition;
  const tf = d.evaluation.triggerTimeframe;
  const now = deps.now();
  const ids = [...new Set(req.products)];
  const exitRules = (req.exits ?? []).map((x) => ({ key: exitKey(x.group), when: x.when }));
  const cals = calendars(await deps.store.calendar.list());
  const products = new Map((await deps.store.products.list({ ids })).map((p) => [p.id, p]));
  const plan = { ...req.plan, enabled: true, rules: resolveRules(d, req.plan.rules) };
  const end = Math.min(now, dateStartMs(addDays(req.to, 1)));
  const calOf = (productId: string): MarketCalendar => cals[products.get(productId)?.market ?? 'NSE'];
  const symbolOf = (productId: string) => products.get(productId)?.symbol ?? productId.split(':')[1] ?? productId;
  const stats = run?.stats ?? { fetched: 0, cached: 0 };
  const provider = (deps.cache ?? new CandleCache()).wrap(deps.provider, cals, deps.now, stats);
  const ruleFor = (trace: SimAlert['trace']) => ruleOf(d, plan, trace);

  // 1-minute candles of the contracts a product's alerts trade, from its first alert — fetched as soon as its
  // alerts are found, so the job's progress is simply products done.
  const errors = new Map<string, string[]>();
  const pushError = (productId: string, e: string) => errors.set(productId, [...(errors.get(productId) ?? []), e]);
  const minutes = new Map<number, RawCandle[]>();
  const fetchMinutes = async (r: CompareProductResult) => {
    if (!r.unit) return;
    const traded = new Map<number, { inst: V2Instrument; from: string }>();
    for (const a of r.alerts) {
      const leg = ruleFor(a.trace).rule?.leg;
      const inst = leg ? r.unit.legs[leg] : null;
      if (inst && !traded.has(inst.token)) traded.set(inst.token, { inst, from: istDate(a.candleTime * 1000) });
    }
    for (const { inst, from } of traded.values()) {
      run?.checkpoint();
      try {
        const rows = await provider.getHistoricalCandles({ instrument: inst, interval: '1m', from, to: req.to });
        minutes.set(inst.token, [...rows].sort((a, b) => a.time - b.time));
        if (!rows.length) pushError(r.productId, `No 1-minute candles for ${inst.symbol} from ${from} (its first alert) — it didn’t trade, so its trades close only at square-off / the end of the test`);
      } catch (err) {
        pushError(r.productId, `1-minute candles for ${inst.symbol}: ${msg(err)}`);
      }
    }
  };

  const cmp = await deps.tools.compare(
    d,
    { products: ids, from: req.from, to: req.to, expiry: req.expiry, strikeShift: req.strikeShift, trigger: req.trigger, cooldownMinutes: req.cooldownMinutes ?? null, exits: exitRules },
    {
      provider,
      checkpoint: (i, id) => {
        run?.checkpoint();
        run?.progress({ phase: 'CANDLES', done: i, total: ids.length, current: symbolOf(id) });
      },
      onProduct: fetchMinutes,
    },
  );
  run?.progress({ phase: 'TRADES', done: ids.length, total: ids.length, current: null });
  const exitTimes = new Map(cmp.products.map((r) => [r.productId, r.exits ?? {}]));

  // Alerts in time order, across products (money is shared).
  const alerts: SimAlert[] = [];
  for (const r of cmp.products) {
    if (!r.unit) continue;
    for (const a of r.alerts) alerts.push({ at: calOf(r.productId).candleClose(a.candleTime * 1000, tf), productId: r.productId, unit: r.unit, prices: a.prices, trace: a.trace });
  }
  alerts.sort((a, b) => a.at - b.at);

  const { closed, skipped } = simulate({
    strategy,
    plan,
    capital: req.capital,
    products,
    calOf,
    alerts,
    minutes: (inst) => minutes.get(inst.token) ?? [],
    exitsFor: (e, key) => exitTimes.get(e.productId)?.[key] ?? [],
    end,
  });

  const byProduct = (id: string) => closed.filter((t) => t.productId === id);
  const results: BacktestProduct[] = cmp.products.map((r) => {
    const list = byProduct(r.productId);
    const unitContracts = r.unit ? Object.entries(r.unit.legs).map(([leg, i]) => `${leg}: ${i ? i.symbol : 'not listed'}`) : [];
    return {
      productId: r.productId,
      symbol: symbolOf(r.productId),
      name: r.productName,
      alerts: r.alerts.length,
      trades: list.length,
      skipped: skipped.filter((s) => s.productId === r.productId).length,
      stats: paperStats(list, end),
      spark: spark(list),
      contracts: unitContracts,
      notes: r.notes,
      errors: [...r.errors, ...(errors.get(r.productId) ?? [])],
    };
  });

  const overall = paperStats(closed, end);
  let cum = 0;
  let low = 0;
  for (const t of [...closed].sort((a, b) => (a.exitAt ?? '').localeCompare(b.exitAt ?? ''))) low = Math.min(low, (cum += t.netPnl ?? 0));
  const capital = req.capital;
  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    from: req.from,
    to: req.to,
    triggerTimeframe: tf,
    capital,
    finalCapital: capital === null ? null : round2(capital + overall.netPnl),
    returnOnCapitalPct: capital ? round2((overall.netPnl / capital) * 100) : null,
    lowestCapital: capital === null ? null : round2(capital + low),
    summary: { from: req.from, overall, strategies: [], connections: [], ...breakdowns(closed) },
    products: results.sort((a, b) => b.stats.netPnl - a.stats.netPnl),
    trades: [...closed].sort((a, b) => b.entryAt.localeCompare(a.entryAt)),
    skipped,
    requests: stats.fetched,
    notes: [
      ...(plan.squareOff && (tf === '1d' || tf === '1w')
        ? ['Daily / weekly candles close after the day’s square-off time, so with “Square off daily” on no alert can be traded — switch it off to hold positions overnight.']
        : []),
      'Each alert is entered at its trigger candle’s close (± slippage) and exited on the traded contract’s 1-minute candles; if the target and stop-loss fall in the same minute the stop counts.',
      ...(req.exits ?? []).map((x) => {
        const group = paperGroups(d).find((g) => g.id === x.group)?.label;
        return `Exit rule${group ? ` (${group})` : ''}: ${nodeText(x.when, d.legs)} — checked at each ${exitDefinition(d, x.when).evaluation.triggerTimeframe} candle close; the trade exits at that close.`;
      }),
      ...cmp.notes.map((x) => x.replace('Alerts only (no trade scoring). ', '')),
    ],
  };
}
