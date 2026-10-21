'use client';

/**
 * The trading AI panel: a drawer on the right of every page. Ask in plain words; the AI works through the app's
 * tools (each step shows as it happens), writes strategies you open in the builder, and runs backtests you can open
 * on the Backtest tab. What's on screen goes with the question unless untoggled.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, FlaskConical, History, MessageSquarePlus, Send, Sparkles, Square, Trash2, Workflow, X } from 'lucide-react';
import type { AiConversation, AiMessage, AiProposal } from '@/shared/ai/types';
import { Tooltip } from '../components/Tooltip';
import { IconButton } from '../components/ui';
import { InlineSpinner } from '../components/loaders';
import { aiApi } from './api';
import { AI } from './help';
import { Markdown } from './Markdown';
import { ai, restoreConversation, useAi } from './store';

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

function suggestions(page: ReturnType<typeof useAi>['page']): string[] {
  if (page?.backtestId) return ['Analyse this backtest — what drove it and where is the risk?', 'Is it robust or curve-fitted? Check it.', 'Why did it lag NIFTY 50 in its bad years?'];
  if (page?.page === 'equity-builder') return ['Explain this strategy and its weak points', 'Backtest it on NIFTY 50 for 5 years and give me a verdict', 'Suggest a better exit and test both'];
  return [
    'Build: weekly close crosses above the 20-week SMA and RSI(14) above 55; exit below the 20 SMA; pyramid on the 20 SMA',
    'Backtest a 52-week-high breakout on NIFTY 100 for 5 years',
    'Which of my backtests did best, and is it robust?',
  ];
}

function Proposal({ p }: { p: AiProposal }) {
  const router = useRouter();
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5">
      <div className="flex items-center gap-1.5">
        <Tooltip content={AI.proposal}>
          <span className="flex items-center gap-1 text-[11px] font-semibold text-accent-soft">
            <Workflow className="w-3.5 h-3.5" /> {p.definition.name}
          </span>
        </Tooltip>
        <Tooltip content={AI.openBuilder} className="ml-auto">
          <button
            type="button"
            className="btn-primary px-2 py-0.5 text-[11px]"
            onClick={() => {
              ai.toBuilder(p.definition);
              router.push('/equity?tab=strategies');
            }}
          >
            Open in builder
          </button>
        </Tooltip>
      </div>
      <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-slate-400">
        {p.summary.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {p.warnings.length > 0 && <p className="mt-1 text-[11px] text-warn">{p.warnings.map((w) => w.message).join(' · ')}</p>}
    </div>
  );
}

function Answer({ m, running, activity }: { m: AiMessage; running: boolean; activity: string | null }) {
  const router = useRouter();
  const steps = m.steps ?? [];
  return (
    <div className="flex flex-col gap-2">
      {steps.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-ink-700/60 bg-ink-850/60 px-2.5 py-2">
          <Tooltip content={AI.steps} className="self-start">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Steps</span>
          </Tooltip>
          {steps.map((s) => (
            <div key={s.id} className="flex items-start gap-1.5 text-[11px]">
              <span className="mt-0.5 shrink-0">{s.status === 'running' ? <InlineSpinner className="w-3 h-3" /> : s.status === 'done' ? <Check className="w-3 h-3 text-accent-soft" /> : <AlertTriangle className="w-3 h-3 text-warn" />}</span>
              <span className="min-w-0">
                <span className={clsx(s.status === 'failed' ? 'text-slate-500' : 'text-slate-300')}>{s.title}</span>
                {s.detail && <span className="block text-slate-500">{s.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {running && (
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <InlineSpinner className="w-3.5 h-3.5" /> {activity ?? 'Thinking…'}
        </p>
      )}
      {m.text ? (
        m.failed ? (
          <div className="flex gap-2 rounded-lg border border-warn/40 bg-warn/5 px-2.5 py-2 text-xs text-slate-300">
            <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0 text-warn" />
            <span>{m.text}</span>
          </div>
        ) : (
          <Markdown text={m.text} />
        )
      ) : null}
      {m.proposals?.map((p) => (
        <Proposal key={p.draftId} p={p} />
      ))}
      {m.backtests && m.backtests.length > 0 && (
        <div className="flex flex-col gap-1">
          {m.backtests.map((b) => (
            <Tooltip key={b.historyId} content={AI.openBacktest} className="self-start">
              <button type="button" className="flex items-center gap-1.5 text-left text-[11px] text-accent-soft hover:underline" onClick={() => router.push(`/equity?tab=backtest&history=${b.historyId}`)}>
                <FlaskConical className="w-3.5 h-3.5 shrink-0" /> {b.label}
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

export function AiPanel() {
  const qc = useQueryClient();
  const { open, conversationId, page, prompt } = useAi();
  const [text, setText] = useState('');
  const [withPage, setWithPage] = useState(true);
  const [showList, setShowList] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => restoreConversation(), []);

  const conv = useQuery({
    queryKey: ['ai-conversation', conversationId],
    queryFn: () => aiApi.conversation(conversationId!),
    enabled: !!conversationId,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 1000 : false),
  });
  // Gone from the server (it restarted): start fresh.
  useEffect(() => {
    if (conv.error && (conv.error as { status?: number }).status === 404) ai.setConversation(null);
  }, [conv.error]);
  const c: AiConversation | undefined = conversationId ? conv.data : undefined;
  const running = c?.status === 'RUNNING';
  const list = useQuery({ queryKey: ['ai-conversations'], queryFn: () => aiApi.conversations('CHAT'), enabled: open && showList });

  const send = useMutation({
    mutationFn: (message: string) => aiApi.send({ mode: 'CHAT', ...(conversationId ? { conversationId } : {}), message, ...(withPage && page ? { context: page } : {}) }),
    onSuccess: (r) => {
      qc.setQueryData(['ai-conversation', r.id], r);
      ai.setConversation(r.id);
      setText('');
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    },
  });
  const stop = useMutation({ mutationFn: () => aiApi.stop(conversationId!), onSuccess: (r) => qc.setQueryData(['ai-conversation', r.id], r) });
  const remove = useMutation({
    mutationFn: (id: string) => aiApi.remove(id),
    onSuccess: (_r, id) => {
      if (id === conversationId) ai.setConversation(null);
      void qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
  });
  // Finished an answer: the header's allowance and the backtest history changed.
  useEffect(() => {
    if (c && c.status === 'IDLE') {
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
      void qc.invalidateQueries({ queryKey: ['eq-backtest-history'] });
    }
  }, [c?.status, c?.updatedAt, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  // A page's "Ask AI" button: fill the box, or ask straight away.
  useEffect(() => {
    if (!open || !prompt) return;
    const p = ai.takePrompt();
    if (!p) return;
    setWithPage(true);
    if (p.send && !running && !send.isPending) send.mutate(p.text);
    else {
      setText(p.text);
      setTimeout(() => box.current?.focus(), 50);
    }
  }, [open, prompt, running, send]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [c?.messages.length, c?.updatedAt, open]);
  useEffect(() => {
    if (open) setTimeout(() => box.current?.focus(), 50);
  }, [open]);

  if (!open) return null;
  const ask = (t = text) => {
    const q = t.trim();
    if (q && !running && !send.isPending) send.mutate(q);
  };
  const messages = c?.messages ?? [];

  return (
    <aside className="fixed bottom-0 right-0 top-16 z-40 flex w-full flex-col border-l border-ink-700 bg-ink-900 shadow-2xl sm:w-[460px]" aria-label="Trading AI">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <Sparkles className="w-4 h-4 text-accent-soft" />
        <Tooltip content={AI.button}>
          <span className="text-sm font-semibold text-slate-100">Trading AI</span>
        </Tooltip>
        <span className="truncate text-[10px] text-slate-500">Groq · {c ? `${c.usage.requests} req · ${fmtK(c.usage.promptTokens + c.usage.completionTokens)} tokens` : 'ready'}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton help={AI.list} onClick={() => setShowList((v) => !v)} className={clsx('p-1.5 rounded-md hover:bg-ink-800', showList ? 'text-accent-soft' : 'text-slate-400 hover:text-slate-200')}>
            <History className="w-4 h-4" />
          </IconButton>
          <IconButton
            help={AI.newChat}
            onClick={() => {
              ai.setConversation(null);
              setShowList(false);
              setTimeout(() => box.current?.focus(), 50);
            }}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </IconButton>
          <IconButton help={AI.close} onClick={ai.close} className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800">
            <X className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      {showList && (
        <div className="max-h-56 overflow-y-auto border-b border-ink-700 bg-ink-850/60">
          {list.isLoading && <p className="p-3 text-xs text-slate-500">Loading…</p>}
          {list.data?.length === 0 && <p className="p-3 text-xs text-slate-500">No conversations yet.</p>}
          {list.data?.map((l) => (
            <div key={l.id} className={clsx('flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-ink-800', l.id === conversationId && 'bg-accent/10')}>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-slate-300"
                onClick={() => {
                  ai.setConversation(l.id);
                  setShowList(false);
                }}
              >
                {l.title}
              </button>
              <span className="shrink-0 text-[10px] text-slate-500">{new Date(l.updatedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</span>
              <IconButton help={AI.remove} onClick={() => remove.mutate(l.id)} className="p-1 rounded text-slate-500 hover:text-slate-200">
                <Trash2 className="w-3.5 h-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!messages.length ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-slate-400">
              Ask in your own words. I build strategies, run backtests and tell you what drove a result — every number comes from the app’s own backtests. I never save or trade; you decide.
            </p>
            <div className="flex flex-col gap-1.5">
              {suggestions(page).map((s) => (
                <Tooltip key={s} content={{ title: 'Ask this', body: s }} className="block">
                  <button type="button" className="w-full rounded-lg border border-ink-700 px-2.5 py-1.5 text-left text-xs text-slate-300 hover:border-accent/50 hover:bg-ink-800" onClick={() => ask(s)}>
                    {s}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m, k) =>
              m.role === 'user' ? (
                <div key={m.id} className="ml-8 flex flex-col items-end gap-0.5">
                  <div className="rounded-xl rounded-br-sm bg-accent/15 px-3 py-2 text-xs text-slate-200 whitespace-pre-wrap">{m.text}</div>
                  {m.context && <span className="text-[10px] text-slate-500">about: {m.context}</span>}
                </div>
              ) : (
                <Answer key={m.id} m={m} running={running && k === messages.length - 1} activity={c?.activity ?? null} />
              ),
            )}
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="border-t border-ink-700 p-2.5">
        {send.error && <p className="mb-1.5 text-[11px] text-warn">{(send.error as Error).message}</p>}
        {page?.label && (
          <Tooltip content={AI.context} className="mb-1.5 block">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={withPage} onChange={(e) => setWithPage(e.target.checked)} />
              <span className="truncate">About: {page.label}</span>
            </label>
          </Tooltip>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={box}
            aria-label="Ask the trading AI"
            rows={2}
            className="input min-h-[2.5rem] flex-1 resize-none py-1.5 text-xs"
            placeholder={page?.page === 'equity-builder' ? 'Describe the strategy in your words, or ask about this one…' : 'Ask, or describe a strategy…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
          />
          {running ? (
            <IconButton help={AI.stop} onClick={() => stop.mutate()} className="btn-ghost px-2.5 py-2">
              <Square className="w-4 h-4" />
            </IconButton>
          ) : (
            <IconButton help={AI.send} onClick={() => ask()} disabled={!text.trim() || send.isPending} className="btn-primary px-2.5 py-2">
              {send.isPending ? <InlineSpinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </IconButton>
          )}
        </div>
      </div>
    </aside>
  );
}
