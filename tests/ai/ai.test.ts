/**
 * The trading AI assistant without the network: the compact strategy format (every template survives the round
 * trip; mistakes come back as fixable messages), Groq's limits (read from headers, waits instead of failing), and
 * a whole answer — tool calls, a strategy proposal, a backtest — with a scripted Groq.
 */
import { describe, expect, it } from 'vitest';
import type { EqBacktestResult, EqStrategy } from '../../src/shared/equity';
import { EQ_TEMPLATES, normalizeDefinition, strategySummary } from '../../src/shared/equity';
import { CompactError, fromDefinition, toDefinition } from '../../src/server/ai/compact';
import { summarize, withExits, withPeriods } from '../../src/server/ai/analysis';
import { GroqClient, parseDuration } from '../../src/server/ai/groq';
import { backtestAsked } from '../../src/server/ai/tools';
import { fillPart } from '../../src/server/ai/fill';
import { AiService } from '../../src/server/ai/AiService';
import type { EquityService } from '../../src/server/equity';

describe('compact strategy format', () => {
  it('every template survives builder → compact → builder (same rules, same text)', () => {
    for (const t of EQ_TEMPLATES) {
      const back = normalizeDefinition(toDefinition(fromDefinition(t.definition)));
      expect(strategySummary(back), t.key).toEqual(strategySummary(t.definition));
      expect(fromDefinition(back), t.key).toEqual(fromDefinition(t.definition));
    }
  });

  it('reads a trader-style strategy', () => {
    const d = toDefinition({
      name: 'Weekly breakout',
      timeframe: '1w',
      entry: { all: [['close', 'crosses_above', { ind: 'SMA', period: 20 }], [{ ind: 'RSI', period: 14 }, '>', 60]] },
      exit: { when: ['close', 'crosses_below', { ind: 'SMA', period: 50 }], stop: 8 },
      pyramid: { ma: 'SMA', period: 20 },
      size: { amount: 100000 },
    });
    expect(strategySummary(d)).toEqual([
      'Weekly: buy when Close crosses above SMA(20) AND RSI(14) > 60',
      'Sell everything at the first of: stop-loss −8% from the average price; when Close crosses below SMA(50); the pyramiding stop',
      'Pyramiding: when SMA(20) rises to the last buy price, buy one more lot; the stop for all lots becomes SMA(20)',
      '₹1,00,000 per buy · bought / sold at the next day’s open · stops on any day’s low · no charges or slippage (like TradingView’s strategy tester)',
    ]);
    expect(toDefinition({ name: 'x', entry: [{ ind: 'RSI', period: 14 }, 'crosses_above', { ind: 'RSI', period: 14, ma: { type: 'SMA', period: 9 } }] }).entry.when.children[0]).toMatchObject({ right: { indicator: 'RSI', ma: { type: 'SMA', period: 9 } } });
  });

  it('reads values and operators written short, as people write them', () => {
    const d = toDefinition({
      name: 's',
      entry: {
        all: [
          ['close', 'crosses above', 'SMA(20)'],
          ['RSI(14)', ' > ', 55],
          ['MACD(12,26,9).signal', 'lt', 'MACD(12,26,9)'],
          ['volume', '>', '1.5*SMA(20,volume)'],
          'close[1] >= HIGHEST(252,high)',
        ],
      },
      exit: { when: ['close', 'crossunder', 'BB(20,2).lower'] },
    });
    expect(strategySummary(d).slice(0, 2)).toEqual([
      'Daily: buy when Close crosses above SMA(20) AND RSI(14) > 55 AND MACD(12, 26, 9) signal < MACD(12, 26, 9) AND Volume > 1.5 × SMA(20, volume) AND Close [1 day ago] ≥ Highest(252)',
      'Sell everything at the first of: when Close crosses below BB(20, 2) lower',
    ]);
    expect(() => toDefinition({ name: 's', entry: ['close', '>', 'SMA(20,30)'] })).toThrow(/SMA takes 1 number/);
    for (const w of ['SMA(9) of RSI(14)', 'SMA(RSI(14),9)', 'sma(9) of rsi(14)'])
      expect(toDefinition({ name: 's', entry: ['RSI(14)', 'crosses_above', w] }).entry.when.children[0], w).toMatchObject({ right: { indicator: 'RSI', params: { period: 14 }, ma: { type: 'SMA', period: 9 } } });
  });

  it('says exactly what is wrong, so the model can fix it', () => {
    const bad = (s: unknown) => () => toDefinition(s);
    expect(bad({ name: 'x', entry: ['close', 'is_over', 5] })).toThrow(/unknown operator "is_over"/);
    expect(bad({ name: 'x', entry: ['RSI', '>', 55, { ind: 'RSI' }] })).toThrow(/exactly \[left, op, right\]/);
    expect(bad({ name: 'x', entry: ['close', '>', { ind: 'VWAP' }] })).toThrow(/unknown indicator "VWAP"/);
    expect(bad({ name: 'x', entry: ['close', '>', { ind: 'SMA', length: 20 }] })).toThrow(/SMA has no length — its parameters are period/);
    expect(bad({ name: 'x', entry: [{ ind: 'MACD', out: 'histogram' }, '>', 0] })).toThrow(/MACD has no output "histogram" — line, signal, hist/);
    expect(bad({ entry: ['close', '>', 1] })).toThrow(CompactError);
  });
});

