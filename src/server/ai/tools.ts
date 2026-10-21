/**
 * What the AI can do — thin wrappers over the Equity service, so every number it gives comes from the app:
 * read strategies, stock lists and the backtest history; write a strategy for the trader to open in the builder
 * (never saved by the AI); run backtests (kept in the history) and robustness checks. No orders, no saving, no
 * deleting. Results are compact (analysis.ts) — Groq's free plan allows 8,000 tokens a minute.
 */
import type { EqBacktestResult, EqPreset, EqStrategyDefinition } from '@/shared/equity';
import { EQ_DEFAULT_CAPITAL, EQ_PRESETS, hasErrors, normalizeDefinition, strategySummary, validateDefinition } from '@/shared/equity';
import type { AiProposal } from '@/shared/ai/types';
import type { EquityService } from '../equity';
import { CompactError, fromDefinition, toDefinition } from './compact';
import { headline, summarize, withExits, withPeriods } from './analysis';
import type { ToolSpec } from './groq';

/** A problem the model can fix (bad arguments, unknown list): goes back to it as the tool's result. */
export class ToolError extends Error {}

export interface ToolContext {
  equity: EquityService;
  /** Strategies the AI proposed in this conversation ("d1", "d2"…). */
  drafts: Map<string, EqStrategyDefinition>;
  progress: (detail: string) => void;
  cancelled: () => boolean;
  /** Today in IST (yyyy-mm-dd). */
  today: string;
}

export interface ToolOutcome {
  /** What the model reads (JSON). */
  content: string;
  /** One line kept when older results are condensed, and shown under the step. */
  brief: string;
  /** The step's title in the panel. */
  title?: string;
  proposal?: AiProposal;
  backtest?: { historyId: string; label: string };
}

const STRATEGY = { type: 'object', description: '{"id": saved strategy id} | {"draft": "d1"} (one you proposed) | {"def": compact strategy}' };
const UNIVERSE = { type: 'object', description: '{"preset": "NIFTY50"} | {"watchlist": "name or id"} | {"symbols": ["RELIANCE", "NIFTY BANK"]}' };
const PERIOD = {
  from: { type: 'string', description: 'yyyy-mm-dd (default 5 years ago)' },
  to: { type: 'string', description: 'yyyy-mm-dd (default today)' },
  capital: { type: ['number', 'null'], description: '₹ starting money (default 500000; null = no limit, P&L only)' },
  max_positions: { type: ['integer', 'null'], description: 'most stocks held at once (default none)' },
};
const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolSpec => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

const TOOL_LIST: ToolSpec[] = [
  fn('list_strategies', "The trader's saved strategies: id, name, version, rules in words."),
  fn('get_strategy', 'A saved strategy in the compact format (to change it or test a variant).', { id: { type: 'string' } }, ['id']),
  fn(
    'propose_strategy',
    'Show the trader a strategy you wrote; they open it in the builder (nothing is saved). Checked like the builder — fix errors and call again. Returns a draft id for run_backtest.',
    { strategy: { type: 'object', description: 'compact strategy' }, assumptions: { type: 'array', items: { type: 'string' }, description: 'every default or interpretation you chose, in plain words' } },
    ['strategy'],
  ),
  fn('list_stock_lists', 'Stock lists, index groups and the trader’s watchlists, with how many each has.'),
  fn('find_instruments', 'Search NSE stocks and NSE/BSE indices by symbol, name or F&O name (BANKNIFTY).', { query: { type: 'string' } }, ['query']),
  fn('run_backtest', 'Backtest a strategy (kept in the trader’s history). Returns the analysis: figures, NIFTY 50, each year, halves, concentration, exits, drawdown, data notes.', { strategy: STRATEGY, universe: UNIVERSE, ...PERIOD }, ['strategy', 'universe']),
  fn('robustness_check', 'Runs the strategy and its neighbours — every period −20 % / +20 %, exit levels −20 % / +20 % — optionally also on another list, and compares them. Only the base run is kept in the history.', { strategy: STRATEGY, universe: UNIVERSE, ...PERIOD, also_on: { type: 'string', description: 'another preset, e.g. MIDCAP150' } }, ['strategy', 'universe']),
  fn('analyse_backtest', 'The analysis of a backtest in the history (e.g. the one on screen).', { id: { type: 'string', description: 'history id' } }, ['id']),
  fn('backtest_history', 'Recent backtests in the history with their figures (newest first).', { strategy_id: { type: 'string' }, limit: { type: 'integer', description: 'default 10' } }),
];

