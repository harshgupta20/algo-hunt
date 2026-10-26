'use client';

import { useMemo, type ReactNode } from 'react';
import Image from 'next/image';
import clsx from 'clsx';
import { BadgeCheck, Bell, Check, Mail, Radio, RotateCcw, Send, Timer } from 'lucide-react';
import { Tooltip } from '@/client/components/Tooltip';
import mark from '@/client/assets/logo-mark.png';
import { rng } from './data';
import { LANDING_HELP } from './help';
import { DemoNote, Reveal, Section, SectionHead, useClock, useInView } from './kit';
import s from './landing.module.css';

const PERIOD = 11;
const CLOSE = 3; // the candle closes 3 s into the loop
const CHECK = [3.7, 4.3] as const;
const VERIFIED = 5.1;
const SENT = 5.35;

/** The forming candle's ticks over the last 3 seconds before the close. */
function useTicks() {
  return useMemo(() => {
    const r = rng(5);
    const out: number[] = [];
    let p = 25_418;
    for (let i = 0; i < 36; i++) {
      p += (r() - 0.42) * 3.2;
      out.push(p);
    }
    return out;
  }, []);
}

const PREV = [
  { o: 25_396, h: 25_404, l: 25_388, c: 25_401 },
  { o: 25_401, h: 25_409, l: 25_392, c: 25_394 },
  { o: 25_394, h: 25_402, l: 25_385, c: 25_399 },
  { o: 25_399, h: 25_413, l: 25_397, c: 25_410 },
  { o: 25_410, h: 25_416, l: 25_403, c: 25_406 },
  { o: 25_406, h: 25_421, l: 25_404, c: 25_418 },
];

function FormingCandle({ t }: { t: number }) {
  const ticks = useTicks();
  const n = Math.max(1, Math.min(ticks.length, Math.floor((Math.min(t, CLOSE) / CLOSE) * ticks.length)));
  const seen = ticks.slice(0, n);
  const live = { o: 25_418, h: Math.max(25_418, ...seen), l: Math.min(25_418, ...seen), c: seen[n - 1]! };
  const all = [...PREV, live];
  const lo = 25_380;
  const hi = 25_470;
  const y = (v: number) => 10 + ((hi - v) / (hi - lo)) * 140;
  const step = 300 / 8;
  const closed = t >= CLOSE;
  return (
    <svg viewBox="0 0 340 160" className="block h-auto w-full" aria-hidden>
      {all.map((b, i) => {
        const cx = 20 + i * step + step / 2;
        const up = b.c >= b.o;
        const last = i === all.length - 1;
        const col = up ? 'rgb(var(--bull))' : 'rgb(var(--bear))';
        return (
          <g key={i} opacity={last ? 1 : 0.5}>
            <line x1={cx} x2={cx} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth={1.5} />
            <rect x={cx - 9} width={18} y={y(Math.max(b.o, b.c))} height={Math.max(1.5, Math.abs(y(b.o) - y(b.c)))} rx={2} fill={col} />
          </g>
        );
      })}
      {/* ticks streaming in */}
      {!closed &&
        seen
          .slice(-8)
          .map((p, i, arr) => (
            <circle
              key={n - arr.length + i}
              cx={300 - (arr.length - 1 - i) * 7}
              cy={y(p)}
              r={2}
              fill="rgb(var(--accent-soft))"
              opacity={(i + 1) / arr.length}
            />
          ))}
      <line x1={20 + 7 * step} x2={20 + 7 * step} y1={4} y2={156} stroke={closed ? 'rgb(var(--warn))' : 'rgb(255 255 255 / 0.15)'} strokeDasharray="3 4" />
      <text x={20 + 7 * step + 6} y={14} fontSize={10} fill={closed ? 'rgb(var(--warn))' : 'rgb(100 116 139)'} className={s.mono}>
        10:15:00
      </text>
    </svg>
  );
}

