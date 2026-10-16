'use client';

/** F&O pulse: index option chains (Kite), OI build-up, who holds index futures, futures premium. */
import { useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import type { FuturesBasis, MoversData, OiBuildup, OiMove, OptionSnapshot, OptionsData, Participant, ParticipantDay } from '@/shared/market/types';
import { InfoTip, Tooltip, type TooltipContent } from '../components/Tooltip';
import { Section } from '../components/ui';
import { OiButterfly } from './charts';
import { dirClass, fmtCompact, fmtPct, fmtPrice, fmtSigned, shortDay } from './format';
import { M } from './help';
import { Pct, Skeleton } from './parts';

export function FnoPanel({ options, movers, participants, futures, onPick }: { options: OptionsData | undefined; movers: MoversData | undefined; participants: ParticipantDay[] | undefined; futures: FuturesBasis[] | undefined; onPick: (s: string) => void }) {
  return (
    <Section title="F&O pulse" help={M.fno}>
      <div className="grid gap-4 xl:grid-cols-2">
        {!options ? (
          <>
            <Skeleton className="h-[360px]" />
            <Skeleton className="h-[360px]" />
          </>
        ) : options.available ? (
          options.chains.map((c) => <ChainCard key={c.underlying} c={c} />)
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-600 p-8 text-center xl:col-span-2">
            <p className="max-w-md text-sm text-slate-400">{options.reason}</p>
            <a href="/api/kite/login" className="btn-primary text-xs">
              Connect Kite
            </a>
          </div>
        )}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Buildup oi={movers?.oi} onPick={onPick} />
        <div className="space-y-5">
          <Participants days={participants} />
          <Basis futures={futures} />
        </div>
      </div>
    </Section>
  );
}

function Stat({ label, help, children, className }: { label: string; help: TooltipContent; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-lg bg-ink-850 px-2.5 py-2', className)}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        {label}
        <InfoTip content={help} />
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-fg">{children}</div>
    </div>
  );
}

function ChainCard({ c }: { c: OptionSnapshot }) {
  const near = useMemo(() => {
    const i = c.strikes.findIndex((s) => s.strike === c.atm);
    return c.strikes.slice(Math.max(0, i - 9), i + 10);
  }, [c]);
  const move = c.straddle ? c.straddle.total : null;
  return (
    <div className="rounded-xl border border-ink-700/70 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-semibold text-fg">{c.name}</span>
          <span className="ml-2 text-xs tabular-nums text-slate-400">{fmtPrice(c.spot)}</span>
        </div>
        <Tooltip content={M.chain}>
          <span className="cursor-help text-[11px] text-slate-500">
            expiry {shortDay(c.expiry)} · {c.daysToExpiry === 0 ? 'today' : `${c.daysToExpiry} d`}
          </span>
        </Tooltip>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="PCR" help={M.pcr}>
          {c.pcr?.toFixed(2) ?? '—'}
        </Stat>
        <Stat label="Max pain" help={M.maxPain}>
          {c.maxPain !== null ? fmtPrice(c.maxPain, 0) : '—'}
        </Stat>
        <Stat label="Expected move" help={M.straddle}>
          {move !== null ? (
            <>
              ±{fmtPrice(move, 0)} <span className="text-[11px] font-normal text-slate-500">({c.straddle!.movePct.toFixed(1)}%)</span>
            </>
          ) : (
            '—'
          )}
        </Stat>
        <Stat label="Support" help={M.putWall}>
          {c.putWall ? fmtPrice(c.putWall.strike, 0) : '—'}
        </Stat>
        <Stat label="Resistance" help={M.callWall}>
          {c.callWall ? fmtPrice(c.callWall.strike, 0) : '—'}
        </Stat>
        <Stat label="Range by expiry" help={M.straddle}>
          {move !== null ? `${fmtPrice(c.spot - move, 0)}–${fmtPrice(c.spot + move, 0)}` : '—'}
        </Stat>
      </div>
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-leg-ce" /> Call OI
        </span>
        <span className="flex items-center gap-1">
          OI by strike <InfoTip content={M.oiChart} />
        </span>
        <span className="flex items-center gap-1">
          Put OI <span className="h-2 w-2 rounded-sm bg-leg-pe" />
        </span>
      </div>
      <OiButterfly rows={near} spot={c.spot} atm={c.atm} />
    </div>
  );
}

const BUILDUP: Array<{ kind: OiBuildup; label: string }> = [
  { kind: 'long', label: 'Long build-up' },
  { kind: 'short', label: 'Short build-up' },
  { kind: 'covering', label: 'Short covering' },
  { kind: 'unwinding', label: 'Long unwinding' },
];

function Buildup({ oi, onPick }: { oi: OiMove[] | undefined; onPick: (s: string) => void }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
        OI build-up (F&O stocks) <InfoTip content={M.buildup} />
      </div>
      {!oi ? (
        <Skeleton className="h-56" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {BUILDUP.map(({ kind, label }) => {
            const list = oi.filter((o) => o.kind === kind).slice(0, 6);
            return (
              <div key={kind} className="rounded-lg bg-ink-850 p-2.5">
                <Tooltip content={M.buildupKind[kind]}>
                  <div className="mb-1.5 cursor-help text-[11px] font-semibold text-slate-300">
                    {label} <span className="font-normal text-slate-500">· {oi.filter((o) => o.kind === kind).length}</span>
                  </div>
                </Tooltip>
                {list.length === 0 ? (
                  <p className="text-[11px] text-slate-600">None</p>
                ) : (
                  <ul className="space-y-1">
                    {list.map((o) => (
                      <li key={o.symbol}>
                        <button type="button" onClick={() => onPick(o.symbol)} className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 rounded px-1 text-left text-[11px] hover:bg-ink-800">
                          <span className="truncate text-slate-200">{o.symbol}</span>
                          <Pct value={o.pct} plain />
                          <span className="w-16 text-right tabular-nums text-slate-400">OI {fmtPct(o.oiPct, 1)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const WHO: Participant[] = ['FII', 'DII', 'Pro', 'Client'];

function Participants({ days }: { days: ParticipantDay[] | undefined }) {
  if (!days) return <Skeleton className="h-40" />;
  if (!days.length) return <p className="text-xs text-slate-500">NSE’s participant data isn’t available right now.</p>;
  const [today] = days;
  const fiiLong = (d: ParticipantDay) => {
    const f = d.rows.FII;
    return (f.futIdxLong / (f.futIdxLong + f.futIdxShort || 1)) * 100;
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
        Who holds index F&O <span className="font-normal text-slate-500">· {shortDay(today!.date)}</span> <InfoTip content={M.participants} />
      </div>
      <table className="w-full text-[11px] tabular-nums">
        <thead className="text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left font-medium" />
            <th className="text-right font-medium">Fut long %</th>
            <th className="text-right font-medium">Fut net</th>
            <th className="text-right font-medium">Calls net</th>
            <th className="text-right font-medium">Puts net</th>
          </tr>
        </thead>
        <tbody>
          {WHO.map((w) => {
            const r = today!.rows[w];
            const longPct = (r.futIdxLong / (r.futIdxLong + r.futIdxShort || 1)) * 100;
            const fut = r.futIdxLong - r.futIdxShort;
            const calls = r.callLong - r.callShort;
            const puts = r.putLong - r.putShort;
            return (
              <tr key={w} className="border-t border-ink-700/40">
                <td className="py-1 font-medium text-slate-300">{w}</td>
                <td className="text-right text-fg">{longPct.toFixed(0)}%</td>
                <td className={clsx('text-right', dirClass(fut))}>{fmtCompact(fut)}</td>
                <td className={clsx('text-right', dirClass(calls))}>{fmtCompact(calls)}</td>
                <td className={clsx('text-right', dirClass(puts))}>{fmtCompact(puts)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">FII long % in index futures</div>
        <div className="flex items-end gap-2">
          {[...days].reverse().map((d) => {
            const p = fiiLong(d);
            return (
              <Tooltip key={d.date} content={{ title: `${shortDay(d.date)}: FIIs ${p.toFixed(1)}% long`, body: `${fmtCompact(d.rows.FII.futIdxLong)} long vs ${fmtCompact(d.rows.FII.futIdxShort)} short index-futures contracts.` }}>
                <div className="flex cursor-help flex-col items-center gap-1">
                  <div className="relative h-12 w-6 overflow-hidden rounded bg-bear/25">
                    <div className="absolute inset-x-0 bottom-0 bg-bull/80" style={{ height: `${p}%` }} />
                  </div>
                  <span className="text-[9px] tabular-nums text-slate-500">{p.toFixed(0)}%</span>
                </div>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const BASIS_NAMES: Record<string, string> = { NIFTY: 'Nifty', BANKNIFTY: 'Bank Nifty', FINNIFTY: 'Fin Nifty', MIDCPNIFTY: 'Midcap Nifty', NIFTYNXT50: 'Next 50' };

function Basis({ futures }: { futures: FuturesBasis[] | undefined }) {
  if (!futures?.length) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
        Futures premium <InfoTip content={M.basis} />
      </div>
      <div className="flex flex-wrap gap-2">
        {futures.map((f) => (
          <Tooltip key={f.symbol} content={{ title: `${BASIS_NAMES[f.symbol] ?? f.symbol} futures (${shortDay(f.expiry)})`, body: `Futures ${fmtPrice(f.last)} vs index ${fmtPrice(f.spot)}: ${f.basis >= 0 ? 'premium' : 'discount'} of ${fmtSigned(f.basis)} points. Futures ${fmtPct(f.pct)} today.` }}>
            <div className="cursor-help rounded-lg bg-ink-850 px-2.5 py-1.5 text-[11px]">
              <div className="text-slate-400">{BASIS_NAMES[f.symbol] ?? f.symbol}</div>
              <div className={clsx('font-semibold tabular-nums', dirClass(f.basis))}>
                {fmtSigned(f.basis, 1)} <span className="font-normal text-slate-500">({fmtPct(f.basisPct)})</span>
              </div>
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
