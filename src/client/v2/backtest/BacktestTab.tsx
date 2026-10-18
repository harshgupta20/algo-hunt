'use client';

/**
 * Backtest: "if I had traded this strategy on these products with this money, what would I have made?"
 *   setup    strategy · products · period · starting capital · paper settings (from the strategy, editable
 *            here only) · what each group trades · alert settings
 *   results  final capital and return, the paper-trading figures and charts, by product, every trade,
 *            alerts that weren't traded (and why), how it was tested
 * Nothing is saved or sent.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, FlaskConical, LogOut, Plus, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import type { BacktestJob, BacktestRequest, BacktestResult, ConnectionConfig, ExprNode, GroupNode, PaperPlan, PaperRule, StrategyDefinition } from '@/shared/v2';
import { BACKTEST_DEFAULT_CAPITAL, EXPIRY_MODES, TIMEFRAME, defaultPaperPlan, paperGroups, resolveRules } from '@/shared/v2';
import { InfoTip, Tooltip } from '../../components/Tooltip';
import { EmptyState, StatCard } from '../../components/ui';
import { InlineSpinner } from '../../components/loaders';
import { v2Api } from '../api';
import { Cell, LegBadge, NumberInput, Section, Segmented, Toggle } from '../components';
import { daysAgo, istStampIso, istToday } from '../format';
import { H } from '../help';
import { ProductPicker } from '../ProductPicker';
import { PaperRulesEditor } from '../strategies/PaperPlanEditor';
import { ExpressionEditor } from '../strategies/ExpressionEditor';
import { indicatorOperand, legSeries, newGroup } from '../strategies/defaults';
import { Sparkline } from '../paper/charts';
import { inr, pct, pnlClass, signedInr } from '../paper/money';
import { PaperTermsFields } from '../paper/PaperFields';
import { ByHour, HowClosed, Panel, PnlPanel, StatCells, Th, TradeTable, download, pf, td, th, toCsv } from '../paper/PaperTab';
import { LoadMore } from '../LoadMore';

/** Quick periods (days back from today). */
const QUICK = [
  { days: 5, label: '5 days' },
  { days: 10, label: '10 days' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
];
/** Kite answers ~3 candle requests a second. */
const SECONDS_PER_REQUEST = 0.35;
const duration = (seconds: number) => {
  const m = Math.round(seconds / 60);
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

// ---- exit rules ----------------------------------------------------------------------------------

const ruleKey = (r: Pick<PaperRule, 'group'>) => r.group ?? '*';
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `x${Math.random().toString(36).slice(2)}`);

/** The trader's usual exits, on the traded contract (mirrored for a sell). */
function quickExit(kind: 'rsi' | 'ma' | 'low', rule: PaperRule, def: StrategyDefinition): ExprNode {
  const s = legSeries(rule.leg!, def.evaluation.triggerTimeframe);
  const sell = rule.side === 'SELL';
  const close = { kind: 'FIELD' as const, series: s, field: 'close' as const };
  if (kind === 'rsi') return { type: 'CONDITION', id: uid(), left: indicatorOperand(s, 'RSI'), operator: sell ? 'CROSSED_ABOVE' : 'CROSSED_BELOW', right: { kind: 'CONSTANT', value: sell ? 60 : 40 } };
  if (kind === 'ma') return { type: 'CONDITION', id: uid(), left: close, operator: sell ? 'CROSSED_ABOVE' : 'CROSSED_BELOW', right: indicatorOperand(s, 'SMA') };
  return { type: 'CONDITION', id: uid(), left: close, operator: sell ? 'CROSSED_ABOVE' : 'CROSSED_BELOW', right: { ...indicatorOperand(s, 'RANGE'), output: sell ? 'high' : 'low' } };
}

/** Exit rules per trade rule: an AND / OR condition tree (the strategy editor's) that closes those trades. */
function ExitRulesEditor({ def, rules, exits, onChange }: { def: StrategyDefinition; rules: PaperRule[]; exits: Record<string, GroupNode>; onChange: (e: Record<string, GroupNode>) => void }) {
  const groups = paperGroups(def);
  const label = (r: PaperRule) => (r.group === null ? 'Every trade' : `${groups.find((g) => g.id === r.group)?.label ?? 'Group'} trades`);
  const set = (key: string, g: GroupNode | null) => {
    const next = { ...exits };
    if (g) next[key] = g;
    else delete next[key];
    onChange(next);
  };
  const traded = rules.filter((r) => r.leg);
  if (!traded.length) return null;
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-950/30 p-3">
      <p className="mb-2 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        Exit rules — close a trade when… <InfoTip content={H.backtest.exitRules} />
      </p>
      <div className="flex flex-col gap-3">
        {traded.map((r) => {
          const key = ruleKey(r);
          const tree = exits[key];
          const leg = def.legs.find((l) => l.id === r.leg);
          const quick = (
            <span className="flex flex-wrap gap-1.5">
              {(
                [
                  ['rsi', 'RSI turns', H.backtest.exitRsi],
                  ['ma', 'Price crosses SMA', H.backtest.exitMa],
                  ['low', r.side === 'SELL' ? '3-candle high' : '3-candle low', H.backtest.exitLow],
                ] as const
              ).map(([kind, text, help]) => (
                <Tooltip key={kind} content={help}>
                  <button type="button" className="btn-ghost py-0.5 text-[11px]" onClick={() => set(key, { ...(tree ?? newGroup('OR')), children: [...(tree?.children ?? []), quickExit(kind, r, def)] })}>
                    <Plus className="w-3 h-3" /> {text}
                  </button>
                </Tooltip>
              ))}
            </span>
          );
          return (
            <div key={key} className="flex flex-col gap-2 rounded-lg border border-ink-700 bg-ink-950/40 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-200">{label(r)}</span>
                <span className="text-[11px] text-slate-500">
                  {r.side === 'SELL' ? 'sell' : 'buy'} {leg ? `${r.leg} · ${leg.kind}` : r.leg}
                </span>
                {tree ? (
                  <Tooltip content={H.backtest.exitRemove} className="ml-auto">
                    <button type="button" className="btn-ghost py-0.5 text-[11px] text-slate-400" onClick={() => set(key, null)}>
                      <Trash2 className="w-3 h-3" /> No exit rule
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip content={H.backtest.exitAdd} className="ml-auto">
                    <button type="button" className="btn-ghost py-0.5 text-[11px]" onClick={() => set(key, newGroup('OR', [quickExit('rsi', r, def)]))}>
                      <LogOut className="w-3 h-3" /> Add exit rule
                    </button>
                  </Tooltip>
                )}
              </div>
              {tree ? (
                <>
                  <ExpressionEditor expression={tree} onChange={(root) => set(key, root as GroupNode)} defaultSeries={legSeries(r.leg!, def.evaluation.triggerTimeframe)} legs={def.legs} />
                  {quick}
                </>
              ) : (
                <span className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">Or start from: {quick}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What to change when alerts were skipped for this reason. */
function skipHint(reason: string): string | null {
  if (reason.startsWith('Not enough money')) return 'Raise the starting capital (a futures lot needs its margin) or switch on “No limit”.';
  if (reason.startsWith('After the')) return 'Switch “Square off daily” off in the trades settings to hold positions overnight.';
  if (reason.startsWith('An index can’t be traded')) return 'In “What each group trades”, pick the future or an option leg instead of the index.';
  if (/doesn['’]t trade/.test(reason)) return 'In “What each group trades”, choose a leg for that group.';
  if (reason.startsWith('No price')) return 'Kite had no candles for that contract at the alert — try a shorter, more recent period.';
  return null;
}

/**
 * Above the results: why there are no trades (no alerts, or every alert skipped — grouped by reason with
 * what to change) and products whose candles couldn't be read (otherwise only inside their row).
 */
function ResultNotice({ r }: { r: BacktestResult }) {
  const broken = r.products.filter((p) => p.errors.length);
  const alerts = r.products.reduce((n, p) => n + p.alerts, 0);
  const reasons = new Map<string, number>();
  for (const s of r.skipped) {
    const key = s.reason.replace(/needs ₹[\d,]+/, 'needs ₹…').replace(/₹[\d,]+ free/, '₹… free');
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const top = [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const firstFor = (key: string) => r.skipped.find((s) => s.reason.replace(/needs ₹[\d,]+/, 'needs ₹…').replace(/₹[\d,]+ free/, '₹… free') === key)?.reason ?? key;
  if (!broken.length && r.trades.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-slate-300">
      {!r.trades.length && (
        <div>
          <p className="font-semibold text-warn">No trades in this backtest</p>
          {alerts === 0 ? (
            <p className="mt-0.5">
              The strategy would not have alerted on {r.products.length === 1 ? 'this product' : 'these products'} between {r.from} and {r.to}
              {broken.length ? ' — some candles could not be read (below)' : ' — try a longer period or other products'}.
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              <li>
                {alerts} alert{alerts === 1 ? '' : 's'}, none traded:
              </li>
              {top.map(([key, n]) => (
                <li key={key} className="pl-3">
                  <span className="tabular-nums text-slate-200">{n}×</span> {firstFor(key)}
                  {skipHint(key) && <span className="block text-slate-500">→ {skipHint(key)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {broken.length > 0 && (
        <div>
          <p className="font-semibold text-warn">Candles could not be read for {broken.length === r.products.length ? 'every product' : `${broken.length} product(s)`}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {broken.slice(0, 5).map((p) => (
              <li key={p.productId}>
                <span className="font-medium text-slate-200">{p.symbol}</span>: {p.errors[0]}
                {p.errors.length > 1 ? ` (+${p.errors.length - 1} more — open its row below)` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Results({ r, names: known }: { r: BacktestResult; names: Map<string, string> }) {
  const names = useMemo(() => new Map([...known, [r.strategyId, r.strategyName]]), [known, r.strategyId, r.strategyName]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [rows, setRows] = useState(50);
  const [skippedRows, setSkippedRows] = useState(50);
  const [showSkipped, setShowSkipped] = useState(false);
  const o = r.summary.overall;
  const tone = (n: number | null | undefined) => (n === null || n === undefined || Math.abs(n) < 0.005 ? undefined : n > 0 ? 'bull' : 'bear');
  const symbol = (id: string) => r.products.find((p) => p.productId === id)?.symbol ?? id.split(':')[1] ?? id;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">{r.strategyName}</span>
        <span>
          · {r.products.length} product{r.products.length === 1 ? '' : 's'} · {r.from} → {r.to} · {TIMEFRAME[r.triggerTimeframe].label} candles · {r.requests} Kite request(s)
        </span>
        <Tooltip content={H.paper.csv} className="ml-auto">
          <button type="button" className="btn-ghost py-1 text-xs" disabled={!r.trades.length} onClick={() => download(`backtest-${r.strategyName.replace(/\W+/g, '-')}-${r.from}-${r.to}.csv`, toCsv(r.trades, names))}>
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </Tooltip>
      </div>

      <ResultNotice r={r} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Final capital"
          value={r.finalCapital === null ? '—' : inr(r.finalCapital, 0)}
          tone={tone(o.netPnl)}
          hint={r.capital === null ? 'no capital limit' : `from ${inr(r.capital, 0)}${r.lowestCapital !== null ? ` · lowest ${inr(r.lowestCapital, 0)}` : ''}`}
          help={{ ...H.backtest.finalCapital, note: H.backtest.lowest.body }}
        />
        <StatCard label="Net P&L" value={signedInr(o.netPnl)} tone={tone(o.netPnl)} hint={`${inr(o.charges, 0)} charges · ${o.trades} trade(s)`} help={{ ...H.paper.net, note: `Gross ${signedInr(o.grossPnl)} − charges ${inr(o.charges)}.` }} />
        <StatCard
          label="Return"
          value={pct(r.returnOnCapitalPct ?? o.returnPct)}
          tone={tone(r.returnOnCapitalPct ?? o.returnPct)}
          hint={r.capital !== null ? `on ${inr(r.capital, 0)} capital` : o.capitalPeak ? `on ${inr(o.capitalPeak, 0)} needed` : undefined}
          help={r.capital !== null ? H.backtest.returnOnCapital : H.paper.ret}
        />
        <StatCard label="Win rate" value={o.winRate === null ? '—' : `${o.winRate.toFixed(0)}%`} hint={`${o.wins} won · ${o.losses} lost`} help={H.paper.winRate} />
        <StatCard
          label="Profit factor"
          value={pf(o)}
          tone={o.profitFactor === null ? (o.wins ? 'bull' : undefined) : o.profitFactor >= 1 ? 'bull' : 'bear'}
          hint={o.avgPnl === null ? 'no trades' : `avg ${signedInr(Math.round(o.avgPnl))} a trade`}
          help={{ ...H.paper.pf, note: o.avgWin !== null || o.avgLoss !== null ? `Average win ${o.avgWin === null ? '—' : signedInr(Math.round(o.avgWin))} · average loss ${o.avgLoss === null ? '—' : signedInr(Math.round(o.avgLoss))}.` : undefined }}
        />
        <StatCard label="Max drawdown" value={o.maxDrawdown ? signedInr(Math.round(o.maxDrawdown)) : '₹0'} tone={o.maxDrawdown < 0 ? 'bear' : undefined} hint={r.skipped.length ? `${r.skipped.length} alert(s) not traded` : 'every alert traded'} help={H.paper.drawdown} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PnlPanel sum={r.summary} />
        <div className="flex flex-col gap-4">
          <Panel title="How trades closed" help={H.paper.howClosed}>
            <HowClosed sum={r.summary} />
          </Panel>
          <Panel title="P&L by entry time" help={H.paper.byHour}>
            <ByHour sum={r.summary} />
          </Panel>
        </div>
      </div>

      <Panel title="By product" help={H.backtest.byProduct} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className={clsx(th, 'w-8')}>#</th>
                <th className={th}>Product</th>
                <Th help={H.paper.trend}>Trend</Th>
                <Th help={H.backtest.alerts}>Alerts</Th>
                <Th help={H.backtest.skipped}>Skipped</Th>
                <Th help={H.paper.trades}>Trades</Th>
                <Th help={H.paper.winRate}>Won</Th>
                <Th help={H.paper.pf}>Profit f.</Th>
                <Th help={H.paper.expectancy}>Avg / trade</Th>
                <Th help={H.paper.net}>Net P&L</Th>
                <Th help={H.paper.ret}>Return</Th>
                <Th help={H.paper.drawdown}>Drawdown</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/50">
              {r.products.map((p, i) => {
                const isOpen = openRow === p.productId;
                return (
                  <Fragment key={p.productId}>
                    <tr>
                      <td className={clsx(td, 'text-slate-500 tabular-nums')}>{i + 1}</td>
                      <td className={td}>
                        <Tooltip content={{ ...H.backtest.contracts, note: p.contracts.join(' · ') || 'No contracts resolved' }}>
                          <button type="button" aria-expanded={isOpen} onClick={() => setOpenRow(isOpen ? null : p.productId)} className="flex items-center gap-1.5 text-left">
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                            <span className="leading-tight">
                              <span className="block font-medium text-slate-200">{p.symbol}</span>
                              <span className="block max-w-[12rem] truncate text-[11px] text-slate-500">{p.name}</span>
                            </span>
                            {p.errors.length > 0 && <span className="rounded bg-warn/15 px-1 text-[9px] font-medium uppercase tracking-wide text-warn">data</span>}
                          </button>
                        </Tooltip>
                      </td>
                      <td className={td}>
                        <Sparkline points={p.spark} />
                      </td>
                      <td className={clsx(td, 'tabular-nums')}>{p.alerts}</td>
                      <td className={clsx(td, 'tabular-nums', p.skipped ? 'text-warn' : 'text-slate-500')}>{p.skipped}</td>
                      <StatCells s={p.stats} />
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={12} className="bg-ink-950/40 px-4 py-3 text-xs">
                          <p className="text-slate-300">
                            <span className="text-slate-500">Contracts:</span> {p.contracts.join(' · ') || '—'}
                          </p>
                          {p.errors.map((e) => (
                            <p key={e} className="mt-1 text-warn">
                              {e}
                            </p>
                          ))}
                          {p.notes.map((n) => (
                            <p key={n} className="mt-1 text-slate-500">
                              {n}
                            </p>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Trades" help={H.backtest.trades} flush>
        {r.trades.length ? (
          <TradeTable
            trades={r.trades.slice(0, rows)}
            names={names}
            opened
            footer={<LoadMore hasMore={r.trades.length > rows} loading={false} onMore={() => setRows((n) => n + 50)} shown={Math.min(rows, r.trades.length)} noun="trades" help={H.paper.more} />}
          />
        ) : (
          <EmptyState title="No trades" hint="No alert in this period became a trade — see the alerts not traded below." />
        )}
      </Panel>

      {r.skipped.length > 0 && (
        <Panel
          title={`Alerts not traded (${r.skipped.length})`}
          help={H.backtest.skippedList}
          flush
          aside={
            <Tooltip content={H.backtest.skippedList}>
              <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setShowSkipped(!showSkipped)}>
                {showSkipped ? 'Hide' : 'Show'}
              </button>
            </Tooltip>
          }
        >
          {showSkipped && (
            <>
              <ul className="divide-y divide-ink-700/50 text-xs">
                {r.skipped.slice(0, skippedRows).map((s, i) => (
                  <li key={`${s.at}-${i}`} className="flex flex-wrap gap-3 px-4 py-2">
                    <span className="w-28 text-slate-400">{istStampIso(s.at)}</span>
                    <span className="w-24 font-medium text-slate-200">{symbol(s.productId)}</span>
                    <span className="text-slate-300">{s.reason}</span>
                  </li>
                ))}
              </ul>
              <LoadMore hasMore={r.skipped.length > skippedRows} loading={false} onMore={() => setSkippedRows((n) => n + 50)} shown={Math.min(skippedRows, r.skipped.length)} noun="alerts" />
            </>
          )}
        </Panel>
      )}

      <Tooltip content={H.backtest.notes} className="block">
        <ul className="list-disc pl-5 text-[11px] text-slate-500">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Tooltip>
    </div>
  );
}

/** A backtest running on the server: products done, time left, Kite requests, cancel. */
function JobProgress({ job, marketOpen, onCancel, cancelling }: { job: BacktestJob; marketOpen: boolean; onCancel: () => void; cancelling: boolean }) {
  const pct = job.total ? (job.done / job.total) * 100 : 0;
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-accent/30 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <InlineSpinner className="w-3.5 h-3.5 text-accent" />
        <Tooltip content={H.backtest.progress}>
          <span className="font-semibold text-slate-200">
            {job.phase === 'TRADES' ? 'Trading every alert minute by minute…' : `Fetching candles · ${job.done.toLocaleString('en-IN')} / ${job.total.toLocaleString('en-IN')} products`}
          </span>
        </Tooltip>
        {job.current && <span className="text-slate-400">{job.current}</span>}
        {job.phase === 'CANDLES' && <span className="text-slate-400">· {job.etaSeconds === null ? 'estimating time left…' : `~${duration(job.etaSeconds)} left`}</span>}
        <Tooltip content={H.backtest.calls}>
          <span className="text-slate-500">
            · {job.fetched.toLocaleString('en-IN')} Kite request{job.fetched === 1 ? '' : 's'}
            {job.cached > 0 && ` · ${job.cached.toLocaleString('en-IN')} from memory`}
          </span>
        </Tooltip>
        <Tooltip content={H.backtest.cancel} className="ml-auto">
          <button type="button" className="btn-ghost py-1 text-xs" disabled={cancelling} onClick={onCancel}>
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </Tooltip>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done} aria-label="Products done">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {job.strategyName} — runs in the background: switch tabs freely, the result waits here.
        {marketOpen && (
          <Tooltip content={H.backtest.marketOpen}>
            <span className="ml-1 text-warn">A market is open — live scans share Kite’s queue with this backtest.</span>
          </Tooltip>
        )}
      </p>
    </div>
  );
}

export function BacktestTab({ initialStrategyId }: { initialStrategyId?: string }) {
  const strategies = useQuery({ queryKey: ['v2-strategies'], queryFn: v2Api.strategies });
  const settings = useQuery({ queryKey: ['v2-paper-settings'], queryFn: v2Api.paperSettings, staleTime: 30_000 });
  const [strategyId, setStrategyId] = useState(initialStrategyId ?? '');
  const [products, setProducts] = useState<string[]>([]);
  const [range, setRange] = useState({ from: daysAgo(4), to: istToday() });
  const [capital, setCapital] = useState<number | null>(BACKTEST_DEFAULT_CAPITAL);
  const [plan, setPlan] = useState<PaperPlan | null>(null);
  const [expiry, setExpiry] = useState<ConnectionConfig['expiry']>({ mode: 'CURRENT' });
  const [shift, setShift] = useState(0);
  const [trigger, setTrigger] = useState<'ON_TRANSITION' | 'WHILE_TRUE'>('ON_TRANSITION');
  const [exits, setExits] = useState<Record<string, GroupNode>>({});
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['v2-status'], queryFn: v2Api.status, staleTime: 30_000 });
  const marketOpen = Boolean(status.data && (status.data.markets.NSE.open || status.data.markets.MCX.open));
  // The backtest runs on the server as a job: poll it while it runs.
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useQuery({
    queryKey: ['v2-backtest-job', jobId],
    queryFn: () => v2Api.backtestJob(jobId!),
    enabled: jobId !== null,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 1000 : false),
  });
  const j = job.data;
  const running = j?.status === 'RUNNING';
  const result: BacktestResult | null = j?.status === 'DONE' ? (j.result ?? null) : null;
  /** The form of the backtest picked up on opening, applied once its strategy is loaded. */
  const restore = useRef<BacktestRequest | null>(null);
  useEffect(() => {
    if (initialStrategyId) setStrategyId(initialStrategyId);
  }, [initialStrategyId]);
  // On opening (e.g. back from another tab): pick up the latest backtest — still running, or its result.
  useEffect(() => {
    let live = true;
    v2Api.latestBacktest().then(
      (latest) => {
        if (!live || !latest || (initialStrategyId && latest.strategyId !== initialStrategyId)) return;
        const r = latest.request;
        restore.current = r;
        qc.setQueryData(['v2-backtest-job', latest.id], latest);
        setJobId(latest.id);
        setStrategyId(r.strategyId);
        setProducts(r.products);
        setRange({ from: r.from, to: r.to });
        setCapital(r.capital);
        setExpiry(r.expiry ?? { mode: 'CURRENT' });
        setShift(r.strikeShift ?? 0);
        setTrigger(r.trigger ?? 'ON_TRANSITION');
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, []);
  const strategy = strategies.data?.find((s) => s.id === strategyId);
  const def = strategy?.definition;
  const tf = def?.evaluation.triggerTimeframe;
  const hasOptions = def?.legs.some((l) => l.kind === 'CE' || l.kind === 'PE');
  // Start from the strategy's paper settings each time the strategy changes.
  useEffect(() => {
    if (!def) return setPlan(null);
    const r = restore.current;
    if (r?.strategyId === strategyId && settings.data) {
      restore.current = null;
      setPlan({ ...r.plan, rules: resolveRules(def, r.plan.rules) });
      setExits(Object.fromEntries((r.exits ?? []).flatMap((x): Array<[string, GroupNode]> => (x.when.type === 'AND' || x.when.type === 'OR' ? [[ruleKey(x), x.when]] : []))));
      return;
    }
    const saved = settings.data?.plans[strategyId];
    setPlan(saved ? { ...saved, rules: resolveRules(def, saved.rules) } : defaultPaperPlan(def));
    setExits({});
  }, [strategyId, def, settings.data]);
  const names = useMemo(() => new Map((strategies.data ?? []).map((s) => [s.id, s.name])), [strategies.data]);
  const reversed = range.from > range.to;
  // Rough, per product: one request per leg, one for the price that sets ATM and ~1–2 for the traded contracts' minutes.
  const estimate = def ? products.length * (def.legs.length + 2.5) * SECONDS_PER_REQUEST : 0;

  const run = useMutation({
    mutationFn: () => {
      // Exit rules of the groups that still trade (a group switched to "don't trade" drops its rule).
      const rules = resolveRules(def!, plan!.rules);
      const sent = rules.filter((r) => r.leg && exits[ruleKey(r)]?.children.length).map((r) => ({ group: r.group, when: exits[ruleKey(r)]! }));
      return v2Api.startBacktest({ strategyId, products, from: range.from, to: range.to, plan: plan!, capital, expiry, strikeShift: shift, trigger, exits: sent });
    },
    onSuccess: (started) => {
      qc.setQueryData(['v2-backtest-job', started.id], started);
      setJobId(started.id);
    },
  });
  const cancel = useMutation({
    mutationFn: () => v2Api.cancelBacktest(jobId!),
    onSuccess: (cancelled) => qc.setQueryData(['v2-backtest-job', cancelled.id], cancelled),
  });

  return (
    <div className="flex flex-col gap-4">
      <Section title="Backtest a strategy with money" help={H.backtest.section}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip content={H.backtest.strategy}>
              <select aria-label="Strategy" className="input py-1.5 text-sm min-w-[16rem]" value={strategyId} onChange={(e) => (setStrategyId(e.target.value), !running && setJobId(null), setProducts([]))}>
                <option value="">Choose a strategy…</option>
                {strategies.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Tooltip>
            {def?.legs.map((l) => (
              <LegBadge key={l.id} leg={l} />
            ))}
            {tf && <span className="text-[11px] text-slate-500">· {TIMEFRAME[tf].label} candles</span>}
          </div>

          {def && plan && (
            <>
              <ProductPicker selected={products} onChange={setProducts} definition={def} />

              <div className="flex flex-wrap items-end gap-5">
                <Cell label="Period" help={H.backtest.period}>
                  <input type="date" aria-label="From" className="input py-1 text-xs" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
                  <span className="text-xs text-slate-500">to</span>
                  <input type="date" aria-label="To" className="input py-1 text-xs" value={range.to} min={range.from} max={istToday()} onChange={(e) => setRange({ ...range, to: e.target.value })} />
                </Cell>
                <Cell label="Quick" help={H.backtest.quick}>
                  {QUICK.map((q) => (
                    <Tooltip key={q.days} content={{ ...H.backtest.quick, title: `Last ${q.days} days` }}>
                      <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setRange({ from: daysAgo(q.days - 1), to: istToday() })}>
                        {q.label}
                      </button>
                    </Tooltip>
                  ))}
                </Cell>
                <Cell label="Starting capital" help={H.backtest.capital}>
                  <span className="text-xs text-slate-400">₹</span>
                  <NumberInput
                    label="Starting capital"
                    min={1000}
                    max={1e10}
                    step={10_000}
                    disabled={capital === null}
                    className="input py-1 text-xs w-32 tabular-nums disabled:opacity-40"
                    value={capital}
                    placeholder="no limit"
                    onChange={setCapital}
                  />
                  <Toggle checked={capital === null} onChange={(off) => setCapital(off ? null : BACKTEST_DEFAULT_CAPITAL)} label="No limit" help={H.backtest.noLimit} />
                </Cell>
              </div>
              {reversed && <p className="-mt-2 text-xs text-warn">“From” must be on or before “to”.</p>}

              <div className="rounded-lg border border-ink-700/60 bg-ink-950/30 p-3">
                <p className="mb-2 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Trades — from the strategy’s paper settings, changed here only for this test <InfoTip content={H.backtest.section} />
                </p>
                <div className="flex flex-col gap-3">
                  <PaperTermsFields value={plan} onChange={setPlan} hasGroups={paperGroups(def).length > 0} />
                  <PaperRulesEditor def={def} rules={resolveRules(def, plan.rules)} onChange={(rules) => setPlan({ ...plan, rules })} />
                </div>
              </div>

              <ExitRulesEditor def={def} rules={resolveRules(def, plan.rules)} exits={exits} onChange={setExits} />

              <div className="flex flex-wrap items-end gap-5">
                <Cell label={hasOptions ? 'Option expiry' : 'Futures expiry'} help={H.connection.expiry}>
                  <select aria-label="Expiry" className="input py-1 text-xs" value={expiry.mode} onChange={(e) => setExpiry({ mode: e.target.value as 'CURRENT' })}>
                    {EXPIRY_MODES.filter((m) => m.mode !== 'SPECIFIC').map((m) => (
                      <option key={m.mode} value={m.mode}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Cell>
                {hasOptions && (
                  <Cell label="Strike position" help={H.compare.strikeShift}>
                    <select aria-label="Strike position" className="input py-1 text-xs" value={shift} onChange={(e) => setShift(Number(e.target.value))}>
                      {[-3, -2, -1, 0, 1, 2, 3].map((s) => (
                        <option key={s} value={s}>
                          {s === 0 ? 'Around ATM' : `${s > 0 ? '+' : ''}${s} strike${Math.abs(s) === 1 ? '' : 's'}`}
                        </option>
                      ))}
                    </select>
                  </Cell>
                )}
                <Cell label="Alert when" help={H.connection.trigger}>
                  <Segmented
                    label="Alert trigger"
                    value={trigger}
                    onChange={setTrigger}
                    options={[
                      { value: 'ON_TRANSITION', label: 'Becomes true', help: { title: 'Becomes true', body: 'Trade the first candle it turns true after being false.' } },
                      { value: 'WHILE_TRUE', label: 'While true', help: { title: 'While true', body: 'Alert on every candle it stays true (an open trade of the same group is kept).' } },
                    ]}
                  />
                </Cell>
                <Tooltip content={H.backtest.run}>
                  <button type="button" className="btn-primary" disabled={!products.length || run.isPending || running || reversed} onClick={() => run.mutate()}>
                    {run.isPending || running ? <InlineSpinner /> : <FlaskConical className="w-4 h-4" />} Backtest {products.length || ''} product{products.length === 1 ? '' : 's'}
                  </button>
                </Tooltip>
                {products.length > 0 && !running && (
                  <Tooltip content={{ ...H.backtest.run, title: 'Rough waiting time', note: 'An estimate before it starts: one Kite request per leg and per traded contract, per product. Candles still in memory from a run in the last hour are free.' }}>
                    <span className="self-center text-[11px] text-slate-500">≈ {duration(estimate)} of Kite requests</span>
                  </Tooltip>
                )}
              </div>
              {j && running && <JobProgress job={j} marketOpen={marketOpen} onCancel={() => cancel.mutate()} cancelling={cancel.isPending} />}
              {j?.status === 'CANCELLED' && <p className="text-xs text-slate-400">Backtest cancelled. The candles fetched so far stay in memory for an hour, so running it again picks up quickly.</p>}
              {j?.status === 'FAILED' && <p className="text-xs text-bear">{j.error}</p>}
              {(run.error || job.error || cancel.error) && <p className="text-xs text-bear">{((run.error ?? job.error ?? cancel.error) as Error).message}</p>}
            </>
          )}
          {!strategies.data?.length && !strategies.isLoading && <EmptyState title="No strategies yet" hint="Create a strategy first." />}
        </div>
      </Section>

      {result && <Results r={result} names={names} />}
    </div>
  );
}