describe('analysis', () => {
  it('periods ±20 % keep MACD fast below slow; exit levels scale', () => {
    const t = EQ_TEMPLATES.find((x) => x.key === 'sma-50-100')!.definition;
    expect(strategySummary(withPeriods(t, 1.2))[0]).toBe('Daily: buy when SMA(60) crosses above SMA(120)');
    expect(withExits(t, 0.8)!.exit.targetPct).toBe(16);
    const macd = toDefinition({ name: 'm', entry: [{ ind: 'MACD', fast: 2, slow: 3, signal: 2 }, '>', 0] });
    const p = withPeriods(macd, 0.8).entry.when.children[0] as { left: { params: Record<string, number> } };
    expect(p.left.params.fast).toBeLessThan(p.left.params.slow!);
  });
});

describe('Groq limits', () => {
  it('reads Groq’s durations', () => {
    expect(parseDuration('1m26.4s')).toBe(86_400);
    expect(parseDuration('952ms')).toBe(952);
    expect(parseDuration('7.66s')).toBe(7660);
    expect(parseDuration('2')).toBe(2000);
  });

  it('waits on a 429 and tries again; reads the limits; a daily limit is an error', async () => {
    const waits: number[] = [];
    let calls = 0;
    const headers = { 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '7000', 'x-ratelimit-reset-tokens': '2s', 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '990', 'x-ratelimit-reset-requests': '14m24s' };
    const fetcher = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: 'Rate limit reached for tokens per minute (TPM)' } }), { status: 429, headers: { 'retry-after': '3' } });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200, headers });
    }) as unknown as typeof fetch;
    const g = new GroqClient('k', 'openai/gpt-oss-120b', fetcher, async (ms) => void waits.push(ms), () => 1_000_000);
    const seen: string[] = [];
    const r = await g.chat({ messages: [{ role: 'user', content: 'hi' }], maxCompletion: 10 }, { onWait: (_ms, why) => seen.push(why) });
    expect(r.content).toBe('ok');
    expect(seen).toEqual(['rate']);
    expect(waits[0]).toBeGreaterThanOrEqual(3000);
    expect(g.limits).toMatchObject({ tokensPerMinute: 8000, tokensLeft: 7000, requestsPerDay: 1000, requestsLeft: 990, requestsResetAt: 1_000_000 + 864_000 });
    const daily = new GroqClient('k', 'm', (async () => new Response(JSON.stringify({ error: { message: 'Rate limit reached for requests per day (RPD)' } }), { status: 429 })) as unknown as typeof fetch, async () => undefined);
    await expect(daily.chat({ messages: [{ role: 'user', content: 'hi' }], maxCompletion: 10 })).rejects.toThrow(/daily limit/);
  });
});

