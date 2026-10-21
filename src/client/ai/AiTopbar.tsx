'use client';

/**
 * The AI in the top bar: the button that opens the panel, and the Groq allowance — requests used today of the
 * day's total, tokens used this minute — with when each renews and what this app used today (white on the brand
 * header; amber only when the day's requests are nearly gone).
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import type { AiStatus } from '@/shared/ai/types';
import { Tooltip } from '../components/Tooltip';
import { aiApi } from './api';
import { AI } from './help';
import { ai, useAi } from './store';

const n = (v: number) => v.toLocaleString('en-IN');
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const inWords = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** What's left now: Groq's last figures, with the minute's tokens back once their reset time passed. */
function allowance(s: AiStatus, now: number) {
  const l = s.limits;
  const reqUsed = l.requestsPerDay !== null && l.requestsLeft !== null ? l.requestsPerDay - l.requestsLeft : null;
  const tokensBack = l.tokensResetAt !== null && now >= l.tokensResetAt;
  const tokLeft = l.tokensPerMinute !== null ? (tokensBack ? l.tokensPerMinute : l.tokensLeft) : null;
  return { reqUsed, tokLeft, tokensBack };
}

export function AiTopbar() {
  const { open } = useAi();
  const status = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status, refetchInterval: (q) => (q.state.data?.busy ? 3000 : 30_000), retry: false });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const s = status.data;
  const a = s ? allowance(s, now) : null;
  const l = s?.limits;
  const low = !!l && l.requestsPerDay !== null && l.requestsLeft !== null && l.requestsLeft < l.requestsPerDay * 0.1;

  return (
    <div className="flex items-center gap-2">
      <Tooltip content={s && !s.configured ? { ...AI.button, note: s.note ?? AI.button.note } : AI.button} side="bottom">
        <button type="button" aria-pressed={open} className={clsx('btn-glass text-xs', open && 'bg-white/25')} onClick={ai.toggle}>
          <Sparkles className="w-4 h-4" /> AI
        </button>
      </Tooltip>
      {s?.configured && l && (
        <Tooltip
          side="bottom"
          content={{
            ...AI.usage,
            body: (
              <span className="flex flex-col gap-1">
                <span>
                  <b>Requests today:</b> {a!.reqUsed !== null ? `${n(a!.reqUsed)} used of ${n(l.requestsPerDay!)} (${n(l.requestsLeft!)} left)` : 'not known yet'}
                  {l.requestsResetAt !== null && a!.reqUsed ? ` — all back by ${clock(l.requestsResetAt)} IST (in ${inWords(l.requestsResetAt - now)}; Groq’s day slides, so some come back sooner)` : ''}
                </span>
                <span>
                  <b>Tokens this minute:</b> {l.tokensPerMinute !== null ? `${n(l.tokensPerMinute - (a!.tokLeft ?? l.tokensPerMinute))} used of ${n(l.tokensPerMinute)}` : 'not known yet'}
                  {!a!.tokensBack && l.tokensResetAt !== null ? ` — back by ${clock(l.tokensResetAt)} IST` : ' — all available'}
                </span>
                <span>
                  <b>This app today:</b> {n(s.usage.requests)} request{s.usage.requests === 1 ? '' : 's'} · {n(s.usage.promptTokens + s.usage.completionTokens)} tokens ({n(s.usage.promptTokens)} read, {n(s.usage.completionTokens)} written)
                </span>
                <span className="text-slate-400">Model: {s.model}{l.checkedAt ? ` · figures from Groq at ${clock(l.checkedAt)}` : ''}</span>
              </span>
            ),
          }}
        >
          <span className={clsx('hidden md:flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium text-white cursor-help', low ? 'border-white/40 bg-warn/80' : 'border-white/25 bg-white/15')} tabIndex={0}>
            {a?.reqUsed !== null && a?.reqUsed !== undefined ? `${n(a.reqUsed)} / ${n(l.requestsPerDay!)} today` : 'AI ready'}
            {l.tokensPerMinute !== null && a?.tokLeft !== null && a?.tokLeft !== undefined && <span className="text-white/75">· {Math.round(((l.tokensPerMinute - a.tokLeft) / l.tokensPerMinute) * 100)}% of the minute</span>}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