/** Tools that run backtests — offered only when the trader asked for one (backtestAsked). */
const RUNS = new Set(['run_backtest', 'robustness_check']);

/** The chat's tools; without the ones that run backtests unless the trader asked. */
export function chatTools(allowRuns: boolean): ToolSpec[] {
  return TOOL_LIST.filter((t) => allowRuns || !RUNS.has(t.function.name));
}

/** The strategy creator only builds: write a strategy, read a saved one. */
export const CREATOR_TOOLS: ToolSpec[] = TOOL_LIST.filter((t) => ['propose_strategy', 'get_strategy'].includes(t.function.name));

/** Every tool (the chat's full set). */
export const TOOLS: ToolSpec[] = TOOL_LIST;

const ASKS_RUN = /\b((?<!\b(?:this|the|that|these|those|my|last|latest|which|of|from|open|opened)\s)back ?-?test(?:s|ing|ed)?|test (it|this|that|them|these|both|on|over|for)|run (it|this|that|them)|robust\w*|over-?fit\w*|curve-?fit\w*|how (did|does|do|would|will|has) (it|this|that|they|these|my)|perform\w*|cagr|compare|simulat\w*|verify|check (it|this|that|them|if|whether|how))\b/i;
const YES = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|go ahead|go|do it|please( do)?|haan|han|ha|ji|run it|test it|proceed|y)\b/i;

/**
 * Did the trader ask for a backtest? Their words ("backtest it", "is it robust?", "how did it do?"), or a yes to the
 * AI's own offer. Otherwise the AI isn't given the tools that run one — it can only offer.
 */
export function backtestAsked(text: string, lastAnswer: string | null): boolean {
  return ASKS_RUN.test(text) || (YES.test(text) && !!lastAnswer && ASKS_RUN.test(lastAnswer));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const PRESETS = new Map(EQ_PRESETS.map((p) => [p.value, p]));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);

