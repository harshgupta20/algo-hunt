'use client';

import clsx from 'clsx';
import { BarChart3, CandlestickChart, ExternalLink, ListFilter, RotateCcw, Star } from 'lucide-react';
import { Tooltip } from '@/client/components/Tooltip';
import { pyramidSample, type PyramidEvent } from './data';
import { LANDING_HELP } from './help';
import { DemoNote, FeatureChip, Reveal, Section, SectionHead, inr, signedInr, useClock, useInView } from './kit';
import s from './landing.module.css';

const P = pyramidSample();
const N = P.bars.length;
const PER_BUY = 25_000;
const FROM = 22;
const PLAY_S = 11;
const PERIOD = PLAY_S + 3.5;

const W = 1000;
const H = 470;
const step = W / N;
const x = (i: number) => (i + 0.5) * step;
const lo = Math.min(...P.bars.map((b) => b.l)) * 0.985;
const hi = Math.max(...P.bars.map((b) => b.h)) * 1.01;
const y = (v: number) => 14 + ((hi - v) / (hi - lo)) * (H - 40);

const BUYS = P.events.filter((e) => e.kind !== 'EXIT');
const EXIT = P.events.find((e) => e.kind === 'EXIT');
const shares = (e: PyramidEvent) => Math.floor(PER_BUY / e.price);
/** A label at the line's end, kept inside the chart near the right edge. */
const edgeLabel = (i: number) => (x(i) > W - 140 ? { x: x(i) - 6, textAnchor: 'end' as const } : { x: x(i) + 6 });

