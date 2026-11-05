'use client';

/**
 * Backtest: "if I had traded this strategy on these products, what would I have made?"
 *   setup    strategy · products · period · the strategy's trade plan — size, target / stop-loss / trailing stop,
 *            watch window, what each group trades, trailing rules (editable to try out; "Save to
 *            strategy" makes it the plan paper trading uses) · alert settings
 *   results  P&L, return on the money needed, the paper-trading figures and charts, by product, every trade,
 *            alerts that weren't traded (and why), how it was tested
 * Two sources, one page: Kite (the Backtest tab — today's contracts) and Upstox (the Options tab — expired
 * contracts re-picked at every candle, NSE / BSE only, complete past days only, an Upstox login).
 * Nothing is saved or sent.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Download, FlaskConical, LogIn, LogOut, Save, X } from 'lucide-react';
import clsx from 'clsx';
import type { BacktestJob, BacktestRequest, BacktestResult, ConnectionConfig, PaperPlan } from '@/shared/v2';
import { EXPIRY_MODES, TIMEFRAME, defaultPaperPlan, hasCondition, paperGroups, planSizing, resolveRules, watchWindowIssue } from '@/shared/v2';
import { InfoTip, Tooltip } from '../../components/Tooltip';
import { EmptyState, StatCard } from '../../components/ui';
import { InlineSpinner } from '../../components/loaders';
import { v2Api } from '../api';
import { Cell, LegBadge, Section, Segmented } from '../components';
import { daysAgo, istStampIso, istToday } from '../format';
import { H } from '../help';
import { ProductPicker } from '../ProductPicker';
import { PaperRulesEditor } from '../strategies/PaperPlanEditor';
import { ConditionsEditor } from '../paper/ConditionsEditor';
import { Sparkline } from '../paper/charts';
import { inr, pct, pnlClass, signedInr } from '../paper/money';
import { PaperTermsFields } from '../paper/PaperFields';
import { ByHour, HowClosed, Panel, PnlPanel, StatCells, StatHeads, Th, TradeTable, download, pf, statColumns, td, th, toCsv } from '../paper/PaperTab';
import { ColumnHead, FilterSummary, NoMatchRow, useTable, type Column } from '../../components/table/ColumnFilters';
import { LoadMore } from '../LoadMore';
import { QuickPeriods, quickRange } from '../../components/QuickPeriods';
import { lastWeekday, latestTradingDay, type QuickPeriodKey } from '../../components/periods';

/** Quick periods: the platform's lookbacks, plus 5 and 10 days for intraday tests. */
const QUICK: readonly QuickPeriodKey[] = ['1D', '5D', '1W', '10D', '1M', '3M', '6M', '1Y', '2Y', '3Y'];

/** The backtest's job endpoints (one runs at a time; starting another cancels it). */
const jobs = { key: 'v2-backtest-job', start: v2Api.startBacktest, get: v2Api.backtestJob, latest: v2Api.latestBacktest, cancel: v2Api.cancelBacktest };
const symbolOfId = (id: string) => id.split(':')[1] ?? id;
const isMcx = (id: string) => id.startsWith('MCX:');

/**
 * Where each selected product's candles will come from — the same rule the server applies (V2Service.backtestRoute):
 * NSE / BSE with a strategy that reads contracts and an Upstox login → index from Kite, contracts from Upstox; the
 * rest Kite only.
 */
