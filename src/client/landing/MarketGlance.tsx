'use client';

import { useEffect, useMemo, useReducer } from 'react';
import clsx from 'clsx';
import { Bell, Globe2, Landmark, Newspaper, Sigma } from 'lucide-react';
import { rng, steady } from './data';
import { LANDING_HELP } from './help';
import { DemoNote, FeatureChip, Reveal, Section, SectionHead, useClock, useInView, useReducedMotion } from './kit';
import s from './landing.module.css';

// ---------------------------------------------------------------------------
// Market map (squarified treemap: size = weight, colour = today's move).

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify<T>(items: Array<{ item: T; value: number }>, r: Box): Array<{ item: T } & Box> {
  const out: Array<{ item: T } & Box> = [];
  const total = items.reduce((a, i) => a + i.value, 0);
  let rest = items.map((i) => ({ item: i.item, area: (i.value / total) * r.w * r.h })).sort((a, b) => b.area - a.area);
  let rect = { ...r };
  const worst = (row: typeof rest, side: number) => {
    const sum = row.reduce((a, i) => a + i.area, 0);
    const max = Math.max(...row.map((i) => i.area));
    const min = Math.min(...row.map((i) => i.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  while (rest.length) {
    const side = Math.min(rect.w, rect.h);
    let n = 1;
    while (n < rest.length && worst(rest.slice(0, n + 1), side) <= worst(rest.slice(0, n), side)) n++;
    const row = rest.slice(0, n);
    rest = rest.slice(n);
    const thick = row.reduce((a, i) => a + i.area, 0) / side;
    let off = 0;
    for (const it of row) {
      const len = it.area / thick;
      out.push(
        rect.w >= rect.h ? { item: it.item, x: rect.x, y: rect.y + off, w: thick, h: len } : { item: it.item, x: rect.x + off, y: rect.y, w: len, h: thick },
      );
      off += len;
    }
    rect = rect.w >= rect.h ? { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h } : { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
  }
  return out;
}

const SECTORS: Array<{ name: string; bias: number; stocks: Array<[string, number]> }> = [
  {
    name: 'Banks',
    bias: 0.9,
    stocks: [
      ['HDFCBANK', 13],
      ['ICICIBANK', 9],
      ['SBIN', 4.2],
      ['KOTAKBANK', 3.4],
      ['AXISBANK', 3.1],
    ],
  },
  {
    name: 'Energy',
    bias: 0.4,
    stocks: [
      ['RELIANCE', 9],
      ['NTPC', 1.5],
      ['POWERGRID', 1.3],
      ['ONGC', 1.2],
    ],
  },
  {
    name: 'IT',
    bias: -0.9,
    stocks: [
      ['INFY', 5],
      ['TCS', 4],
      ['HCLTECH', 1.8],
      ['WIPRO', 1],
      ['TECHM', 1],
    ],
  },
  {
    name: 'Auto',
    bias: 1.2,
    stocks: [
      ['M&M', 2.6],
      ['MARUTI', 1.8],
      ['BAJAJ-AUTO', 1],
      ['EICHERMOT', 0.8],
    ],
  },
  { name: 'Telecom', bias: 0.5, stocks: [['BHARTIARTL', 4.5]] },
  {
    name: 'Infra',
    bias: 0.2,
    stocks: [
      ['LT', 3.8],
      ['ULTRACEMCO', 1.2],
      ['ADANIPORTS', 1],
    ],
  },
  {
    name: 'FMCG',
    bias: -0.3,
    stocks: [
      ['ITC', 3.5],
      ['HINDUNILVR', 2],
      ['NESTLEIND', 0.9],
    ],
  },
  {
    name: 'Finance',
    bias: 0.6,
    stocks: [
      ['BAJFINANCE', 2.2],
      ['BAJAJFINSV', 1],
      ['SHRIRAMFIN', 0.8],
    ],
  },
  {
    name: 'Pharma',
    bias: -0.5,
    stocks: [
      ['SUNPHARMA', 1.7],
      ['CIPLA', 0.8],
      ['DRREDDY', 0.7],
    ],
  },
  {
    name: 'Metals',
    bias: 1.6,
    stocks: [
      ['TATASTEEL', 1.2],
      ['HINDALCO', 1],
      ['JSWSTEEL', 0.9],
    ],
  },
];
const ALL_STOCKS = SECTORS.flatMap((sec) => sec.stocks.map(([sym]) => ({ sym, bias: sec.bias })));
/** Stocks a strategy alerted on today: the map marks them with a bell. */
const BELLS = new Set(['HDFCBANK', 'TATASTEEL', 'M&M']);

const MW = 600;
const MH = 540;

function initialMoves() {
  const r = rng(17);
  return ALL_STOCKS.map((st) => st.bias + (r() - 0.5) * 2.2);
}
function nudge(moves: number[], tick: number) {
  const r = rng(500 + tick);
  return moves.map((m, i) => (r() < 0.22 ? Math.max(-4, Math.min(4, m + (r() - 0.5) * 0.9 + (ALL_STOCKS[i]!.bias - m) * 0.08)) : m));
}

const moveColor = (m: number) => {
  const a = Math.min(1, Math.abs(m) / 3);
  return m >= 0 ? `rgb(var(--bull) / ${0.18 + a * 0.7})` : `rgb(var(--bear) / ${0.18 + a * 0.7})`;
};

/** Today's move of every stock on the map, drifting every 1.4 s while on screen. */
function useMoves(active: boolean): number[] {
  const [state, advance] = useReducer(
    (st: { tick: number; moves: number[] }) => ({ tick: st.tick + 1, moves: nudge(st.moves, st.tick + 1) }),
    null,
    () => ({ tick: 0, moves: initialMoves() }),
  );
  useEffect(() => {
    if (!active) return;
    const id = setInterval(advance, 1400);
    return () => clearInterval(id);
  }, [active]);
  return state.moves;
}

function MarketMap({ moves }: { moves: number[] }) {
  const layout = useMemo(() => {
    const sectors = squarify(
      SECTORS.map((sec) => ({ item: sec, value: sec.stocks.reduce((a, [, w]) => a + w, 0) })),
      { x: 0, y: 0, w: MW, h: MH },
    );
    return sectors.map((sb) => ({
      ...sb,
      tiles: squarify(
        sb.item.stocks.map(([sym, w]) => ({ item: sym, value: w })),
        { x: sb.x + 2, y: sb.y + 16, w: Math.max(1, sb.w - 4), h: Math.max(1, sb.h - 18) },
      ),
    }));
  }, []);
  const moveOf = (sym: string) => moves[ALL_STOCKS.findIndex((st) => st.sym === sym)]!;
  const up = moves.filter((m) => m >= 0).length;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <span className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-400')}>Market map · by sector</span>
        <span className={clsx(s.mono, 'text-[11px] text-slate-500')}>
          <span className="text-bull">{up} up</span> · <span className="text-bear">{moves.length - up} down</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${MW} ${MH}`}
        className="block h-auto w-full flex-1 overflow-hidden rounded-xl"
        role="img"
        aria-label="Market map: every stock as a tile by sector, coloured by today's move"
      >
        {layout.map((sb) => {
          const avg = sb.item.stocks.reduce((a, [sym]) => a + moveOf(sym), 0) / sb.item.stocks.length;
          return (
            <g key={sb.item.name}>
              <rect x={sb.x} y={sb.y} width={sb.w} height={sb.h} fill="#070a12" stroke="#05070d" strokeWidth={2} />
              <text x={sb.x + 5} y={sb.y + 12} fontSize={9.5} fill="rgb(148 163 184)" className={s.mono} letterSpacing={0.8}>
                {sb.item.name.toUpperCase()}{' '}
                <tspan fill={avg >= 0 ? 'rgb(var(--bull))' : 'rgb(var(--bear))'}>
                  {avg >= 0 ? '+' : '−'}
                  {Math.abs(avg).toFixed(1)}%
                </tspan>
              </text>
              {sb.tiles.map((tile) => {
                const m = moveOf(tile.item);
                const big = tile.w > 52 && tile.h > 30;
                return (
                  <g key={tile.item}>
                    <rect
                      x={tile.x + 1}
                      y={tile.y + 1}
                      width={Math.max(0, tile.w - 2)}
                      height={Math.max(0, tile.h - 2)}
                      rx={3}
                      fill={moveColor(m)}
                      style={{ transition: 'fill 900ms' }}
                    />
                    {big && (
                      <>
                        <text
                          x={tile.x + tile.w / 2}
                          y={tile.y + tile.h / 2 - 1}
                          textAnchor="middle"
                          fontSize={Math.min(13, tile.w / 7)}
                          fontWeight={700}
                          fill="white"
                        >
                          {tile.item}
                        </text>
                        <text
                          x={tile.x + tile.w / 2}
                          y={tile.y + tile.h / 2 + 13}
                          textAnchor="middle"
                          fontSize={10.5}
                          fill="rgb(255 255 255 / 0.8)"
                          className={s.mono}
                        >
                          {m >= 0 ? '+' : '−'}
                          {Math.abs(m).toFixed(2)}%
                        </text>
                      </>
                    )}
                    {BELLS.has(tile.item) && tile.w > 24 && (
                      <Bell x={tile.x + tile.w - 16} y={tile.y + 5} width={11} height={11} color="rgb(var(--warn))" strokeWidth={2.4} />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sector rotation: relative strength vs momentum, sectors circling clockwise.

const RW = 340;
const RH = 250;
const ROT: Array<{ name: string; a: number; b: number; phase: number; speed: number }> = [
  { name: 'Metals', a: 110, b: 82, phase: 1.1, speed: 0.22 },
  { name: 'Auto', a: 86, b: 66, phase: 0.4, speed: 0.19 },
  { name: 'Banks', a: 70, b: 52, phase: 5.9, speed: 0.17 },
  { name: 'IT', a: 96, b: 74, phase: 3.6, speed: 0.2 },
  { name: 'Pharma', a: 60, b: 48, phase: 4.3, speed: 0.24 },
  { name: 'FMCG', a: 52, b: 40, phase: 2.6, speed: 0.18 },
  { name: 'Energy', a: 78, b: 60, phase: 2.0, speed: 0.21 },
  { name: 'Realty', a: 116, b: 88, phase: 5.0, speed: 0.16 },
];

function Rotation({ active }: { active: boolean }) {
  const [t] = useClock(active, undefined, 40);
  const cx = RW / 2;
  const cy = RH / 2;
  const pos = (r: (typeof ROT)[number], th: number) => ({
    x: steady(cx + (r.a / 1.15) * Math.cos(th), 2),
    y: steady(cy - (r.b / 1.15) * Math.sin(th), 2),
  });
  return (
    <div>
      <div className={clsx(s.mono, 'mb-3 text-[11px] uppercase tracking-[0.2em] text-slate-400')}>Sector rotation</div>
      <svg
        viewBox={`0 0 ${RW} ${RH}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Sectors moving clockwise through improving, leading, weakening and lagging"
      >
        <line x1={cx} x2={cx} y1={0} y2={RH} stroke="rgb(255 255 255 / 0.12)" />
        <line x1={0} x2={RW} y1={cy} y2={cy} stroke="rgb(255 255 255 / 0.12)" />
        {(
          [
            ['IMPROVING', 8, 16, 'start'],
            ['LEADING', RW - 8, 16, 'end'],
            ['LAGGING', 8, RH - 8, 'start'],
            ['WEAKENING', RW - 8, RH - 8, 'end'],
          ] as const
        ).map(([label, lx, ly, anchor]) => (
          <text key={label} x={lx} y={ly} textAnchor={anchor} fontSize={9.5} letterSpacing={1.6} fill="rgb(100 116 139)" className={s.mono}>
            {label}
          </text>
        ))}
        {ROT.map((r) => {
          const th = r.phase - r.speed * t;
          const tail = Array.from({ length: 9 }, (_, j) => pos(r, th + j * 0.09));
          const head = tail[0]!;
          return (
            <g key={r.name}>
              <polyline
                points={tail.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="rgb(var(--accent-soft))"
                strokeOpacity={0.4}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
              <circle cx={head.x} cy={head.y} r={4} fill="rgb(var(--accent-soft))" />
              <text x={head.x + 7} y={head.y + 3.5} fontSize={10} fill="rgb(203 213 225)" className={s.mono}>
                {r.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The market in 30 seconds: sentences written from the numbers.

function briefFrom(moves: number[]): string[] {
  const up = moves.filter((m) => m >= 0).length;
  const share = up / moves.length;
  const tone = share >= 0.6 ? 'Broad rally' : share <= 0.4 ? 'Broad selling' : 'Mixed day';
  const sectors = SECTORS.map((sec) => {
    const own = sec.stocks.map(([sym]) => moves[ALL_STOCKS.findIndex((st) => st.sym === sym)]!);
    return { name: sec.name, avg: own.reduce((a, m) => a + m, 0) / own.length };
  }).sort((a, b) => b.avg - a.avg);
  const fno = optionStats();
  const flow = (who: string, v: number) => `${who} ${v >= 0 ? 'bought' : 'sold'} ₹${Math.abs(v).toLocaleString('en-IN')} cr`;
  const [fii, dii] = FLOWS.map(([, v]) => v.at(-1)!);
  return [
    `${tone}: ${up} of ${moves.length} stocks on the map are up.`,
    `${sectors[0]!.name} and ${sectors[1]!.name} lead; ${sectors.at(-1)!.name} lags.`,
    `PCR ${fno.pcr.toFixed(2)}, max pain ${fno.maxPain.toLocaleString('en-IN')}; put wall ${fno.putWall.toLocaleString('en-IN')}.`,
    `${flow('FII', fii!)}; ${flow('DII', dii!)}.`,
    'VIX 12.4, a calm band.',
  ];
}

const TYPE_RATE = 42;

function Brief({ active, moves }: { active: boolean; moves: number[] }) {
  const [t] = useClock(active, 10, 40);
  const lines = briefFrom(moves);
  let left = Math.floor(t * TYPE_RATE);
  return (
    <div>
      <div className={clsx(s.mono, 'mb-4 text-[11px] uppercase tracking-[0.2em] text-slate-400')}>The market in 30 seconds</div>
      <ul className="space-y-2.5">
        {lines.map((line, i) => {
          const shown = line.slice(0, Math.max(0, left));
          const typing = left > 0 && left < line.length;
          left -= line.length;
          return (
            <li key={i} className={clsx('flex min-h-[1.5em] gap-2.5 text-[15px] leading-snug', shown ? 'text-slate-200' : 'text-transparent')}>
              <span className={clsx('mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full', shown ? 'bg-accent' : 'bg-transparent')} />
              <span>
                {shown || ' '}
                {typing && <span className={clsx(s.caret, 'ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-accent-soft')} />}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// F&O pulse: open interest by strike, walls and max pain computed from it.

const STRIKES = [25_000, 25_100, 25_200, 25_300, 25_400, 25_500, 25_600, 25_700, 25_800];
const CE_OI = [8, 10, 14, 18, 26, 31, 44, 29, 21];
const PE_OI = [22, 30, 41, 33, 27, 18, 12, 9, 6];
const SPOT = 25_412;

function optionStats() {
  const callWall = STRIKES[CE_OI.indexOf(Math.max(...CE_OI))]!;
  const putWall = STRIKES[PE_OI.indexOf(Math.max(...PE_OI))]!;
  const pain = (k: number) => STRIKES.reduce((a, st, i) => a + CE_OI[i]! * Math.max(0, k - st) + PE_OI[i]! * Math.max(0, st - k), 0);
  const maxPain = STRIKES.reduce((best, k) => (pain(k) < pain(best) ? k : best), STRIKES[0]!);
  const pcr = PE_OI.reduce((a, v) => a + v, 0) / CE_OI.reduce((a, v) => a + v, 0);
  return { callWall, putWall, maxPain, pcr };
}

function OpenInterest({ active }: { active: boolean }) {
  const st = optionStats();
  const max = Math.max(...CE_OI, ...PE_OI);
  const W = 560;
  const Hh = 190;
  const mid = 96;
  const bw = W / STRIKES.length;
  const spotX = ((SPOT - STRIKES[0]!) / (STRIKES.at(-1)! - STRIKES[0]!)) * (W - bw) + bw / 2;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-400')}>F&amp;O pulse · open interest by strike</span>
        <span className={clsx(s.mono, 'flex gap-3 text-[11px] text-slate-500')}>
          <span>
            PCR <span className="text-fg">{st.pcr.toFixed(2)}</span>
          </span>
          <span>
            Max pain <span className="text-fg">{st.maxPain.toLocaleString('en-IN')}</span>
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${Hh + 20}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Call open interest above, put open interest below, with the call wall, put wall and spot"
      >
        {STRIKES.map((k, i) => {
          const cx = i * bw + bw / 2;
          const ch = (CE_OI[i]! / max) * (mid - 18);
          const ph = (PE_OI[i]! / max) * (mid - 18);
          return (
            <g key={k}>
              <rect
                x={cx - bw * 0.3}
                width={bw * 0.6}
                y={active ? mid - ch : mid}
                height={active ? ch : 0}
                rx={3}
                fill="rgb(var(--leg-ce))"
                fillOpacity={k === st.callWall ? 1 : 0.55}
                style={{ transition: `all 900ms ${i * 60}ms` }}
              />
              <rect
                x={cx - bw * 0.3}
                width={bw * 0.6}
                y={mid}
                height={active ? ph : 0}
                rx={3}
                fill="rgb(var(--leg-pe))"
                fillOpacity={k === st.putWall ? 1 : 0.55}
                style={{ transition: `all 900ms ${i * 60}ms` }}
              />
              {i % 2 === 0 && (
                <text x={cx} y={Hh + 14} textAnchor="middle" fontSize={10} fill="rgb(100 116 139)" className={s.mono}>
                  {k.toLocaleString('en-IN')}
                </text>
              )}
              {k === st.callWall && (
                <text x={cx} y={mid - ch - 6} textAnchor="middle" fontSize={10} fill="rgb(var(--leg-ce))" className={s.mono}>
                  CALL WALL
                </text>
              )}
              {k === st.putWall && (
                <text x={cx} y={mid + ph + 13} textAnchor="middle" fontSize={10} fill="rgb(var(--leg-pe))" className={s.mono}>
                  PUT WALL
                </text>
              )}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={mid} y2={mid} stroke="rgb(255 255 255 / 0.15)" />
        <line x1={spotX} x2={spotX} y1={6} y2={Hh} stroke="rgb(var(--fg))" strokeDasharray="3 4" strokeOpacity={0.6} />
        <text x={spotX + 5} y={14} fontSize={10} fill="rgb(var(--fg))" className={s.mono}>
          SPOT {SPOT.toLocaleString('en-IN')}
        </text>
      </svg>
      <div className={clsx(s.mono, 'mt-1 flex gap-4 text-[11px] text-slate-500')}>
        <span>
          <span className="text-leg-ce">■</span> calls
        </span>
        <span>
          <span className="text-leg-pe">■</span> puts
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money flow: FII / DII cash, last five sessions.

const FLOW_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const FLOWS: Array<[string, number[]]> = [
  ['FII', [-1240, 860, -2310, -540, 1120]],
  ['DII', [2010, 430, 2890, 1650, -310]],
];

function MoneyFlow({ active }: { active: boolean }) {
  const max = Math.max(...FLOWS.flatMap(([, v]) => v.map(Math.abs)));
  return (
    <div>
      <div className={clsx(s.mono, 'mb-4 text-[11px] uppercase tracking-[0.2em] text-slate-400')}>Money flow · ₹ cr, cash</div>
      <div className="space-y-4">
        {FLOWS.map(([who, vals]) => (
          <div key={who}>
            <div className="mb-1.5 flex justify-between text-[12px]">
              <span className="font-semibold text-fg">{who}</span>
              <span className={clsx(s.mono, vals.at(-1)! >= 0 ? 'text-bull' : 'text-bear')}>
                {vals.at(-1)! >= 0 ? '+' : '−'}
                {Math.abs(vals.at(-1)!).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="grid h-16 grid-cols-5 gap-1.5">
              {vals.map((v, i) => (
                <div key={i} className="relative">
                  <span className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
                  <span
                    className={clsx('absolute inset-x-0 rounded-sm', v >= 0 ? 'bottom-1/2 bg-bull/80' : 'top-1/2 bg-bear/80')}
                    style={{ height: active ? `${(Math.abs(v) / max) * 50}%` : 0, transition: `height 800ms ${i * 70}ms` }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className={clsx(s.mono, 'grid grid-cols-5 gap-1.5 text-center text-[10px] text-slate-600')}>
          {FLOW_DAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MarketGlance() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  const live = inView && !reduced;
  const moves = useMoves(live);
  return (
    <Section id="market">
      <SectionHead
        no="07"
        kicker="Market"
        title={
          <>
            The whole market.
            <br />
            One glance.
          </>
        }
        sub="Breadth, sector rotation, OI build-up, PCR, max pain, CPR and pivots, FII / DII flows, India VIX, world markets and news. One page, refreshing itself."
      />
      <div ref={ref} className="mt-14 grid gap-5 lg:grid-cols-12">
        <Reveal className={clsx(s.panel, 'p-4 sm:p-6 lg:col-span-7 lg:row-span-2')}>
          <MarketMap moves={moves} />
        </Reveal>
        <Reveal className={clsx(s.panel, 'p-5 sm:p-6 lg:col-span-5')} delay={80}>
          <Brief active={live} moves={moves} />
        </Reveal>
        <Reveal className={clsx(s.panel, 'p-5 sm:p-6 lg:col-span-5')} delay={160}>
          <Rotation active={live} />
        </Reveal>
        <Reveal className={clsx(s.panel, 'p-5 sm:p-6 lg:col-span-7')}>
          <OpenInterest active={inView} />
        </Reveal>
        <Reveal className={clsx(s.panel, 'p-5 sm:p-6 lg:col-span-5')} delay={80}>
          <MoneyFlow active={inView} />
        </Reveal>
      </div>
      <Reveal className="mt-8 flex flex-wrap gap-2.5" delay={100}>
        <FeatureChip icon={<Sigma />} label="Pivots & CPR" help={LANDING_HELP.mkLevels} />
        <FeatureChip icon={<Landmark />} label="Who holds index F&O" help={LANDING_HELP.mkParticipants} />
        <FeatureChip icon={<Globe2 />} label="World, crude, gold, USD/INR" help={LANDING_HELP.mkWorld} />
        <FeatureChip icon={<Newspaper />} label="News tagged by company" help={LANDING_HELP.mkNews} />
        <FeatureChip icon={<Bell />} label="Your alerts on the map" help={LANDING_HELP.mkBells} />
      </Reveal>
      <DemoNote>Example readings · the app fills them from Kite, NSE and free public feeds</DemoNote>
    </Section>
  );
}