function Chart({ head }: { head: number }) {
  const seen = P.events.filter((e) => e.idx <= head);
  const held = seen.filter((e) => e.kind !== 'EXIT');
  const exited = seen.some((e) => e.kind === 'EXIT');
  const maPts = P.ma
    .slice(0, head + 1)
    .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
    .filter(Boolean)
    .join(' ');
  const stops = held.filter((e) => e.stop !== null);
  const lastBuy = held.at(-1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Price, its 20-day average, buys, adds and the shared stop">
      {Array.from({ length: 6 }, (_, i) => (
        <line key={i} x1={0} x2={W} y1={14 + (i * (H - 40)) / 5} y2={14 + (i * (H - 40)) / 5} stroke="rgb(255 255 255 / 0.04)" />
      ))}
      {P.bars.slice(0, head + 1).map((b, i) => {
        const up = b.c >= b.o;
        const col = up ? 'rgb(var(--bull))' : 'rgb(var(--bear))';
        return (
          <g key={i} opacity={0.85}>
            <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth={1} />
            <rect x={x(i) - step * 0.33} width={step * 0.66} y={y(Math.max(b.o, b.c))} height={Math.max(1, Math.abs(y(b.o) - y(b.c)))} rx={0.8} fill={col} />
          </g>
        );
      })}
      <polyline points={maPts} fill="none" stroke="rgb(var(--accent))" strokeWidth={2.4} strokeLinejoin="round" />

      {/* the stop for all lots, moving up at each add */}
      {stops.map((e, i) => {
        const end = Math.min(head, stops[i + 1]?.idx ?? EXIT?.idx ?? N - 1);
        return (
          <g key={e.idx}>
            <line x1={x(e.idx)} x2={x(end)} y1={y(e.stop!)} y2={y(e.stop!)} stroke="rgb(var(--bear))" strokeWidth={1.6} strokeDasharray="5 4" />
            {i === stops.length - 1 && !exited && (
              <text {...edgeLabel(end)} y={y(e.stop!) + 16} fontSize={11} fill="rgb(var(--bear))" className={s.mono}>
                STOP · all lots
              </text>
            )}
          </g>
        );
      })}

      {/* last buy level the MA has to reach */}
      {lastBuy && !exited && (
        <g>
          <line
            x1={x(lastBuy.idx)}
            x2={x(head)}
            y1={y(lastBuy.price)}
            y2={y(lastBuy.price)}
            stroke="rgb(255 255 255 / 0.5)"
            strokeDasharray="1 4"
            strokeWidth={1.5}
          />
          <text {...edgeLabel(head)} y={y(lastBuy.price) - 6} fontSize={11} fill="rgb(203 213 225)" className={s.mono}>
            last buy {lastBuy.price.toFixed(0)}
          </text>
        </g>
      )}

      {/* the moment the rising MA reaches the last buy */}
      {seen
        .filter((e) => e.kind === 'ADD')
        .map((e) => (
          <g key={`m${e.idx}`}>
            <circle cx={x(e.signalIdx)} cy={y(P.ma[e.signalIdx]!)} r={7} fill="none" stroke="rgb(var(--warn))" strokeWidth={1.6} />
            {head - e.idx < 6 && <circle cx={x(e.signalIdx)} cy={y(P.ma[e.signalIdx]!)} r={7} fill="rgb(var(--warn) / 0.5)" className={s.halo} />}
          </g>
        ))}

      {seen.map((e) => {
        const cx = x(e.idx);
        if (e.kind === 'EXIT') {
          return (
            <g key="exit">
              <path d={`M${cx},${y(P.bars[e.idx]!.h) - 8} l-7,-12 h14 z`} fill="rgb(var(--bear))" />
              <text x={cx} y={y(P.bars[e.idx]!.h) - 26} textAnchor="middle" fontSize={11} fontWeight={700} fill="rgb(var(--bear))" className={s.mono}>
                SELL ALL
              </text>
            </g>
          );
        }
        return (
          <g key={e.idx}>
            <path d={`M${cx},${y(P.bars[e.idx]!.l) + 8} l-7,12 h14 z`} fill="rgb(var(--bull))" />
            <text x={cx} y={y(P.bars[e.idx]!.l) + 36} textAnchor="middle" fontSize={11} fontWeight={700} fill="rgb(var(--bull))" className={s.mono}>
              {e.kind === 'BUY' ? 'BUY' : `+LOT ${e.lots}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Pyramid({ head }: { head: number }) {
  const held = BUYS.filter((e) => e.idx <= head);
  const exited = !!EXIT && EXIT.idx <= head;
  const pnl = exited ? held.reduce((a, e) => a + shares(e) * (EXIT!.price - e.price), 0) : null;
  return (
    <div className="flex h-full flex-col">
      <div className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-500')}>Lots held</div>
      <div className="mt-4 flex flex-1 flex-col-reverse items-center justify-start gap-1.5">
        {BUYS.map((e, i) => {
          const on = e.idx <= head;
          return (
            <div
              key={e.idx}
              className={clsx(
                'flex h-11 items-center justify-between rounded-lg border px-3 transition-all duration-500',
                on ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0',
                exited ? (EXIT!.price >= e.price ? 'border-bull/50 bg-bull/15' : 'border-bear/50 bg-bear/15') : 'border-accent/40 bg-accent/15',
              )}
              style={{ width: `${100 - i * 14}%` }}
            >
              <span className={clsx(s.mono, 'text-[11px] text-slate-400')}>LOT {i + 1}</span>
              <span className={clsx(s.mono, 'text-[13px] font-semibold tabular-nums text-fg')}>{inr(e.price)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-5 min-h-[64px] border-t border-white/[0.06] pt-4">
        {pnl === null ? (
          <div className={clsx(s.mono, 'text-xs leading-relaxed text-slate-500')}>{inr(PER_BUY)} per buy · stop for every lot = the MA at the last add</div>
        ) : (
          <>
            <div className={clsx(s.mono, 'text-[11px] text-slate-500')}>
              Sold {held.length} lots at {inr(EXIT!.price)}
            </div>
            <div className={clsx(s.display, 'mt-1 text-3xl tabular-nums', pnl >= 0 ? 'text-bull' : 'text-bear')}>{signedInr(pnl)}</div>
          </>
        )}
      </div>
    </div>
  );
}

const SCREENER: Array<{ sym: string; state: 'FRESH' | 'ENTRY' | 'EXIT' | '—' }> = [
  { sym: 'TATASTEEL', state: 'FRESH' },
  { sym: 'LT', state: 'ENTRY' },
  { sym: 'INFY', state: 'EXIT' },
  { sym: 'SBIN', state: '—' },
];

export function EquityPyramid() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [t, restart] = useClock(inView, PERIOD, 60);
  const head = Math.round(FROM + (N - 1 - FROM) * Math.min(1, t / PLAY_S));

  return (
    <Section id="equity">
      <SectionHead
        no="06"
        kicker="Equity"
        title={
          <>
            Pyramids,
            <br />
            built by the MA.
          </>
        }
        sub="NSE cash and 212 indices: breakouts, golden crosses, RSI-MA crosses, trailing SL. Add a lot each time the rising MA reaches your last buy, one stop for every lot."
      />
      <Reveal className="mt-14">
        <div ref={ref} className={clsx(s.panel, 'grid gap-6 p-4 sm:p-7 lg:grid-cols-12')}>
          <div className="lg:col-span-8">
            <div className="mb-3 flex items-center justify-between">
              <div className={clsx(s.mono, 'flex flex-wrap gap-x-4 text-[11px] text-slate-500')}>
                <span className="text-slate-300">SAMPLE STOCK · daily</span>
                <span>
                  <span className="text-accent">━</span> SMA 20
                </span>
                <span>
                  <span className="text-bear">╌</span> stop
                </span>
                <span>
                  <span className="text-warn">○</span> MA reaches last buy
                </span>
              </div>
              <Tooltip content={LANDING_HELP.replay}>
                <button
                  type="button"
                  onClick={restart}
                  aria-label="Replay"
                  className="rounded-full border border-white/10 p-2 text-slate-400 transition-colors hover:border-white/30 hover:text-fg"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
            <Chart head={head} />
          </div>
          <div className="lg:col-span-4">
            <Pyramid head={head} />
          </div>
        </div>
      </Reveal>

      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <Reveal className={clsx(s.panel, 'p-5')}>
          <div className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-500')}>Same values as TradingView</div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ['Algo Hunt', '61.38'],
              ['TradingView', '61.38'],
            ].map(([who, v]) => (
              <div key={who} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="text-[11px] text-slate-500">{who}</div>
                <div className={clsx(s.mono, 'text-lg font-semibold text-fg')}>RSI {v}</div>
              </div>
            ))}
          </div>
          <div className={clsx(s.mono, 'mt-3 text-[11px] text-slate-500')}>warm-up, Wilder RSI, EMA seeds: matched candle by candle</div>
        </Reveal>
        <Reveal className={clsx(s.panel, 'p-5')} delay={80}>
          <div className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-500')}>Screener · last close</div>
          <ul className="mt-3 space-y-1.5">
            {SCREENER.map((r) => (
              <li key={r.sym} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2">
                <span className="flex items-center gap-2 text-sm font-medium text-fg">
                  {r.sym}
                  <ExternalLink className="h-3 w-3 text-slate-600" />
                </span>
                <span
                  className={clsx(
                    s.mono,
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider',
                    r.state === 'FRESH'
                      ? 'bg-bull text-black'
                      : r.state === 'ENTRY'
                        ? 'border border-bull/60 text-bull'
                        : r.state === 'EXIT'
                          ? 'border border-bear/60 text-bear'
                          : 'text-slate-600',
                  )}
                >
                  {r.state}
                </span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal className={clsx(s.panel, 'p-5')} delay={160}>
          <div className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-500')}>Fixed order rules</div>
          <ul className="mt-3 space-y-2.5 text-[14px] text-slate-300">
            {['Fill at the next day’s open', 'Stops on the day’s low', 'Circuits and no-trade days respected', 'Whole paise, every price'].map((r) => (
              <li key={r} className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {r}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
      <Reveal className="mt-8 flex flex-wrap gap-2.5" delay={100}>
        <FeatureChip icon={<CandlestickChart />} label="Daily or weekly close" help={LANDING_HELP.eqTimeframe} />
        <FeatureChip icon={<BarChart3 />} label="212 indices · ~3,050 stocks" help={LANDING_HELP.eqUniverse} />
        <FeatureChip icon={<ListFilter />} label="Screener: fresh signals" help={LANDING_HELP.eqScreener} />
        <FeatureChip icon={<Star />} label="Watchlists" help={LANDING_HELP.eqWatchlists} />
        <FeatureChip icon={<ExternalLink />} label="TradingView link on every trade" help={LANDING_HELP.eqTradingView} />
      </Reveal>
      <DemoNote>Synthetic prices · buys, adds and the stop follow the real rule</DemoNote>
    </Section>
  );
}