function Step({ on, icon, title, detail }: { on: boolean; icon: ReactNode; title: string; detail?: ReactNode }) {
  return (
    <li className={clsx('flex items-start gap-3 transition-opacity duration-300', on ? 'opacity-100' : 'opacity-30')}>
      <span
        className={clsx(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors',
          on ? 'border-accent bg-accent/15 text-accent-soft' : 'border-white/15 text-slate-500',
        )}
      >
        {icon}
      </span>
      <span>
        <span className="block text-[15px] font-medium text-fg">{title}</span>
        {detail && <span className={clsx(s.mono, 'mt-0.5 block text-[11px] text-slate-500')}>{detail}</span>}
      </span>
    </li>
  );
}

const TG_LINES = [
  ['🔔 Future leads the call (v3)', 'font-semibold text-white'],
  ['NIFTY 50 · NIFTY 25400 · exp 2026-10-27', ''],
  ['15 min candle 2026-10-26 10:00 IST', ''],
  ['✓ Verified on Kite candles', 'text-white'],
  ['A · FUT: NIFTY26OCTFUT @ 25,431.5', ''],
  ['B · CE ATM: NIFTY26OCT25400CE @ 186.4', ''],
  ['', ''],
  ['✅ A · FUT RSI(14) > B · CE ATM RSI(14)  (63.8 vs 61.2)', ''],
  ['✅ B · CE ATM RSI(14) crossed above 60  (58.4 → 61.2)', ''],
] as const;