function yearsAgo(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

/** A compact strategy → the builder's, checked; errors go back to the model to fix. */
function checkedDefinition(raw: unknown): { def: EqStrategyDefinition; warnings: ReturnType<typeof validateDefinition> } {
  let def: EqStrategyDefinition;
  try {
    def = normalizeDefinition(toDefinition(raw));
  } catch (err) {
    if (err instanceof CompactError) throw new ToolError(err.message);
    throw err;
  }
  const issues = validateDefinition(def);
  if (hasErrors(issues)) throw new ToolError(`Not valid: ${issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`);
  return { def, warnings: issues.filter((i) => i.severity === 'warning') };
}

async function strategyOf(ref: unknown, c: ToolContext): Promise<{ def: EqStrategyDefinition; strategyId?: string }> {
  if (typeof ref === 'string') ref = c.drafts.has(ref) ? { draft: ref } : { id: ref };
  if (!isObj(ref)) throw new ToolError('strategy is {"id": …} | {"draft": …} | {"def": …}');
  if (typeof ref.draft === 'string') {
    const d = c.drafts.get(ref.draft);
    if (!d) throw new ToolError(`No draft "${ref.draft}" — drafts so far: ${[...c.drafts.keys()].join(', ') || 'none'}`);
    return { def: d };
  }
  if (typeof ref.id === 'string') {
    const s = await c.equity.getStrategy(ref.id).catch(() => null);
    if (!s) throw new ToolError(`No saved strategy with id ${ref.id} — call list_strategies`);
    return { def: s.definition, strategyId: s.id };
  }
  if (ref.def !== undefined) return { def: checkedDefinition(ref.def).def };
  throw new ToolError('strategy is {"id": …} | {"draft": …} | {"def": …}');
}

async function universeOf(u: unknown, c: ToolContext): Promise<{ symbols: string[]; label: string; preset?: EqPreset }> {
  if (typeof u === 'string') u = PRESETS.has(u as EqPreset) ? { preset: u } : { watchlist: u };
  if (!isObj(u)) throw new ToolError('universe is {"preset": …} | {"watchlist": …} | {"symbols": […]}');
  if (typeof u.preset === 'string') {
    const preset = u.preset.toUpperCase() as EqPreset;
    const p = PRESETS.get(preset);
    if (!p) throw new ToolError(`Unknown preset ${u.preset} — one of ${[...PRESETS.keys()].join(', ')}`);
    const { stocks } = await c.equity.stocks({ preset, limit: 5000 });
    if (!stocks.length) throw new ToolError(`${p.label} is empty right now (Kite’s or NSE’s list isn’t loaded)`);
    return { symbols: stocks.map((s) => s.symbol), label: p.label, preset };
  }
  if (typeof u.watchlist === 'string') {
    const want = u.watchlist.trim().toLowerCase();
    const lists = await c.equity.listWatchlists();
    const w = lists.find((x) => x.id === u.watchlist || x.name.toLowerCase() === want) ?? lists.find((x) => x.name.toLowerCase().includes(want));
    if (!w) throw new ToolError(`No watchlist "${u.watchlist}" — the trader has: ${lists.map((x) => x.name).join(', ') || 'none'}`);
    return { symbols: w.symbols, label: `${w.name} (watchlist)` };
  }
  if (Array.isArray(u.symbols) && u.symbols.length) {
    const symbols = u.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    return { symbols, label: symbols.length <= 3 ? symbols.join(', ') : `${symbols.length} picked` };
  }
  throw new ToolError('universe is {"preset": …} | {"watchlist": …} | {"symbols": […]}');
}

function periodOf(a: Record<string, unknown>, c: ToolContext) {
  const date = (v: unknown, fallback: string) => {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolError(`Dates are yyyy-mm-dd — got ${JSON.stringify(v)}`);
    return v;
  };
  const from = date(a.from, yearsAgo(c.today, 5));
  const to = date(a.to, c.today);
  if (from > to) throw new ToolError('from is after to');
  const capital = a.capital === null ? null : typeof a.capital === 'number' ? a.capital : EQ_DEFAULT_CAPITAL;
  if (capital !== null && capital < 1000) throw new ToolError('capital must be at least ₹1,000 (or null for no limit)');
  const maxPositions = typeof a.max_positions === 'number' && a.max_positions >= 1 ? Math.round(a.max_positions) : null;
  return { from, to, capital, maxPositions };
}

async function backtest(c: ToolContext, def: EqStrategyDefinition, strategyId: string | undefined, u: { symbols: string[]; label: string; preset?: EqPreset }, p: ReturnType<typeof periodOf>, history: boolean, what: string): Promise<EqBacktestResult> {
  return c.equity.runBacktest(
    {
      ...(strategyId ? { strategyId } : { definition: def }),
      symbols: u.symbols,
      from: p.from,
      to: p.to,
      capital: p.capital,
      maxPositions: p.maxPositions,
      stocksLabel: `${u.label} · by AI`,
      ...(u.preset ? { source: { kind: 'PRESET' as const, preset: u.preset } } : { source: { kind: 'PICK' as const, symbols: u.symbols } }),
    },
    {
      history,
      cancelled: c.cancelled,
      progress: (x) => {
        if (x.phase === 'RUN') c.progress(`${what}: simulating`);
        else if (x.done !== undefined && x.total) c.progress(`${what}: candles ${x.done} / ${x.total}${x.current ? ` (${x.current})` : ''}`);
      },
    },
  );
}

const line = (r: EqBacktestResult) => `CAGR ${pct(r.cagrPct)} · max DD ${pct(r.maxDrawdownPct)} · ${r.stats.trades} trades · PF ${r.stats.profitFactor?.toFixed(2) ?? '—'}${r.benchmark ? ` (NIFTY 50 CAGR ${pct(r.benchmark.cagrPct)})` : ''}`;

export async function runTool(name: string, args: Record<string, unknown>, c: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case 'list_strategies': {
      const list = await c.equity.listStrategies();
      const out = list.slice(0, 25).map((s) => ({ id: s.id, name: s.name, v: s.version, rules: strategySummary(s.definition).slice(0, 3) }));
      return { content: JSON.stringify(out), brief: `${list.length} saved strategies: ${list.map((s) => s.name).join(', ').slice(0, 200)}`, title: 'Read your strategies' };
    }
    case 'get_strategy': {
      const s = await c.equity.getStrategy(String(args.id ?? '')).catch(() => null);
      if (!s) throw new ToolError(`No saved strategy with id ${String(args.id)}`);
      return { content: JSON.stringify({ id: s.id, name: s.name, version: s.version, strategy: fromDefinition(s.definition) }), brief: `Strategy ${s.name} (v${s.version})`, title: `Read strategy “${s.name}”` };
    }
    case 'propose_strategy': {
      const { def, warnings } = checkedDefinition(args.strategy);
      const draftId = `d${c.drafts.size + 1}`;
      c.drafts.set(draftId, def);
      const summary = strategySummary(def);
      const assumptions = Array.isArray(args.assumptions) ? args.assumptions.map((a) => String(a).trim()).filter(Boolean).slice(0, 12) : [];
      return {
        content: JSON.stringify({ draft: draftId, ok: true, reads: summary, warnings: warnings.map((w) => w.message) }),
        brief: `Proposed ${draftId} “${def.name}”: ${summary[0]}`,
        title: `Wrote strategy “${def.name}”`,
        proposal: { draftId, definition: def, summary, warnings, ...(assumptions.length ? { assumptions } : {}) },
      };
    }
    case 'list_stock_lists': {
      const [presets, lists] = await Promise.all([c.equity.presets(), c.equity.listWatchlists()]);
      const out = {
        stockLists: presets.filter((p) => p.of === 'STOCKS').map((p) => `${p.preset} = ${p.label} (${p.count})`),
        indexLists: presets.filter((p) => p.of === 'INDICES').map((p) => `${p.preset} = ${p.label} (${p.count})`),
        watchlists: lists.map((w) => `${w.name} (${w.symbols.length}) id ${w.id}`),
      };
      return { content: JSON.stringify(out), brief: `Lists: ${presets.length} presets, ${lists.length} watchlists`, title: 'Read the stock lists' };
    }
    case 'find_instruments': {
      const { stocks, total } = await c.equity.stocks({ search: String(args.query ?? ''), limit: 15 });
      const out = { total, matches: stocks.map((s) => `${s.symbol} — ${s.name}${s.index ? ' [index]' : ''}${s.sector ? ` · ${s.sector}` : ''}`) };
      return { content: JSON.stringify(out), brief: `Search “${String(args.query)}”: ${stocks.map((s) => s.symbol).join(', ').slice(0, 150)}`, title: `Searched “${String(args.query)}”` };
    }
    case 'run_backtest': {
      const { def, strategyId } = await strategyOf(args.strategy, c);
      const u = await universeOf(args.universe, c);
      const p = periodOf(args, c);
      const r = await backtest(c, def, strategyId, u, p, true, 'Backtest');
      const label = `${def.name} on ${u.label}, ${p.from} → ${p.to}`;
      return {
        content: JSON.stringify(summarize(r)),
        brief: `Backtest ${label}: ${line(r)}${r.historyId ? ` · history ${r.historyId}` : ''}`,
        title: `Backtest: ${label}`,
        ...(r.historyId ? { backtest: { historyId: r.historyId, label } } : {}),
      };
    }
    case 'robustness_check': {
      const { def, strategyId } = await strategyOf(args.strategy, c);
      const u = await universeOf(args.universe, c);
      const p = periodOf(args, c);
      const variants: Array<[string, EqStrategyDefinition | null]> = [
        ['every period +20%', withPeriods(def, 1.2)],
        ['every period −20%', withPeriods(def, 0.8)],
        ['exit levels −20%', withExits(def, 0.8)],
        ['exit levels +20%', withExits(def, 1.2)],
      ];
      // Longer periods need the most history: run that one first, so the others find their candles in memory.
      const runs: Array<{ variant: string } & ReturnType<typeof headline>> = [];
      const longer = variants[0]![1]!;
      const ok = (v: EqStrategyDefinition | null): v is EqStrategyDefinition => !!v && !hasErrors(validateDefinition(v));
      if (ok(longer)) runs.push({ variant: variants[0]![0], ...headline(await backtest(c, longer, undefined, u, p, false, variants[0]![0])) });
      const base = await backtest(c, def, strategyId, u, p, true, 'As written');
      const rows: Array<{ variant: string } & ReturnType<typeof headline>> = [{ variant: 'as written', ...headline(base) }, ...runs];
      for (const [name, v] of variants.slice(1)) {
        if (!ok(v)) continue;
        const r = await backtest(c, v, undefined, u, p, false, name);
        rows.push({ variant: name, ...headline(r) });
      }
      if (typeof args.also_on === 'string' && args.also_on.trim()) {
        const other = await universeOf({ preset: args.also_on }, c);
        const r = await backtest(c, def, undefined, other, p, false, `On ${other.label}`);
        rows.push({ variant: `as written, on ${other.label}`, ...headline(r) });
      }
      const s = summarize(base);
      const label = `${def.name} on ${u.label}, ${p.from} → ${p.to}`;
      return {
        content: JSON.stringify({ historyId: base.historyId ?? null, period: s.period, comparison: rows, byYear: s.byYear, halves: s.halves, concentration: s.concentration, tStat: s.trades.tStat, dataNotes: s.dataNotes }),
        brief: `Robustness ${label}: ${rows.map((r) => `${r.variant} CAGR ${pct(r.cagrPct)} DD ${pct(r.maxDrawdownPct)}`).join('; ')}`,
        title: `Robustness: ${label} (${rows.length} runs)`,
        ...(base.historyId ? { backtest: { historyId: base.historyId, label } } : {}),
      };
    }
    case 'analyse_backtest': {
      const rec = await c.equity.backtestRecord(String(args.id ?? '')).catch(() => null);
      if (!rec) throw new ToolError(`No backtest ${String(args.id)} in the history — call backtest_history`);
      if (!rec.result) throw new ToolError('That backtest’s full result was too large to keep — only its figures are in backtest_history');
      const s = summarize(rec.result);
      return {
        content: JSON.stringify({ ...s, strategy: { name: rec.run.strategyName, id: rec.run.strategyId, compact: fromDefinition(rec.request.definition) }, stocks: rec.run.stocksLabel }),
        brief: `Analysed ${rec.run.strategyName} on ${rec.run.stocksLabel} (${rec.run.from} → ${rec.run.to}): ${line(rec.result)}`,
        title: `Read backtest: ${rec.run.strategyName} on ${rec.run.stocksLabel}`,
      };
    }
    case 'backtest_history': {
      const limit = typeof args.limit === 'number' ? Math.min(30, Math.max(1, Math.round(args.limit))) : 10;
      const runs = (await c.equity.backtestHistory()).filter((r) => !args.strategy_id || r.strategyId === args.strategy_id).slice(0, limit);
      const out = runs.map((r) => ({ id: r.id, ran: r.ranAt.slice(0, 16), strategy: `${r.strategyName}${r.strategyVersion ? ` v${r.strategyVersion}` : ''}`, on: r.stocksLabel, period: `${r.from} → ${r.to}`, cagr: r.cagrPct, ret: r.returnPct, maxDD: r.maxDrawdownPct, trades: r.trades, win: Math.round(r.winRate), pf: r.profitFactor, nifty: r.benchmarkReturnPct }));
      return { content: JSON.stringify(out), brief: `History: ${runs.length} backtests`, title: 'Read the backtest history' };
    }
    default:
      throw new ToolError(`No tool ${name}`);
  }
}
