'use client';

import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Calculator, HandHelping, MessageCircleQuestion, Sparkles, Zap } from 'lucide-react';
import { Tooltip } from '@/client/components/Tooltip';
import { LANDING_HELP } from './help';
import { Reveal, Section, SectionHead, useClock, useInView } from './kit';
import s from './landing.module.css';

type Token = { kind: 'value' | 'op' | 'num'; text: string };
const v = (text: string): Token => ({ kind: 'value', text });
const o = (text: string): Token => ({ kind: 'op', text });
const n = (text: string): Token => ({ kind: 'num', text });

interface Prompt {
  text: string;
  /** Words in the sentence → the rule built from them (same order). */
  phrases: string[];
  rules: Array<{ section: string; tokens: Token[] }>;
  assumed: string[];
}

const PROMPTS: Prompt[] = [
  {
    text: 'Buy when SMA 50 crosses above SMA 100 and RSI is above 60. Add a 10% trailing stop.',
    phrases: ['SMA 50 crosses above SMA 100', 'RSI is above 60', '10% trailing stop'],
    rules: [
      { section: 'Buy when · all', tokens: [v('SMA(50)'), o('crosses above'), v('SMA(100)')] },
      { section: 'Buy when · all', tokens: [v('RSI(14)'), o('>'), n('60')] },
      { section: 'Sell when', tokens: [v('Trailing stop'), n('10 %')] },
    ],
    assumed: ['RSI period 14', 'Checked on the daily close'],
  },
  {
    text: 'Weekly close above the 20-week MA with RSI over 60. Pyramid when the MA catches up.',
    phrases: ['Weekly close above the 20-week MA', 'RSI over 60', 'Pyramid when the MA catches up'],
    rules: [
      { section: 'Buy when · all', tokens: [v('Close'), o('>'), v('SMA(20)')] },
      { section: 'Buy when · all', tokens: [v('RSI(14)'), o('>'), n('60')] },
      { section: 'Pyramiding', tokens: [v('SMA(20)'), o('reaches'), v('last buy')] },
    ],
    assumed: ['Weekly candles', 'MA type: SMA'],
  },
  {
    text: 'Buy a 52-week breakout on 1.5× average volume, stop-loss 8%.',
    phrases: ['52-week breakout', '1.5× average volume', 'stop-loss 8%'],
    rules: [
      { section: 'Buy when · all', tokens: [v('Close'), o('crosses above'), v('HIGHEST(252, high)')] },
      { section: 'Buy when · all', tokens: [v('Volume'), o('>'), n('1.5 ×'), v('SMA(20, volume)')] },
      { section: 'Sell when', tokens: [v('Stop-loss'), n('8 %')] },
    ],
    assumed: ['Average volume over 20 days'],
  },
];

const PERIOD = 10;
const TYPE_RATE = 34;
const THINK_S = 0.9;
const ROW_S = 0.55;

/** The sentence, with each phrase lit once its rule is built. */
function Sentence({ p, typed, lit }: { p: Prompt; typed: number; lit: number }) {
  const shown = p.text.slice(0, typed);
  const parts: ReactNode[] = [];
  let at = 0;
  p.phrases.forEach((ph, i) => {
    const start = p.text.indexOf(ph);
    if (start < 0 || start >= shown.length) return;
    if (start > at) parts.push(shown.slice(at, start));
    const end = Math.min(shown.length, start + ph.length);
    parts.push(
      <span
        key={i}
        className={clsx('rounded px-0.5 transition-colors duration-300', i < lit ? 'bg-accent/25 text-fg shadow-[inset_0_-2px_0_rgb(var(--accent))]' : '')}
      >
        {shown.slice(start, end)}
      </span>,
    );
    at = end;
  });
  if (at < shown.length) parts.push(shown.slice(at));
  return <>{parts}</>;
}

function Chip({ t }: { t: Token }) {
  return (
    <span
      className={clsx(
        s.mono,
        'rounded-lg px-2.5 py-1 text-[13px]',
        t.kind === 'value' && 'border border-white/15 bg-white/[0.05] text-fg',
        t.kind === 'op' && 'text-accent-soft',
        t.kind === 'num' && 'border border-accent/40 bg-accent/10 font-semibold text-fg',
      )}
    >
      {t.text}
    </span>
  );
}