// ---- a whole answer with a scripted Groq ----------------------------------------------------------------

type Scripted = { content?: string; tool_calls?: Array<{ name: string; args: unknown }> };

function scriptedGroq(script: Scripted[], seen: unknown[][], tools: string[][] = []) {
  let i = 0;
  const fetcher = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: unknown[]; tools?: Array<{ function: { name: string } }> };
    seen.push(body.messages);
    tools.push((body.tools ?? []).map((t) => t.function.name));
    const step = script[i++] ?? { content: 'done' };
    const message = { content: step.content ?? null, ...(step.tool_calls ? { tool_calls: step.tool_calls.map((t, k) => ({ id: `c${i}-${k}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}) };
    return new Response(JSON.stringify({ choices: [{ message, finish_reason: step.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), { status: 200, headers: { 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '7900', 'x-ratelimit-reset-tokens': '1s' } });
  }) as unknown as typeof fetch;
  return new GroqClient('k', 'openai/gpt-oss-120b', fetcher, async () => undefined);
}

const RESULT = {
  strategyName: 'Breakout',
  from: '2021-01-01',
  to: '2025-12-31',
  symbols: 2,
  capital: 500000,
  finalEquity: 650000,
  netPnl: 150000,
  returnPct: 30,
  cagrPct: 5.4,
  maxDrawdownPct: -12.5,
  maxDrawdown: -60000,
  stats: { trades: 40, wins: 22, losses: 18, winRate: 55, grossProfit: 300000, grossLoss: -150000, profitFactor: 2, avgWinPct: 8, avgLossPct: -4, expectancy: 3750, avgHoldingDays: 30, bestTrade: 50000, worstTrade: -20000, charges: 0, adds: 0, exposurePct: 60 },
  benchmark: { name: 'NIFTY 50', returnPct: 50, cagrPct: 8.4, maxDrawdownPct: -15 },
  curve: [
    { date: '2021-01-01', equity: 500000, drawdownPct: 0, benchmark: 500000 },
    { date: '2021-12-31', equity: 560000, drawdownPct: 0, benchmark: 600000 },
    { date: '2022-06-30', equity: 490000, drawdownPct: -12.5, benchmark: 520000 },
    { date: '2022-12-30', equity: 600000, drawdownPct: 0, benchmark: 620000 },
    { date: '2025-12-31', equity: 650000, drawdownPct: 0, benchmark: 750000 },
  ],
  monthly: [],
  yearly: [],
  perSymbol: [
    { symbol: 'AAA', name: 'AAA', trades: 25, wins: 15, netPnl: 120000, invested: 1, bestTrade: 1, worstTrade: 1, notes: [], errors: [] },
    { symbol: 'BBB', name: 'BBB', trades: 15, wins: 7, netPnl: 30000, invested: 1, bestTrade: 1, worstTrade: 1, notes: ['Candles start on 2022-01-03 (listed or first traded then)'], errors: [] },
  ],
  trades: Array.from({ length: 40 }, (_, k) => ({ id: String(k), symbol: k < 25 ? 'AAA' : 'BBB', name: '', entryDate: '2022-01-01', exitDate: '2022-02-01', exitReason: k % 2 ? 'TARGET' : 'EXIT_RULE', quantity: 1, adds: 0, avgPrice: 1, exitPrice: 1, invested: 1, grossPnl: 0, charges: 0, netPnl: k % 2 ? 7500 : 0, returnPct: k % 2 ? 8 : -1, holdingDays: 30, fills: [] })),
  openAtEnd: 0,
  skipped: [{ symbol: 'AAA', date: '2022-01-01', kind: 'ENTRY', reason: 'Not enough cash: 1 × ₹1 needs ₹2, ₹0 free' }],
  requests: 2,
  notes: [],
  historyId: 'h1',
} as unknown as EqBacktestResult;

function fakeEquity(log: unknown[]): EquityService {
  const strategy = { id: 's1', name: 'd', version: 3, definition: EQ_TEMPLATES[0]!.definition, createdAt: '', updatedAt: '' } as EqStrategy;
  return {
    listStrategies: async () => [strategy],
    getStrategy: async (id: string) => {
      if (id !== 's1') throw new Error('not found');
      return strategy;
    },
    stocks: async () => ({ total: 2, stocks: [{ symbol: 'AAA', name: 'AAA', token: 1, sector: null, presets: ['NIFTY50'] }, { symbol: 'BBB', name: 'BBB', token: 2, sector: null, presets: ['NIFTY50'] }] }),
    presets: async () => [],
    listWatchlists: async () => [],
    runBacktest: async (req: unknown, o: { history: boolean; progress?: (p: unknown) => void }) => {
      log.push({ req, history: o.history });
      o.progress?.({ phase: 'FETCH', done: 1, total: 2, current: 'AAA' });
      return RESULT;
    },
    backtestHistory: async () => [],
    backtestRecord: async () => {
      throw new Error('none');
    },
  } as unknown as EquityService;
}

async function settle(svc: AiService, id: string) {
  for (let i = 0; i < 200; i++) {
    const c = svc.get(id);
    if (c.status !== 'RUNNING') return c;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('no answer');
}

describe('AI conversation', () => {
  it('writes a strategy (fixing its own mistake), backtests it and answers from the numbers', async () => {
    const seen: unknown[][] = [];
    const runs: unknown[] = [];
    const groq = scriptedGroq(
      [
        { tool_calls: [{ name: 'propose_strategy', args: { strategy: { name: 'Breakout', entry: ['close', 'is_over', 1] } } }] },
        { tool_calls: [{ name: 'propose_strategy', args: { strategy: { name: 'Breakout', entry: ['close', 'crosses_above', { ind: 'HIGHEST', period: 252, src: 'high' }], exit: { stop: 8 } } } }] },
        { tool_calls: [{ name: 'run_backtest', args: { strategy: { draft: 'd1' }, universe: { preset: 'NIFTY50' } } }] },
        { content: '**Verdict:** CAGR 5.4% vs NIFTY 50 8.4% — it lagged.' },
      ],
      seen,
    );
    const svc = new AiService({ groq, equity: fakeEquity(runs), now: () => Date.parse('2026-10-21T10:00:00Z') });
    const started = svc.send({ message: 'Make a 52-week breakout strategy and test it', context: { page: 'equity-strategies', label: 'Strategies' } });
    const c = await settle(svc, started.id);
    const a = c.messages.at(-1)!;
    expect(a.failed).toBeUndefined();
    expect(a.text).toBe('**Verdict:** CAGR 5.4% vs NIFTY 50 8.4% — it lagged.');
    expect(a.steps!.map((s) => s.status)).toEqual(['failed', 'done', 'done']);
    expect(a.steps![0]!.detail).toMatch(/unknown operator "is_over"/);
    expect(a.proposals).toHaveLength(1);
    expect(a.proposals![0]!.summary[0]).toBe('Daily: buy when Close crosses above Highest(252)');
    expect(a.backtests).toEqual([{ historyId: 'h1', label: 'Breakout on NIFTY 50, 2021-10-21 → 2026-10-21' }]);
    expect(runs).toEqual([expect.objectContaining({ history: true, req: expect.objectContaining({ from: '2021-10-21', to: '2026-10-21', capital: 500000, stocksLabel: 'NIFTY 50 · by AI', symbols: ['AAA', 'BBB'] }) })]);
    // The model saw the tool's error, then the analysis (computed here, not by the model).
    const last = seen.at(-1) as Array<{ role: string; content: string }>;
    expect(last.some((m) => m.role === 'tool' && m.content.includes('unknown operator'))).toBe(true);
    const analysis = JSON.parse(last.filter((m) => m.role === 'tool').at(-1)!.content) as ReturnType<typeof summarize>;
    expect(analysis).toMatchObject({ result: { cagrPct: 5.4 }, nifty50: { cagrPct: 8.4 }, trades: { count: 40 }, concentration: { top: [{ symbol: 'AAA', pctOfNet: 80 }, { symbol: 'BBB', pctOfNet: 20 }] }, signalsNotTaken: { 'not enough cash': 1 } });
    expect(analysis.byYear.rows[0]).toEqual(['2021 (from 01-01)', 12, 20]);
    expect(analysis.drawdown).toMatchObject({ maxPct: -12.5, peak: '2021-12-31', trough: '2022-06-30', recovered: '2022-12-30' });
    // Status for the header: Groq's limits and today's use.
    const st = await svc.status();
    expect(st).toMatchObject({ configured: true, busy: false, usage: { requests: 4 }, limits: { tokensPerMinute: 8000 } });
  });

  it('a robustness check runs the neighbours without filling the history', async () => {
    const runs: Array<{ history: boolean }> = [];
    const groq = scriptedGroq([{ tool_calls: [{ name: 'robustness_check', args: { strategy: { id: 's1' }, universe: 'NIFTY50', also_on: 'MIDCAP150' } }] }, { content: 'Robust enough.' }], []);
    const svc = new AiService({ groq, equity: fakeEquity(runs as unknown[]), now: () => Date.parse('2026-10-21T10:00:00Z') });
    const c = await settle(svc, svc.send({ message: 'Is d robust?' }).id);
    expect(c.messages.at(-1)!.text).toBe('Robust enough.');
    // periods +20 % first (the longest history), base (kept), periods −20 %, exit levels ±20 %, Midcap 150.
    expect(runs.map((r) => r.history)).toEqual([false, true, false, false, false, false]);
  });

  it('does only what was asked: no backtest tools unless the trader asks (or says yes to the offer)', async () => {
    const tools: string[][] = [];
    const seen: unknown[][] = [];
    const groq = scriptedGroq(
      [
        { tool_calls: [{ name: 'propose_strategy', args: { strategy: { name: 'RSI cross', entry: ['RSI(14)', 'crosses_above', 'SMA(9) of RSI(14)'], exit: { stop: 8 } } } }] },
        { content: 'Built it. Shall I backtest it on NIFTY 50 for 5 years?' },
        { tool_calls: [{ name: 'run_backtest', args: { strategy: { draft: 'd1' }, universe: { preset: 'NIFTY50' } } }] },
        { content: 'Done.' },
      ],
      seen,
      tools,
    );
    const runs: unknown[] = [];
    const svc = new AiService({ groq, equity: fakeEquity(runs), now: () => Date.parse('2026-10-21T10:00:00Z') });
    const c1 = await settle(svc, svc.send({ message: 'Create a strategy: RSI crosses above its 9 SMA, 8% stop' }).id);
    expect(tools[0]).not.toContain('run_backtest');
    expect(tools[0]).not.toContain('robustness_check');
    expect(tools[0]).toContain('propose_strategy');
    expect((seen[0] as Array<{ role: string; content: string }>).at(-1)!.content).toMatch(/doesn’t ask for a backtest/);
    expect(runs).toEqual([]);
    // "yes" to its own offer: now it may run one.
    await settle(svc, svc.send({ conversationId: c1.id, message: 'yes' }).id);
    expect(tools[2]).toContain('run_backtest');
    expect(runs).toHaveLength(1);
    expect(backtestAsked('Is it robust?', null)).toBe(true);
    expect(backtestAsked('How did it do over 5 years?', null)).toBe(true);
    expect(backtestAsked('Analyse this backtest — what drove the result and where is the risk?', null)).toBe(false);
    expect(backtestAsked('ok', 'Want me to change the stop?')).toBe(false);
    expect(backtestAsked('Which of my backtests did best?', null)).toBe(false);
    expect(backtestAsked('Then backtest it on NIFTY 50', null)).toBe(true);
    expect(backtestAsked('run a backtest on midcaps', null)).toBe(true);
  });

  it('the strategy creator only builds — its own instructions, its own tools, its own list', async () => {
    const tools: string[][] = [];
    const seen: unknown[][] = [];
    const groq = scriptedGroq([{ content: '1. How should it exit? (a) … (b) …' }], seen, tools);
    const svc = new AiService({ groq, equity: fakeEquity([]), now: () => Date.parse('2026-10-21T10:00:00Z') });
    const c = await settle(svc, svc.send({ mode: 'CREATOR', message: 'Buy when price breaks the 52-week high, backtest it too', context: { page: 'equity-backtest', backtestId: 'h1', label: 'x' } }).id);
    expect(c.mode).toBe('CREATOR');
    expect(tools[0]!.sort()).toEqual(['get_strategy', 'propose_strategy']);
    const msgs = seen[0] as Array<{ role: string; content: string }>;
    expect(msgs[0]!.content).toMatch(/^You are Algo Hunt's strategy architect/);
    expect(msgs[0]!.content).toContain('"d" (id s1)'); // the trader's saved strategies
    expect(msgs[0]!.content).toContain('SUPERTREND(period 1–100'); // the whole catalogue
    expect(msgs.find((m) => m.role === 'user')!.content).toBe('Buy when price breaks the 52-week high, backtest it too'); // no page context
    expect(svc.list('CREATOR').map((l) => l.id)).toEqual([c.id]);
    expect(svc.list('CHAT')).toEqual([]);
  });

  it('without a key it says how to set one up', () => {
    const svc = new AiService({ groq: null, equity: fakeEquity([]) });
    expect(() => svc.send({ message: 'hi' })).toThrow(/GROQ_API_KEY/);
  });
});

describe('describe in words (builder sections)', () => {
  const sma = EQ_TEMPLATES.find((t) => t.key === 'sma-50-100')!.definition;
  const run = (script: Scripted[], part: 'entry' | 'exit', text: string, seen: unknown[][] = []) => fillPart(scriptedGroq(script, seen), { part, text, strategy: { ...sma, name: '' }, today: '2026-10-21' }, () => undefined);

  it('fills the buy conditions — checked like the builder, fixing its own mistake first', async () => {
    const seen: unknown[][] = [];
    const r = await run(
      [
        { tool_calls: [{ name: 'fill_entry', args: { entry: ['RSI(14)', '>', 'close'] } }] },
        { tool_calls: [{ name: 'fill_entry', args: { entry: { all: [['SMA(50)', 'crosses_above', 'SMA(100)'], ['RSI(14)', '>', 60]] }, assumptions: ['RSI period 14'] } }] },
      ],
      'entry',
      'SMA 50 crosses above SMA 100 and RSI above 60',
      seen,
    );
    expect(r.reads).toEqual(['Daily: buy when SMA(50) crosses above SMA(100) AND RSI(14) > 60']);
    expect(r.assumptions).toEqual(['RSI period 14']);
    expect(r.entry!.trigger).toBe('WHEN_TRUE');
    expect(r.exit).toBeUndefined();
    const second = seen[1] as Array<{ role: string; content: string }>;
    expect(second.at(-1)!.content).toMatch(/compares a 0–100 oscillator with a price/);
    expect(second[1]!.content).toContain('"entry":["SMA(50)"'.slice(0, 9)); // the current strategy is shown
  });

  it('fills the sell rules (the current ones kept by the model) — or asks when too vague', async () => {
    const r = await run([{ tool_calls: [{ name: 'fill_exit', args: { target: 20, stop: 8, when: ['SMA(50)', 'crosses_below', 'SMA(100)'] } }] }], 'exit', 'add an 8% stop');
    expect(r.reads).toEqual(['Sell everything at the first of: target +20% from the average price; stop-loss −8% from the average price; when SMA(50) crosses below SMA(100)']);
    expect(r.exit).toMatchObject({ targetPct: 20, stopLossPct: 8, trailingStopPct: null, maxBars: null });
    const q = await run([{ content: 'Sell how? (a) a target % (b) a stop-loss % (c) an exit rule' }], 'exit', 'sell smartly');
    expect(q).toEqual({ part: 'exit', question: 'Sell how? (a) a target % (b) a stop-loss % (c) an exit rule' });
  });
});