function Phone({ show }: { show: boolean }) {
  return (
    <div className="relative mx-auto w-full max-w-[300px] rounded-[2.4rem] border border-white/10 bg-[#0b0f17] p-2.5 shadow-[0_40px_100px_-30px_rgb(0_0_0/0.9)]">
      <div className="overflow-hidden rounded-[1.9rem] bg-[#0e1621]">
        <div className="flex items-center gap-3 border-b border-white/5 bg-[#17212b] px-4 pb-3 pt-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white">
            <Image src={mark} alt="" height={16} width={Math.round((16 * mark.width) / mark.height)} />
          </span>
          <span>
            <span className="block text-[13px] font-semibold text-white">Algo Hunt</span>
            <span className="block text-[11px] text-sky-300/80">bot</span>
          </span>
        </div>
        <div className="flex h-[330px] flex-col justify-end px-3 py-4">
          <div
            className={clsx(
              'rounded-2xl rounded-bl-md bg-[#182533] px-3 py-2.5 transition-all duration-500',
              show ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
            )}
          >
            {TG_LINES.map(([line, cls], i) => (
              <div key={i} className={clsx('text-[10.5px] leading-[1.5] text-slate-200', cls, !line && 'h-2')}>
                {line}
              </div>
            ))}
            <div className="mt-1 text-right text-[9px] text-slate-500">10:15</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AlertFlow() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [t, restart] = useClock(inView, PERIOD, 40);
  const since = Math.max(0, Math.min(t, VERIFIED) - CLOSE);
  const sec = 57 + Math.min(t, CLOSE);
  const clockText = t < CLOSE ? `10:14:${sec.toFixed(1).padStart(4, '0')}` : '10:15:00.0';

  return (
    <Section id="alerts">
      <div className="pointer-events-none absolute right-0 top-1/3 h-[500px] w-[500px] rounded-full bg-warn/[0.07] blur-[120px]" />
      <SectionHead
        no="03"
        kicker="Alert"
        title={
          <>
            The candle closes.
            <br />
            <span className={s.alertText}>Two seconds</span> later,
            <br />
            you know.
          </>
        }
        sub="A live Kite tick stream builds every candle. Each signal is re-checked on Kite’s official candle, then lands with strike, contract, LTP and every condition’s value."
      />
      <Reveal className="mt-14">
        <div ref={ref} className={clsx(s.panel, 'grid gap-8 p-5 sm:p-8 lg:grid-cols-12')}>
          <div className="lg:col-span-5">
            <div className="flex items-start justify-between">
              <div>
                <div className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-500')}>
                  {t < CLOSE ? 'IST · candle closing' : 'close → alert'}
                </div>
                <div className={clsx(s.display, 'mt-2 tabular-nums text-[clamp(2.8rem,6vw,4.4rem)]', t >= VERIFIED ? 'text-warn' : 'text-fg')}>
                  {t < CLOSE ? <span className={s.mono}>{clockText}</span> : `+${since.toFixed(1)}s`}
                </div>
              </div>
              <Tooltip content={LANDING_HELP.replay}>
                <button
                  type="button"
                  onClick={restart}
                  aria-label="Replay"
                  className="rounded-full border border-white/10 p-2.5 text-slate-400 transition-colors hover:border-white/30 hover:text-fg"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
            <div className="mt-5 rounded-2xl border border-white/[0.06] bg-black/20 p-3">
              <FormingCandle t={t} />
            </div>
            <ol className="mt-6 space-y-4">
              <Step on icon={<Radio className="h-3.5 w-3.5" />} title="Kite stream builds the candle" detail="every tick, every contract in use" />
              <Step on={t >= CLOSE} icon={<Timer className="h-3.5 w-3.5" />} title="Candle closes · 10:15:00" />
              <Step
                on={t >= CHECK[1]}
                icon={<Check className="h-3.5 w-3.5" />}
                title="Conditions checked"
                detail={
                  <>
                    {t >= CHECK[0] ? '✅' : '◻'} A · FUT RSI &gt; B · CE RSI &nbsp; {t >= CHECK[1] ? '✅' : '◻'} B · CE RSI ↗ 60
                  </>
                }
              />
              <Step on={t >= VERIFIED} icon={<BadgeCheck className="h-3.5 w-3.5" />} title="Kite’s own candle agrees" detail="✓ Verified" />
              <Step on={t >= SENT} icon={<Send className="h-3.5 w-3.5" />} title="Sent" detail="Telegram · Email · Desktop alarm" />
            </ol>
          </div>

          <div className="grid items-center gap-5 sm:grid-cols-[1fr_1fr] lg:col-span-7">
            <Phone show={t >= SENT} />
            <div className="space-y-4">
              <div
                className={clsx(
                  'rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all duration-500',
                  t >= SENT + 0.3 ? 'opacity-100' : 'translate-y-4 opacity-0',
                )}
              >
                <div className="flex items-center gap-2 text-[12px] text-slate-400">
                  <Mail className="h-4 w-4 text-accent-soft" /> Email · 10:15
                </div>
                <div className="mt-2 text-sm font-semibold text-fg">Alert · Future leads the call · NIFTY</div>
                <div className="mt-1 text-[12px] leading-relaxed text-slate-500">Every leg’s contract and price, every condition with its values.</div>
              </div>
              <div
                className={clsx(
                  'overflow-hidden rounded-2xl border border-white/10 bg-[#0b0f17] transition-all duration-500',
                  t >= SENT + 0.6 ? 'opacity-100' : 'translate-y-4 opacity-0',
                )}
              >
                <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-white/15" />
                  <span className="h-2 w-2 rounded-full bg-white/15" />
                  <span className="h-2 w-2 rounded-full bg-white/15" />
                  <span
                    className={clsx(
                      s.mono,
                      'ml-2 truncate rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px]',
                      Math.floor(t * 2) % 2 ? 'text-warn' : 'text-slate-400',
                    )}
                  >
                    {Math.floor(t * 2) % 2 ? '🔔 New alert' : 'Algo Hunt'}
                  </span>
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-3 rounded-xl border border-warn/50 bg-warn/15 px-3 py-2.5">
                    <span className="relative">
                      <Bell className={clsx('h-5 w-5 text-warn', s.ring)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-fg">Future leads the call</span>
                      <span className="block truncate text-[11px] text-slate-400">NIFTY 25400 · 15 min</span>
                    </span>
                    <span className="rounded-md bg-warn px-2 py-1 text-[11px] font-semibold text-black">Stop</span>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 pl-1" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span key={i} className={clsx(s.wave, 'h-3 w-3 rounded-full border border-warn/70')} style={{ animationDelay: `${i * 0.3}s` }} />
                    ))}
                    <span className={clsx(s.mono, 'ml-2 text-[10px] text-slate-500')}>alarm until you stop it</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
      <DemoNote>Example alert · the message is the real format</DemoNote>
    </Section>
  );
}