function dataRoute(products: string[], readsContracts: boolean, upstox: { configured: boolean; connected: boolean } | undefined) {
  const mcx = products.filter(isMcx);
  const nse = products.filter((id) => !isMcx(id));
  const upstoxOn = !!upstox?.connected;
  const split = readsContracts && upstoxOn ? nse : [];
  const kiteNse = readsContracts && !upstoxOn ? nse : [];
  return { split, mcx: readsContracts ? mcx : [], kiteNse, spotOnly: readsContracts ? [] : products, upstoxOn };
}
/** Kite answers ~3 candle requests a second. */
const SECONDS_PER_REQUEST = 0.35;
const duration = (seconds: number) => {
  const m = Math.round(seconds / 60);
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** A plan as text for "changed?" — conditions that are absent, null or empty all read as none. */
const planKey = (p: PaperPlan) =>
  JSON.stringify({
    ...p,
    rules: p.rules.map((r) => ({ group: r.group, leg: r.leg, side: r.side, stopWhen: hasCondition(r.stopWhen) ? r.stopWhen : null })),
  });

/** What to change when alerts were skipped for this reason. */
function skipHint(reason: string): string | null {
  if (reason.startsWith('After the')) return 'Switch “Square off daily” off in the trades settings to hold positions overnight.';
  if (reason.startsWith('An index can’t be traded')) return 'In “What each group trades”, pick the future or an option leg instead of the index.';
  if (/doesn['’]t trade/.test(reason)) return 'In “What each group trades”, choose a leg for that group.';
  if (reason.startsWith('No price')) return 'There were no candles for that contract at the alert — it may not have traded yet.';
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

type ProductRow = BacktestResult['products'][number];
type SkipRow = BacktestResult['skipped'][number];

const PRODUCT_COLUMNS: Column<ProductRow>[] = [
  {
    key: 'product',
    label: 'Product',
    help: { title: 'Product', body: 'Open a row for the contracts it used and its data notes.' },
    fields: [
      { key: 'product', label: 'Product', type: 'enum', value: (p) => p.symbol },
      { key: 'name', label: 'Name', type: 'text', value: (p) => p.name },
      { key: 'contracts', label: 'Contracts used', type: 'text', noSort: true, value: (p) => p.contracts },
      { key: 'data', label: 'Data', type: 'enum', noSort: true, value: (p) => (p.errors.length ? 'Data problems' : 'Complete') },
    ],
  },
  { key: 'alerts', label: 'Alerts', help: H.backtest.alerts, type: 'number', value: (p) => p.alerts },
  { key: 'skipped', label: 'Skipped', help: H.backtest.skipped, type: 'number', value: (p) => p.skipped },
  ...statColumns<ProductRow>((p) => p.stats),
];

function Results({ r, names: known }: { r: BacktestResult; names: Map<string, string> }) {
  const names = useMemo(() => new Map([...known, [r.strategyId, r.strategyName]]), [known, r.strategyId, r.strategyName]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [skippedRows, setSkippedRows] = useState(50);
  const [showSkipped, setShowSkipped] = useState(false);
  const o = r.summary.overall;
  const tone = (n: number | null | undefined) => (n === null || n === undefined || Math.abs(n) < 0.005 ? undefined : n > 0 ? 'bull' : 'bear');
  const products = useTable(r.products, PRODUCT_COLUMNS);
  const symbols = useMemo(() => new Map(r.products.map((p) => [p.productId, p.symbol])), [r.products]);
  const symbol = (id: string) => symbols.get(id) ?? id.split(':')[1] ?? id;
  const skipColumns = useMemo<Column<SkipRow>[]>(() => {
    const symbol = (id: string) => symbols.get(id) ?? id.split(':')[1] ?? id;
    return [
      { key: 'at', label: 'Alert at', help: { title: 'Alert at', body: 'When the strategy fired (IST).' }, type: 'datetime', value: (s) => s.at },
      { key: 'product', label: 'Product', help: { title: 'Product', body: 'The product the alert fired on.' }, type: 'enum', value: (s) => symbol(s.productId) },
      { key: 'reason', label: 'Why not traded', help: H.backtest.skippedList, type: 'text', value: (s) => s.reason },
    ];
  }, [symbols]);
  const skipped = useTable(r.skipped, skipColumns);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">{r.strategyName}</span>
        <span>
          · {r.products.length} product{r.products.length === 1 ? '' : 's'} · {r.from} → {r.to} · {TIMEFRAME[r.triggerTimeframe].label} candles · {r.requests} request(s){r.source === 'SPLIT' ? ' · index from Kite, contracts from Upstox' : r.source === 'MIXED' ? ' · Kite + Upstox / Kite only per product' : ' · Kite'}
        </span>
        <Tooltip content={H.paper.csv} className="ml-auto">
          <button type="button" className="btn-ghost py-1 text-xs" disabled={!r.trades.length} onClick={() => download(`backtest-${r.strategyName.replace(/\W+/g, '-')}-${r.from}-${r.to}.csv`, toCsv(r.trades, names))}>
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </Tooltip>
      </div>

      <ResultNotice r={r} />
      {r.checks && r.checks.length > 0 && <DataChecks checks={r.checks} symbol={symbol} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Net P&L" value={signedInr(o.netPnl)} tone={tone(o.netPnl)} hint={`${inr(o.charges, 0)} charges · ${o.trades} trade(s)`} help={{ ...H.paper.net, note: `Gross ${signedInr(o.grossPnl)} − charges ${inr(o.charges)}.` }} />
        <StatCard label="Money needed" value={inr(o.capitalPeak, 0)} hint="most in use at once" help={H.paper.capital} />
        <StatCard label="Return" value={pct(o.returnPct)} tone={tone(o.returnPct)} hint={o.capitalPeak ? `on ${inr(o.capitalPeak, 0)} needed` : undefined} help={H.paper.ret} />
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
        <FilterSummary table={products} noun="products" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className={clsx(th, 'w-8')}>#</th>
                <ColumnHead table={products} k="product" className={th} />
                <Th help={H.paper.trend}>Trend</Th>
                <ColumnHead table={products} k="alerts" className={th} />
                <ColumnHead table={products} k="skipped" className={th} />
                <StatHeads table={products} />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/50">
              <NoMatchRow table={products} colSpan={12} />
              {products.rows.map((p, i) => {
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
                        <DataBadge data={p.data} />
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
          <TradeTable trades={r.trades} names={names} opened pageSize={50} />
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
              <FilterSummary table={skipped} noun="alerts" />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <ColumnHead table={skipped} k="at" className={th} />
                      <ColumnHead table={skipped} k="product" className={th} />
                      <ColumnHead table={skipped} k="reason" className={th} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700/50">
                    <NoMatchRow table={skipped} colSpan={3} />
                    {skipped.rows.slice(0, skippedRows).map((s, i) => (
                      <tr key={`${s.at}-${s.productId}-${i}`}>
                        <td className={clsx(td, 'text-slate-400')}>{istStampIso(s.at)}</td>
                        <td className={clsx(td, 'font-medium text-slate-200')}>{symbol(s.productId)}</td>
                        <td className={clsx(td, 'whitespace-normal text-slate-300')}>{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <LoadMore hasMore={skipped.rows.length > skippedRows} loading={false} onMore={() => setSkippedRows((n) => n + 50)} shown={Math.min(skippedRows, skipped.rows.length)} noun="alerts" />
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

/** A backtest running on the server: products done, time left, Kite / Upstox requests, cancel. */
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
            · {job.fetched.toLocaleString('en-IN')} request{job.fetched === 1 ? '' : 's'}
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

/** The Upstox login every NSE / BSE contract needs: who is connected and until when, or the way to log in (and what went wrong). */
function UpstoxConnection() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['v2-options-status'], queryFn: v2Api.optionsStatus, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const logout = useMutation({ mutationFn: v2Api.optionsLogout, onSuccess: () => qc.invalidateQueries({ queryKey: ['v2-options-status'] }) });
  const s = status.data;
  const returned = params.get('upstox');
  const message = params.get('message');
  if (!s) return status.error ? <p className="text-xs text-warn">Upstox status: {(status.error as Error).message}</p> : null;
  if (!s.configured) {
    return (
      <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-slate-300">
        <p className="flex items-center gap-1 font-semibold text-warn">
          {H.upstox.notConfigured.title} <InfoTip content={H.upstox.notConfigured} />
        </p>
        <p className="mt-0.5">{H.upstox.notConfigured.body}</p>
        <p className="mt-0.5 text-slate-500">{H.upstox.notConfigured.note}</p>
      </div>
    );
  }
  const connected = s.connected;
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-2.5 text-xs', connected ? 'border-ink-700/60 bg-ink-950/30' : 'border-warn/30 bg-warn/5')}>
      <Tooltip content={H.upstox.connection}>
        <span className="font-semibold text-slate-200">Upstox</span>
      </Tooltip>
      {connected ? (
        <span className="text-slate-400">
          logged in{s.userName ? ` as ${s.userName}` : ''}
          {s.userId ? ` (${s.userId})` : ''}
          {s.expiresAt ? ` · until ${istStampIso(s.expiresAt)} IST` : ''}
        </span>
      ) : (
        <span className="text-warn">not logged in{s.lastError ? ` — ${s.lastError}` : ''}</span>
      )}
      {returned === 'error' && message && <span className="basis-full text-warn">Login failed: {message}</span>}
      {connected ? (
        <Tooltip content={H.upstox.disconnect} className="ml-auto">
          <button type="button" className="btn-ghost py-1 text-xs" disabled={logout.isPending} onClick={() => logout.mutate()}>
            <LogOut className="w-3.5 h-3.5" /> Log out
          </button>
        </Tooltip>
      ) : (
        <Tooltip content={H.upstox.connect} className="ml-auto">
          <a className="btn-primary py-1 text-xs" href={v2Api.upstoxLoginUrl}>
            <LogIn className="w-3.5 h-3.5" /> Connect Upstox
          </a>
        </Tooltip>
      )}
    </div>
  );
}

/** Kite + Upstox / Kite only — where a product's candles came from. */
function DataBadge({ data }: { data?: BacktestResult['products'][number]['data'] }) {
  const split = data === 'SPLIT';
  return (
    <Tooltip content={split ? H.backtest.dataSplit : H.backtest.dataKite}>
      <span className={clsx('mt-0.5 inline-block cursor-help rounded px-1 text-[9px] font-medium uppercase tracking-wide', split ? 'bg-accent/10 text-accent-soft' : 'bg-ink-800 text-slate-500')}>{split ? 'Kite + Upstox' : 'Kite only'}</span>
    </Tooltip>
  );
}

type CheckRow = NonNullable<BacktestResult['checks']>[number];
const checkVerdict = (c: CheckRow) => (c.ok === true ? 'Agree' : c.ok === false ? 'Flagged' : 'Not compared');

/** Kite vs Upstox on the same candles — so a run that mixes them shows how far apart they are. */
function DataChecks({ checks, symbol }: { checks: CheckRow[]; symbol: (id: string) => string }) {
  const columns = useMemo<Column<CheckRow>[]>(
    () => [
      {
        key: 'what',
        label: 'Compared',
        help: { title: 'Compared', body: 'The product and what was compared: its index / stock on the trigger interval, or one contract both list on 1-minute candles.' },
        fields: [
          { key: 'product', label: 'Product', type: 'enum', value: (c) => symbol(c.productId) },
          { key: 'what', label: 'What', type: 'text', value: (c) => c.what },
        ],
      },
      { key: 'days', label: 'Days', help: { title: 'Days', body: 'The IST dates compared (the last of the period).' }, type: 'date', value: (c) => c.from },
      { key: 'matched', label: 'Candles', help: { title: 'Candles', body: 'Candles present at the exact same minute in both.' }, type: 'number', value: (c) => c.matched },
      { key: 'median', label: 'Median gap', help: { title: 'Median gap', body: '|Kite − Upstox| ÷ Kite — half the candles differ by less.' }, type: 'number', unit: '%', value: (c) => c.medianDiffPct },
      { key: 'max', label: 'Largest gap', help: { title: 'Largest gap', body: 'The biggest difference on one candle.' }, type: 'number', unit: '%', value: (c) => c.maxDiffPct },
      { key: 'tick', label: 'Within a tick', help: { title: 'Within a tick', body: 'Share of closes no more than one tick apart.' }, type: 'number', unit: '%', value: (c) => c.withinTickPct },
      { key: 'verdict', label: 'Verdict', help: H.backtest.checks, type: 'enum', order: ['Flagged', 'Agree', 'Not compared'], value: checkVerdict },
    ],
    [symbol],
  );
  const t = useTable(checks, columns);
  const flagged = checks.filter((c) => c.ok === false).length;
  const n = (v: number | null) => (v === null ? '—' : `${v.toFixed(v < 0.01 && v > 0 ? 4 : 2)}%`);
  return (
    <Panel title={`Data check — Kite vs Upstox${flagged ? ` (${flagged} flagged)` : ''}`} help={H.backtest.checks} flush>
      <FilterSummary table={t} noun="checks" />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((c) => (
                <ColumnHead key={c.key} table={t} k={c.key} className={th} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/50">
            <NoMatchRow table={t} colSpan={columns.length} />
            {t.rows.map((c, i) => (
              <tr key={`${c.productId}-${c.what}-${i}`}>
                <td className={td}>
                  <span className="font-medium text-slate-200">{symbol(c.productId)}</span> <span className="text-slate-400">{c.what}</span>
                  {c.note && <span className="block whitespace-normal text-[11px] text-slate-500">{c.note}</span>}
                </td>
                <td className={clsx(td, 'text-slate-400')}>{c.from === c.to ? c.from : `${c.from} → ${c.to}`}</td>
                <td className={clsx(td, 'tabular-nums')}>{c.matched}</td>
                <td className={clsx(td, 'tabular-nums')}>{n(c.medianDiffPct)}</td>
                <td className={clsx(td, 'tabular-nums')}>{n(c.maxDiffPct)}</td>
                <td className={clsx(td, 'tabular-nums')}>{c.withinTickPct === null ? '—' : `${c.withinTickPct.toFixed(0)}%`}</td>
                <td className={td}>
                  <Tooltip content={H.backtest.checks}>
                    <span className={clsx('cursor-help rounded px-1.5 py-0.5 text-[10px] font-medium', c.ok === true ? 'bg-ink-800 text-slate-300' : c.ok === false ? 'bg-warn/15 text-warn' : 'bg-ink-800 text-slate-500')}>{checkVerdict(c)}</span>
                  </Tooltip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Before running: where each selected product's candles will come from. */
function RouteLine({ route }: { route: ReturnType<typeof dataRoute> }) {
  const list = (ids: string[]) => ids.map(symbolOfId).join(', ');
  const rows: Array<{ ids: string[]; text: string; warn?: boolean }> = [
    { ids: route.split, text: 'index / stock from Kite · every contract from Upstox, as listed (expired ones included), re-picked every candle · ends yesterday at the latest' },
    { ids: route.kiteNse, text: 'Kite only — Upstox isn’t connected, so today’s contracts with strikes fixed at the start. Connect Upstox above for expired contracts.', warn: true },
    { ids: route.mcx, text: 'Kite only — Upstox has no MCX, so today’s contracts with strikes fixed at the start' },
    { ids: route.spotOnly, text: 'Kite — the strategy reads no contracts' },
  ].filter((r) => r.ids.length);
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-ink-700/60 bg-ink-950/30 px-3 py-2 text-[11px]">
      <span className="flex items-center gap-1 font-semibold text-slate-300">
        Where the data comes from <InfoTip content={H.backtest.dataRoute} />
      </span>
      {rows.map((r) => (
        <span key={r.text} className={r.warn ? 'text-warn' : 'text-slate-400'}>
          <span className="font-medium text-slate-200">{list(r.ids)}</span> — {r.text}
        </span>
      ))}
    </div>
  );
}

export function BacktestTab({ initialStrategyId }: { initialStrategyId?: string }) {
  const strategies = useQuery({ queryKey: ['v2-strategies'], queryFn: v2Api.strategies });
  const settings = useQuery({ queryKey: ['v2-paper-settings'], queryFn: v2Api.paperSettings, staleTime: 30_000 });
  const upstoxStatus = useQuery({ queryKey: ['v2-options-status'], queryFn: v2Api.optionsStatus, staleTime: 30_000 });
  const [strategyId, setStrategyId] = useState(initialStrategyId ?? '');
  const [products, setProducts] = useState<string[]>([]);
  const [range, setRange] = useState(() => quickRange('5D', latestTradingDay(null), istToday()));
  const [plan, setPlan] = useState<PaperPlan | null>(null);
  const [expiry, setExpiry] = useState<ConnectionConfig['expiry']>({ mode: 'CURRENT' });
  const [shift, setShift] = useState(0);
  const [trigger, setTrigger] = useState<'ON_TRANSITION' | 'WHILE_TRUE'>('ON_TRANSITION');
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['v2-status'], queryFn: v2Api.status, staleTime: 30_000 });
  const marketOpen = Boolean(status.data && (status.data.markets.NSE.open || status.data.markets.MCX.open));
  // The backtest runs on the server as a job: poll it while it runs.
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useQuery({
    queryKey: [jobs.key, jobId],
    queryFn: () => jobs.get(jobId!),
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
    jobs.latest().then(
      (latest) => {
        if (!live || !latest || (initialStrategyId && latest.strategyId !== initialStrategyId)) return;
        const r = latest.request;
        restore.current = r;
        qc.setQueryData([jobs.key, latest.id], latest);
        setJobId(latest.id);
        setStrategyId(r.strategyId);
        setProducts(r.products);
        setRange({ from: r.from, to: r.to });
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
  const readsContracts = !!def?.legs.some((l) => l.kind !== 'SPOT');
  const route = dataRoute(products, readsContracts, upstoxStatus.data);
  // Upstox serves complete past days only: a run reading its contracts ends yesterday at the latest.
  const viaUpstox = route.split.length > 0;
  const lastDay = viaUpstox ? daysAgo(1) : istToday();
  const quickEnd = viaUpstox ? lastWeekday(lastDay) : latestTradingDay(null);
  useEffect(() => {
    if (range.to > lastDay) setRange((r) => ({ from: r.from > lastDay ? lastDay : r.from, to: lastDay }));
  }, [lastDay, range.to]);
  // The strategy's plan as saved (what paper trading trades); the form starts from it each time the strategy changes.
  const saved = useMemo(() => {
    if (!def) return null;
    const p = settings.data?.plans[strategyId];
    return p ? { ...p, rules: resolveRules(def, p.rules) } : defaultPaperPlan(def);
  }, [def, settings.data, strategyId]);
  useEffect(() => {
    if (!def) return setPlan(null);
    const r = restore.current;
    if (r?.strategyId === strategyId && settings.data) {
      restore.current = null;
      setPlan({ ...saved!, ...r.plan, rules: resolveRules(def, r.plan.rules) });
      return;
    }
    setPlan(saved);
  }, [strategyId, def, settings.data, saved]);
  const rules = def && plan ? resolveRules(def, plan.rules) : [];
  const sizing = def ? planSizing(def, rules) : { lots: true, cash: true };
  // The form differs from the strategy's plan (rules resolved to the current groups; a removed condition = none).
  const changed = !!plan && !!saved && planKey({ ...plan, rules }) !== planKey(saved);
  // Only NSE / BSE products picked: the MCX watch window doesn't apply (hidden, and not checked).
  const nseOnly = products.length > 0 && !products.some(isMcx);
  const planIssue = plan ? watchWindowIssue(nseOnly ? { ...plan, watchMcxFrom: '00:00', watchMcxTo: '23:59' } : plan) : null;
  const savePlan = useMutation({
    mutationFn: () => v2Api.savePaperPlan(strategyId, { ...plan!, rules }),
    onSuccess: () => {
      for (const k of ['v2-paper-settings', 'v2-paper-plan', 'v2-paper']) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const names = useMemo(() => new Map((strategies.data ?? []).map((s) => [s.id, s.name])), [strategies.data]);
  const reversed = range.from > range.to;
  // Rough, per product: one request per leg, one for the price that sets ATM and ~1–2 for the traded contracts' minutes.
  const estimate = def ? products.length * (def.legs.length + 2.5) * SECONDS_PER_REQUEST : 0;

  const run = useMutation({
    mutationFn: () => jobs.start({ strategyId, products, from: range.from, to: range.to, plan: { ...plan!, rules }, expiry, strikeShift: shift, trigger }),
    onSuccess: (started) => {
      qc.setQueryData([jobs.key, started.id], started);
      setJobId(started.id);
    },
  });
  const cancel = useMutation({
    mutationFn: () => jobs.cancel(jobId!),
    onSuccess: (cancelled) => qc.setQueryData([jobs.key, cancelled.id], cancelled),
  });

  return (
    <div className="flex flex-col gap-4">
      <Section title="Backtest a strategy" help={H.backtest.section}>
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
              {readsContracts && (products.length === 0 || products.some((id) => !isMcx(id))) && <UpstoxConnection />}
              <ProductPicker selected={products} onChange={setProducts} definition={def} />

              <div className="flex flex-wrap items-end gap-5">
                <Cell label="Period" help={H.backtest.period}>
                  <input type="date" aria-label="From" className="input py-1 text-xs" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
                  <span className="text-xs text-slate-500">to</span>
                  <input type="date" aria-label="To" className="input py-1 text-xs" value={range.to} min={range.from} max={lastDay} onChange={(e) => setRange({ ...range, to: e.target.value })} />
                </Cell>
                <Cell label="Quick" help={H.backtest.quick}>
                  <QuickPeriods keys={QUICK} end={quickEnd} to={lastDay} value={range} onPick={setRange} help={H.backtest.quick} />
                </Cell>
              </div>
              {reversed && <p className="-mt-2 text-xs text-warn">“From” must be on or before “to”.</p>}

              <div className="rounded-lg border border-ink-700/60 bg-ink-950/30 p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h4 className="ui-section-title text-sm font-semibold text-slate-200">Trade plan</h4>
                  <span className="text-[12px] text-slate-500">the strategy’s plan — paper trading uses the same</span>
                  <InfoTip content={H.backtest.plan} />
                  {changed ? (
                    <Tooltip content={H.backtest.saveToStrategy} className="ml-auto">
                      <button type="button" className="btn-ghost py-0.5 text-[11px]" disabled={savePlan.isPending || !!planIssue} onClick={() => savePlan.mutate()}>
                        {savePlan.isPending ? <InlineSpinner className="w-3 h-3" /> : <Save className="w-3 h-3" />} Save to strategy
                      </button>
                    </Tooltip>
                  ) : (
                    <Tooltip content={H.backtest.savedPlan} className="ml-auto">
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Check className="w-3 h-3" /> Same as the strategy
                      </span>
                    </Tooltip>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                  <PaperTermsFields value={plan} onChange={setPlan} base={saved ?? undefined} hasGroups={paperGroups(def).length > 0} sizing={sizing} nseOnly={nseOnly} />
                  <PaperRulesEditor def={def} rules={rules} onChange={(r) => setPlan({ ...plan, rules: r })} />
                  {plan.trailing && <ConditionsEditor def={def} rules={rules} targetPct={plan.targetPct} onChange={(r) => setPlan({ ...plan, rules: r })} />}
                  {savePlan.error && <p className="text-xs text-bear">{(savePlan.error as Error).message}</p>}
                </div>
              </div>

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
              </div>
              {products.length > 0 && <RouteLine route={route} />}
              <div className="flex flex-wrap items-center gap-5">
                <Tooltip content={H.backtest.run}>
                  <button type="button" className="btn-primary" disabled={!products.length || run.isPending || running || reversed || !!planIssue} onClick={() => run.mutate()}>
                    {run.isPending || running ? <InlineSpinner /> : <FlaskConical className="w-4 h-4" />} Backtest {products.length || ''} product{products.length === 1 ? '' : 's'}
                  </button>
                </Tooltip>
                {products.length > 0 && !running && (
                  <Tooltip content={{ ...H.backtest.run, title: 'Rough waiting time', note: 'An estimate before it starts: one request per leg and per traded contract, per product (Upstox’s contract lists add a few). Candles still in memory from an earlier run are free.' }}>
                    <span className="self-center text-[11px] text-slate-500">≈ {duration(estimate)} of requests</span>
                  </Tooltip>
                )}
              </div>
              {j && running && <JobProgress job={j} marketOpen={marketOpen} onCancel={() => cancel.mutate()} cancelling={cancel.isPending} />}
              {j?.status === 'CANCELLED' && <p className="text-xs text-slate-400">Backtest cancelled. The candles fetched so far stay in memory, so running it again picks up quickly.</p>}
              {j?.status === 'FAILED' && <p className="text-xs text-bear">{j.error}</p>}
              {(run.error || job.error || cancel.error) && <p className="text-xs text-bear">{((run.error ?? job.error ?? cancel.error) as Error).message}</p>}
            </>
          )}
          {!strategies.data?.length && !strategies.isLoading && <EmptyState title="No strategies yet" hint="Create a strategy first." />}
        </div>
      </Section>

      {result && <Results key={j!.id} r={result} names={names} />}
    </div>
  );
}