export function AiWords() {
  const [base, setBase] = useState(0);
  const [ref, inView] = useInView<HTMLDivElement>();
  const [t, restart] = useClock(inView, undefined, 40);
  const idx = (base + Math.floor(t / PERIOD)) % PROMPTS.length;
  const local = t % PERIOD;
  const p = PROMPTS[idx]!;
  const typeEnd = p.text.length / TYPE_RATE;
  const typed = Math.min(p.text.length, Math.floor(local * TYPE_RATE));
  const thinking = local >= typeEnd && local < typeEnd + THINK_S;
  const built = Math.max(0, Math.min(p.rules.length, Math.floor((local - typeEnd - THINK_S) / ROW_S) + 1));
  const assumedOn = local >= typeEnd + THINK_S + p.rules.length * ROW_S;
  let lastSection = '';

  return (
    <Section id="ai">
      <div className="pointer-events-none absolute left-0 top-1/4 h-[460px] w-[460px] rounded-full bg-accent/[0.08] blur-[120px]" />
      <SectionHead
        no="08"
        kicker="Trading AI"
        title={
          <>
            Say it.
            <br />
            It builds it.
          </>
        }
        sub="Describe a strategy in plain words. The AI writes the rules, tells you what it assumed, and waits for you."
      />
      <Reveal className="mt-14">
        <div ref={ref} className="grid gap-5 lg:grid-cols-2">
          <div className={clsx(s.panel, 'flex flex-col p-5 sm:p-7')}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Sparkles className="h-4 w-4 text-accent-soft" /> Describe in words
              </span>
              <div className="flex gap-1.5">
                {PROMPTS.map((pr, i) => (
                  <Tooltip key={i} content={{ ...LANDING_HELP.aiPrompt, example: pr.text }}>
                    <button
                      type="button"
                      aria-label={`Example ${i + 1}`}
                      onClick={() => {
                        setBase(i);
                        restart();
                      }}
                      className={clsx('h-2.5 rounded-full transition-all', i === idx ? 'w-7 bg-accent' : 'w-2.5 bg-white/20 hover:bg-white/40')}
                    />
                  </Tooltip>
                ))}
              </div>
            </div>
            <div className="mt-5 min-h-[150px] flex-1 rounded-2xl border border-white/10 bg-black/30 p-5 text-[clamp(1.1rem,2vw,1.4rem)] leading-relaxed text-slate-300">
              <Sentence p={p} typed={typed} lit={built} />
              {typed < p.text.length && <span className={clsx(s.caret, 'ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.2em] bg-accent-soft')} />}
            </div>
            <div className={clsx(s.mono, 'mt-4 flex items-center gap-2 text-[11px] text-slate-500')}>
              <Zap className={clsx('h-3.5 w-3.5', thinking ? 'text-warn' : 'text-slate-600')} />
              {thinking ? 'reading your words…' : built ? 'built · about 1 s, 1 request' : 'type it the way you’d say it'}
            </div>
          </div>

          <div className={clsx(s.panel, 'flex flex-col p-5 sm:p-7')}>
            <div className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-500')}>Builder · unsaved</div>
            <div className="mt-4 flex-1 space-y-3">
              {p.rules.map((r, i) => {
                const head = r.section !== lastSection ? r.section : null;
                lastSection = r.section;
                const on = i < built;
                return (
                  <div key={`${idx}-${i}`}>
                    {head && (
                      <div className={clsx(s.mono, 'mb-2 mt-1 text-[10px] uppercase tracking-[0.2em]', on ? 'text-slate-400' : 'text-slate-700')}>{head}</div>
                    )}
                    <div
                      className={clsx(
                        'flex flex-wrap items-center gap-1.5 rounded-xl border p-2.5 transition-all duration-500',
                        on ? 'translate-x-0 border-accent/30 bg-accent/[0.06] opacity-100' : 'translate-x-4 border-white/5 opacity-0',
                      )}
                    >
                      {r.tokens.map((tk, j) => (
                        <Chip key={j} t={tk} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={clsx('mt-5 transition-opacity duration-500', assumedOn ? 'opacity-100' : 'opacity-0')}>
              <div className={clsx(s.mono, 'mb-2 text-[10px] uppercase tracking-[0.2em] text-warn')}>Assumed · check these</div>
              <div className="flex flex-wrap gap-1.5">
                {p.assumed.map((a) => (
                  <span key={a} className="rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-1 text-[13px] text-warn">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Reveal>
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        {(
          [
            [<Calculator key="c" />, 'Every number from a tool', 'The model never makes up a figure. It calls the app’s own engine.'],
            [<HandHelping key="h" />, 'It proposes. You decide.', 'It can’t save, delete or trade. Rules land in the builder, unsaved.'],
            [<MessageCircleQuestion key="q" />, 'Asks before the next step', 'Backtests only when you ask for one.'],
          ] as const
        ).map(([icon, title, body], i) => (
          <Reveal key={title} className={clsx(s.panel, 'p-5')} delay={i * 80}>
            <span className="text-accent-soft [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
            <div className="mt-3 text-[17px] font-semibold text-fg">{title}</div>
            <div className="mt-1.5 text-[14px] leading-relaxed text-slate-400">{body}</div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
