'use client';

/**
 * Equity backtest results: the headline figures (vs NIFTY 50), the account value and drawdown, monthly returns,
 * each stock, every trade with its orders (the audit trail: why each buy, add and sale happened, with the values),
 * signals not taken, and the exact rules the simulation followed.
 */
import { Fragment, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import type { EqBacktestResult, EqExitReason, EqTimeframe, EqTrade } from '@/shared/equity';
import { EQ_TIMEFRAME } from '@/shared/equity';
import { InfoTip, Tooltip, type TooltipContent } from '../../components/Tooltip';
import { Badge, EmptyState, StatCard } from '../../components/ui';
import { ChartLink } from '../ChartLink';
import { countLabel, downloadCsv, inr, num, pct, pnlClass, shortDate, signedInr } from '../format';
import { E } from '../help';
import { CurveCharts, MonthlyGrid, compactInr } from './charts';

const th = 'px-2.5 py-2 font-medium whitespace-nowrap text-left';
const td = 'px-2.5 py-2 whitespace-nowrap align-middle';

const REASON: Record<EqExitReason, { label: string; tone: 'bull' | 'bear' | 'warn' | 'default' | 'accent' }> = {
  TARGET: { label: 'Target', tone: 'default' },
  STOP_LOSS: { label: 'Stop-loss', tone: 'default' },
  TRAILING_STOP: { label: 'Trailing stop', tone: 'default' },
  PYRAMID_STOP: { label: 'Pyramid stop', tone: 'accent' },
  EXIT_RULE: { label: 'Exit condition', tone: 'default' },
  TIME: { label: 'Time exit', tone: 'default' },
  END: { label: 'End (held)', tone: 'warn' },
};

function Panel({ title, help, aside, children, flush }: { title: string; help: TooltipContent; aside?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <InfoTip content={help} />
        {aside && <div className="ml-auto flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
      <div className={flush ? '' : 'px-4 pb-4'}>{children}</div>
    </section>
  );
}

function Th({ help, children, right }: { help: TooltipContent; children: string; right?: boolean }) {
  return (
    <th className={clsx(th, right && 'text-right')}>
      <Tooltip content={help}>
        <span className="uppercase tracking-wide">{children}</span>
      </Tooltip>
    </th>
  );
}

function tradesCsv(r: EqBacktestResult) {
  downloadCsv(
    `equity-backtest-${r.strategyName.replace(/\W+/g, '-')}-${r.from}-${r.to}.csv`,
    ['symbol', 'entry_date', 'exit_date', 'exit_reason', 'adds', 'quantity', 'avg_price', 'exit_price', 'invested', 'gross_pnl', 'charges', 'net_pnl', 'return_pct', 'holding_days'],
    r.trades.map((t) => [t.symbol, t.entryDate, t.exitDate, t.exitReason, t.adds, t.quantity, t.avgPrice, t.exitPrice, t.invested, t.grossPnl, t.charges, t.netPnl, t.returnPct, t.holdingDays]),
  );
}

function fillsCsv(r: EqBacktestResult) {
  downloadCsv(
    `equity-orders-${r.strategyName.replace(/\W+/g, '-')}-${r.from}-${r.to}.csv`,
    ['symbol', 'trade', 'date', 'signal_date', 'side', 'kind', 'quantity', 'price', 'charges', 'stop_after', 'reason'],
    r.trades.flatMap((t) => t.fills.map((f) => [t.symbol, t.id, f.date, f.signalDate, f.side, f.kind, f.quantity, f.price, f.charges, f.stopAfter ?? '', f.reason])),
  );
}

function TradeRows({ t, tf, open, onToggle }: { t: EqTrade; tf: EqTimeframe; open: boolean; onToggle: () => void }) {
  const r = REASON[t.exitReason];
  return (
    <Fragment>
      <tr className="hover:bg-ink-800/40">
        <td className={td}>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-expanded={open} onClick={onToggle} className="flex items-center gap-1.5 text-left">
              {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
              <span className="font-medium text-slate-200">{t.symbol}</span>
            </button>
            <ChartLink symbol={t.symbol} tf={tf} when={`${shortDate(t.entryDate)} – ${shortDate(t.exitDate)}`} />
          </div>
        </td>
        <td className={clsx(td, 'text-slate-400')}>{shortDate(t.entryDate)}</td>
        <td className={clsx(td, 'text-slate-400')}>{shortDate(t.exitDate)}</td>
        <td className={clsx(td, 'tabular-nums text-slate-400')}>{t.holdingDays} d</td>
        <td className={clsx(td, 'tabular-nums')}>{t.adds ? <Badge tone="accent">+{t.adds}</Badge> : <span className="text-slate-600">—</span>}</td>
        <td className={clsx(td, 'tabular-nums text-right')}>{t.quantity.toLocaleString('en-IN')}</td>
        <td className={clsx(td, 'tabular-nums text-right')}>{num(t.avgPrice)}</td>
        <td className={clsx(td, 'tabular-nums text-right')}>{num(t.exitPrice)}</td>
        <td className={td}>
          <Tooltip content={{ ...E.backtest.exitReason, note: t.fills.at(-1)?.reason }}>
            <Badge tone={r.tone}>{r.label}</Badge>
          </Tooltip>
        </td>
        <td className={clsx(td, 'tabular-nums text-right text-slate-400')}>{compactInr(t.invested)}</td>
        <td className={clsx(td, 'tabular-nums text-right font-medium', pnlClass(t.netPnl))}>{signedInr(t.netPnl)}</td>
        <td className={clsx(td, 'tabular-nums text-right', pnlClass(t.returnPct))}>{pct(t.returnPct)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={12} className="bg-ink-950/40 px-4 py-3">
            <Tooltip content={E.backtest.fills} className="block">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">Orders — {t.name}</p>
            </Tooltip>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-ink-700/40">
                {t.fills.map((f, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 align-top whitespace-nowrap text-slate-400">{shortDate(f.date)}</td>
                    <td className="py-1.5 pr-3 align-top whitespace-nowrap">
                      <span className={clsx('font-semibold', f.side === 'BUY' ? 'text-slate-200' : 'text-slate-300')}>{f.kind === 'ENTRY' ? 'BUY' : f.kind === 'ADD' ? 'ADD' : 'SELL'}</span>{' '}
                      <span className="tabular-nums text-slate-300">
                        {f.quantity.toLocaleString('en-IN')} @ {num(f.price)}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 align-top whitespace-nowrap tabular-nums text-slate-500">{f.charges ? `charges ${inr(f.charges)}` : ''}</td>
                    <td className="py-1.5 pr-3 align-top whitespace-nowrap tabular-nums text-slate-500">{f.stopAfter !== null ? `stop → ${num(f.stopAfter)}` : ''}</td>
                    <td className="py-1.5 align-top text-slate-400">
                      {f.reason}
                      {f.signalDate !== f.date && <span className="text-slate-600"> · signal {shortDate(f.signalDate)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function Results({ r }: { r: EqBacktestResult }) {
  const s = r.stats;
  const [openTrade, setOpenTrade] = useState<string | null>(null);
  const [openStock, setOpenStock] = useState<string | null>(null);
  const [rows, setRows] = useState(50);
  const [stockRows, setStockRows] = useState(25);
  const [showSkipped, setShowSkipped] = useState(false);
  const tone = (n: number | null) => (n === null || Math.abs(n) < 0.005 ? undefined : n > 0 ? 'bull' : 'bear');
  const traded = useMemo(() => r.perSymbol.filter((p) => p.trades > 0 || p.errors.length || p.notes.length), [r.perSymbol]);
  const dataIssues = r.perSymbol.filter((p) => p.errors.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">{r.strategyName}</span>
        <span>
          · {EQ_TIMEFRAME[r.definition.timeframe].label} · {countLabel(r.perSymbol.map((p) => p.symbol))} · {shortDate(r.from)} → {shortDate(r.to)} · {r.requests.toLocaleString('en-IN')} Kite request(s)
        </span>
        <div className="ml-auto flex gap-2">
          <Tooltip content={E.backtest.csv}>
            <button type="button" className="btn-ghost py-1 text-xs" disabled={!r.trades.length} onClick={() => tradesCsv(r)}>
              <Download className="w-3.5 h-3.5" /> Trades CSV
            </button>
          </Tooltip>
          <Tooltip content={E.backtest.fillsCsv}>
            <button type="button" className="btn-ghost py-1 text-xs" disabled={!r.trades.length} onClick={() => fillsCsv(r)}>
              <Download className="w-3.5 h-3.5" /> Orders CSV
            </button>
          </Tooltip>
        </div>
      </div>

      {dataIssues.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-slate-300">
          <p className="font-medium text-warn">No candles for {dataIssues.length} stock(s)</p>
          <p className="mt-0.5 text-slate-400">{dataIssues.slice(0, 8).map((p) => `${p.symbol}: ${p.errors[0]}`).join(' · ')}{dataIssues.length > 8 ? ` · +${dataIssues.length - 8} more (see By stock)` : ''}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {r.capital !== null ? (
          <StatCard label="Final capital" value={inr(r.finalEquity, 0)} tone={tone(r.netPnl)} hint={`from ${inr(r.capital, 0)} · ${signedInr(r.netPnl)}`} help={E.backtest.finalEquity} />
        ) : (
          <StatCard label="Net P&L" value={signedInr(r.netPnl)} tone={tone(r.netPnl)} hint="no capital limit" help={E.backtest.netPnl} />
        )}
        <StatCard label="Return · CAGR" value={r.returnPct === null ? '—' : pct(r.returnPct)} tone={tone(r.returnPct)} hint={r.cagrPct === null ? 'CAGR needs a month or more' : `${pct(r.cagrPct)} a year`} help={{ ...E.backtest.returnPct, note: E.backtest.cagr.body }} />
        <StatCard label="Max drawdown" value={r.maxDrawdownPct === null ? compactInr(r.maxDrawdown) : pct(r.maxDrawdownPct)} tone={r.maxDrawdown < 0 ? 'bear' : undefined} hint={r.maxDrawdownPct === null ? 'below the best P&L' : compactInr(r.maxDrawdown)} help={E.backtest.drawdown} />
        <StatCard label="Win rate" value={`${num(s.winRate, 1)}%`} hint={`${s.wins} won · ${s.losses} lost`} help={E.backtest.winRate} />
        <StatCard label="Profit factor" value={s.profitFactor === null ? '∞' : num(s.profitFactor)} hint={`avg ${signedInr(s.expectancy)} a trade`} help={{ ...E.backtest.profitFactor, note: E.backtest.expectancy.body }} />
        <StatCard label="Trades" value={s.trades.toLocaleString('en-IN')} hint={`${num(s.avgHoldingDays, 0)} days held avg${s.adds ? ` · ${s.adds} adds` : ''}`} help={{ ...E.backtest.trades, note: E.backtest.holding.body }} />
      </div>
      <div className={clsx('grid grid-cols-2 gap-3', s.charges ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
        <Tooltip content={E.backtest.benchmark} className="block">
          <div className="card p-3 text-xs">
            <p className="text-slate-500">NIFTY 50, bought and held</p>
            {r.benchmark ? (
              <p className="mt-1 tabular-nums text-slate-200">
                <span className={pnlClass(r.benchmark.returnPct)}>{pct(r.benchmark.returnPct)}</span> · CAGR {pct(r.benchmark.cagrPct)} · drawdown {pct(r.benchmark.maxDrawdownPct)}
              </p>
            ) : (
              <p className="mt-1 text-slate-500">Not available</p>
            )}
          </div>
        </Tooltip>
        {s.charges > 0 && (
          <Tooltip content={E.backtest.charges} className="block">
            <div className="card p-3 text-xs">
              <p className="text-slate-500">Charges paid</p>
              <p className="mt-1 tabular-nums text-slate-200">{inr(s.charges, 0)}</p>
            </div>
          </Tooltip>
        )}
        <Tooltip content={E.backtest.exposure} className="block">
          <div className="card p-3 text-xs">
            <p className="text-slate-500">Time invested</p>
            <p className="mt-1 tabular-nums text-slate-200">{num(s.exposurePct, 1)}% of trading days</p>
          </div>
        </Tooltip>
        <Tooltip content={{ title: 'Best / worst trade', body: 'The single best and worst trade’s net P&L.' }} className="block">
          <div className="card p-3 text-xs">
            <p className="text-slate-500">Best / worst trade</p>
            <p className="mt-1 tabular-nums">
              <span className={pnlClass(s.bestTrade)}>{signedInr(s.bestTrade)}</span> <span className="text-slate-600">/</span> <span className={pnlClass(s.worstTrade)}>{signedInr(s.worstTrade)}</span>
            </p>
          </div>
        </Tooltip>
      </div>

      {r.curve.length > 1 && (
        <Panel title="Account value & drawdown" help={{ ...E.backtest.curve, note: E.backtest.ddChart.body }}>
          <CurveCharts points={r.curve} capital={r.capital} />
        </Panel>
      )}

      {r.monthly.length > 0 && (
        <Panel title="Monthly returns" help={E.backtest.monthly}>
          <MonthlyGrid monthly={r.monthly} yearly={r.yearly} />
        </Panel>
      )}

      <Panel title={`Trades (${r.trades.length.toLocaleString('en-IN')})`} help={E.backtest.tradeList} flush>
        {r.trades.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-ink-850 text-[10px] text-slate-500">
                <tr>
                  <Th help={{ title: 'Stock', body: 'Open the row for every order of the trade.' }}>Stock</Th>
                  <Th help={{ title: 'Bought', body: 'Date of the first buy.' }}>Bought</Th>
                  <Th help={{ title: 'Sold', body: 'Date of the sale (or the last day for END).' }}>Sold</Th>
                  <Th help={E.backtest.holding}>Held</Th>
                  <Th help={E.editor.pyramid}>Adds</Th>
                  <Th help={{ title: 'Shares', body: 'Shares bought in total (first buy + adds).' }} right>
                    Shares
                  </Th>
                  <Th help={{ title: 'Avg price', body: 'Average buy price of all lots.' }} right>
                    Avg
                  </Th>
                  <Th help={{ title: 'Sold at', body: 'Sale price.' }} right>
                    Sold at
                  </Th>
                  <Th help={E.backtest.exitReason}>Why</Th>
                  <Th help={{ title: 'Invested', body: 'Money put in by every buy.' }} right>
                    Invested
                  </Th>
                  <Th help={{ title: 'Net P&L', body: 'Sale value − money put in (− charges, when they’re counted).' }} right>
                    Net P&L
                  </Th>
                  <Th help={{ title: 'Return', body: 'Net P&L ÷ money put in.' }} right>
                    Return
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {r.trades.slice(0, rows).map((t) => (
                  <TradeRows key={t.id} t={t} tf={r.definition.timeframe} open={openTrade === t.id} onToggle={() => setOpenTrade(openTrade === t.id ? null : t.id)} />
                ))}
              </tbody>
            </table>
            {r.trades.length > rows && (
              <div className="p-3 text-center">
                <Tooltip content={{ title: 'Show more', body: 'Show the next 100 trades.' }}>
                  <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setRows((n) => n + 100)}>
                    Show more ({(r.trades.length - rows).toLocaleString('en-IN')} left)
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
        ) : (
          <EmptyState title="No trades" hint="The entry never fired in this period on these stocks — see By stock for data notes, or try a longer period." />
        )}
      </Panel>

      <Panel title="By stock" help={E.backtest.byStock} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-ink-850 text-[10px] text-slate-500">
              <tr>
                <Th help={{ title: 'Stock', body: 'Open for data notes.' }}>Stock</Th>
                <Th help={E.backtest.trades} right>
                  Trades
                </Th>
                <Th help={E.backtest.winRate} right>
                  Won
                </Th>
                <Th help={{ title: 'Net P&L', body: 'All trades in this stock.' }} right>
                  Net P&L
                </Th>
                <Th help={{ title: 'Invested', body: 'Money put in across its trades.' }} right>
                  Invested
                </Th>
                <Th help={{ title: 'Best / worst', body: 'Best and worst trade in this stock.' }} right>
                  Best / worst
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/50">
              {traded.slice(0, stockRows).map((p) => {
                const isOpen = openStock === p.symbol;
                return (
                  <Fragment key={p.symbol}>
                    <tr className="hover:bg-ink-800/40">
                      <td className={td}>
                        <div className="flex items-center gap-1.5">
                          <button type="button" aria-expanded={isOpen} onClick={() => setOpenStock(isOpen ? null : p.symbol)} className="flex items-center gap-1.5 text-left">
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                            <span className="font-medium text-slate-200">{p.symbol}</span>
                            {(p.notes.length > 0 || p.errors.length > 0) && <span className={clsx('h-1.5 w-1.5 rounded-full', p.errors.length ? 'bg-warn' : 'bg-slate-500')} />}
                          </button>
                          <ChartLink symbol={p.symbol} tf={r.definition.timeframe} />
                        </div>
                      </td>
                      <td className={clsx(td, 'tabular-nums text-right')}>{p.trades}</td>
                      <td className={clsx(td, 'tabular-nums text-right text-slate-400')}>{p.trades ? `${p.wins}/${p.trades}` : '—'}</td>
                      <td className={clsx(td, 'tabular-nums text-right font-medium', pnlClass(p.netPnl))}>{p.trades ? signedInr(p.netPnl) : '—'}</td>
                      <td className={clsx(td, 'tabular-nums text-right text-slate-400')}>{p.trades ? compactInr(p.invested) : '—'}</td>
                      <td className={clsx(td, 'tabular-nums text-right')}>
                        {p.trades ? (
                          <>
                            <span className={pnlClass(p.bestTrade)}>{signedInr(p.bestTrade)}</span> <span className="text-slate-600">/</span> <span className={pnlClass(p.worstTrade)}>{signedInr(p.worstTrade)}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} className="bg-ink-950/40 px-4 py-2 text-xs">
                          <p className="text-slate-400">{p.name}</p>
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
                          {!p.errors.length && !p.notes.length && <p className="mt-1 text-slate-500">No data notes — full history for the whole period.</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {traded.length > stockRows && (
            <div className="p-3 text-center">
              <Tooltip content={{ title: 'Show more', body: 'Show the next 50 stocks.' }}>
                <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setStockRows((n) => n + 50)}>
                  Show more ({traded.length - stockRows} left)
                </button>
              </Tooltip>
            </div>
          )}
          {r.perSymbol.length > traded.length && <p className="px-4 pb-3 text-[11px] text-slate-500">{r.perSymbol.length - traded.length} stock(s) never traded and have no data notes.</p>}
        </div>
      </Panel>

      {r.skipped.length > 0 && (
        <Panel
          title={`Signals not taken (${r.skipped.length.toLocaleString('en-IN')})`}
          help={E.backtest.skipped}
          flush
          aside={
            <Tooltip content={E.backtest.skipped}>
              <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setShowSkipped(!showSkipped)}>
                {showSkipped ? 'Hide' : 'Show'}
              </button>
            </Tooltip>
          }
        >
          {showSkipped && (
            <ul className="divide-y divide-ink-700/50 text-xs">
              {r.skipped.slice(0, 300).map((x, i) => (
                <li key={`${x.symbol}-${x.date}-${i}`} className="flex flex-wrap gap-3 px-4 py-2">
                  <span className="w-24 text-slate-400">{shortDate(x.date)}</span>
                  <span className="flex w-28 items-center gap-1.5 font-medium text-slate-200">
                    {x.symbol}
                    <ChartLink symbol={x.symbol} tf={r.definition.timeframe} when={shortDate(x.date)} />
                  </span>
                  <Badge>{x.kind === 'ENTRY' ? 'Buy' : 'Add'}</Badge>
                  <span className="text-slate-300">{x.reason}</span>
                </li>
              ))}
              {r.skipped.length > 300 && <li className="px-4 py-2 text-slate-500">…and {r.skipped.length - 300} more</li>}
            </ul>
          )}
        </Panel>
      )}

      <Tooltip content={E.backtest.notes} className="block">
        <ul className="list-disc pl-5 text-[11px] text-slate-500">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Tooltip>
    </div>
  );
}
