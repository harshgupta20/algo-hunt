'use client';

/**
 * "Create with AI" on the Strategies page — its own window and conversation, separate from the AI chat. The trader
 * describes a strategy; the AI asks when something essential is unclear, then builds it exactly (every assumption
 * listed) for them to open in the builder or save. It only builds — it never backtests or saves by itself.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw, Send, Sparkles, Square, Workflow, X } from 'lucide-react';
import type { AiConversation, AiProposal } from '@/shared/ai/types';
import type { EqStrategy, EqStrategyDefinition } from '@/shared/equity';
import { EQ_TIMEFRAME } from '@/shared/equity';
import { Tooltip } from '../components/Tooltip';
import { Badge, IconButton } from '../components/ui';
import { InlineSpinner } from '../components/loaders';
import { eqApi } from '../equity/api';
import { aiApi } from './api';
import { AI } from './help';
import { Markdown } from './Markdown';

const KEY = 'algo-hunt.ai-creator';
const EXAMPLES = [
  'Weekly: buy when the close crosses above the 20-week SMA and RSI(14) is above 60. Exit when the close crosses below the 20 SMA. Pyramid on the 20 SMA.',
  'Daily: buy when the close breaks above the 52-week high and volume is above 1.5× its 20-day average. 10% trailing stop.',
  'Daily: buy when RSI(14) crosses above its 9-period average while the close is above the 200 EMA. Exit when RSI crosses back below its average, or an 8% stop-loss.',
];

const remembered = () => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const remember = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
};

function Built({ p, onOpen }: { p: AiProposal; onOpen: (d: EqStrategyDefinition) => void }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<EqStrategy | null>(null);
  const save = useMutation({
    mutationFn: () => eqApi.createStrategy(p.definition),
    onSuccess: (s) => {
      setSaved(s);
      void qc.invalidateQueries({ queryKey: ['eq-strategies'] });
    },
  });
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={AI.proposal}>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <Workflow className="w-4 h-4 text-accent-soft" /> {p.definition.name}
          </span>
        </Tooltip>
        <Badge tone="accent">{EQ_TIMEFRAME[p.definition.timeframe].label}</Badge>
        {p.definition.pyramid.enabled && <Badge>Pyramiding</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {saved ? (
            <Tooltip content={{ title: 'Saved', body: `“${saved.name}” is in your strategies (v${saved.version}).` }}>
              <span className="flex items-center gap-1 text-xs text-slate-300">
                <Check className="w-3.5 h-3.5 text-accent-soft" /> Saved
              </span>
            </Tooltip>
          ) : (
            <Tooltip content={AI.creatorSave}>
              <button type="button" className="btn-ghost py-1 text-xs" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? <InlineSpinner className="w-3.5 h-3.5" /> : null} Save as new strategy
              </button>
            </Tooltip>
          )}
          <Tooltip content={AI.openBuilder}>
            <button type="button" className="btn-primary py-1 text-xs" onClick={() => onOpen(saved ? saved.definition : p.definition)}>
              Open in builder
            </button>
          </Tooltip>
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-300">
        {p.summary.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {p.assumptions && p.assumptions.length > 0 && (
        <div className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2">
          <Tooltip content={AI.creatorAssumed}>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-warn">Assumed — check these</span>
          </Tooltip>
          <ul className="mt-1 list-disc pl-4 text-xs text-slate-300">
            {p.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {p.warnings.length > 0 && <p className="mt-2 text-xs text-warn">{p.warnings.map((w) => w.message).join(' · ')}</p>}
      {save.error && <p className="mt-2 text-xs text-warn">{(save.error as Error).message}</p>}
    </div>
  );
}

export function StrategyCreator({ onOpen, onClose }: { onOpen: (d: EqStrategyDefinition) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [id, setId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setId(remembered());
    setTimeout(() => box.current?.focus(), 50);
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const conv = useQuery({
    queryKey: ['ai-conversation', id],
    queryFn: () => aiApi.conversation(id!),
    enabled: !!id,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 1000 : false),
  });
  useEffect(() => {
    if (conv.error && (conv.error as { status?: number }).status === 404) {
      remember(null);
      setId(null);
    }
  }, [conv.error]);
  const c: AiConversation | undefined = id ? conv.data : undefined;
  const running = c?.status === 'RUNNING';
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [c?.messages.length, c?.updatedAt]);
  useEffect(() => {
    if (c?.status === 'IDLE') void qc.invalidateQueries({ queryKey: ['ai-status'] });
  }, [c?.status, c?.updatedAt, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: (message: string) => aiApi.send({ mode: 'CREATOR', ...(id ? { conversationId: id } : {}), message }),
    onSuccess: (r) => {
      qc.setQueryData(['ai-conversation', r.id], r);
      setId(r.id);
      remember(r.id);
      setText('');
    },
  });
  const stop = useMutation({ mutationFn: () => aiApi.stop(id!), onSuccess: (r) => qc.setQueryData(['ai-conversation', r.id], r) });
  const ask = () => {
    const q = text.trim();
    if (q && !running && !send.isPending) send.mutate(q);
  };
  const startOver = () => {
    if (id) void aiApi.remove(id).catch(() => undefined);
    remember(null);
    setId(null);
    setText('');
    setTimeout(() => box.current?.focus(), 50);
  };
  const messages = c?.messages ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Create a strategy with AI" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden p-0 shadow-2xl">
        <div className="flex items-start gap-3 border-b border-ink-700 px-5 py-3">
          <Sparkles className="mt-0.5 w-5 h-5 text-accent-soft" />
          <div className="min-w-0">
            <Tooltip content={AI.create}>
              <h2 className="text-base font-semibold text-fg">Create a strategy with AI</h2>
            </Tooltip>
            <p className="text-xs text-slate-400">Describe it in your words. I ask if something essential is unclear, then build it exactly — every assumption listed. Nothing is saved until you choose.</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <IconButton help={AI.creatorStartOver} onClick={startOver} className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800">
              <RotateCcw className="w-4 h-4" />
            </IconButton>
            <IconButton help={AI.creatorClose} onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800">
              <X className="w-4 h-4" />
            </IconButton>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!messages.length ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-ink-700/60 bg-ink-850/50 p-3 text-xs text-slate-400">
                <p className="font-medium text-slate-300">Say as much as you know — I’ll ask about the rest:</p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  <li>
                    <b className="text-slate-300">Timeframe</b> — daily or weekly
                  </li>
                  <li>
                    <b className="text-slate-300">When to buy</b> — e.g. close crosses above SMA 20, RSI above 60, 52-week high
                  </li>
                  <li>
                    <b className="text-slate-300">When to sell</b> — target %, stop-loss %, trailing stop, an exit rule, or after N days/weeks
                  </li>
                  <li>
                    <b className="text-slate-300">Pyramiding</b> (optional) — add a lot when the rising MA reaches the last buy
                  </li>
                  <li>
                    <b className="text-slate-300">Money per buy</b> (optional) — ₹ amount, shares, or % of the account
                  </li>
                </ul>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Examples</span>
                {EXAMPLES.map((x) => (
                  <Tooltip key={x} content={AI.creatorExample} className="block">
                    <button
                      type="button"
                      className="w-full rounded-lg border border-ink-700 px-3 py-2 text-left text-xs text-slate-300 hover:border-accent/50 hover:bg-ink-800"
                      onClick={() => {
                        setText(x);
                        box.current?.focus();
                      }}
                    >
                      {x}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m, k) =>
                m.role === 'user' ? (
                  <div key={m.id} className="ml-16 self-end whitespace-pre-wrap rounded-xl rounded-br-sm bg-accent/15 px-3 py-2 text-xs text-slate-200">
                    {m.text}
                  </div>
                ) : (
                  <div key={m.id} className="flex flex-col gap-3">
                    {running && k === messages.length - 1 && (
                      <p className="flex items-center gap-2 text-xs text-slate-400">
                        <InlineSpinner className="w-3.5 h-3.5" /> {c?.activity?.startsWith('Working') ? 'Building and checking the strategy…' : (c?.activity ?? 'Thinking…')}
                      </p>
                    )}
                    {m.proposals?.slice(-1).map((p) => (
                      <Built key={p.draftId} p={p} onOpen={onOpen} />
                    ))}
                    {m.text &&
                      (m.failed ? (
                        <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-slate-300">{m.text}</p>
                      ) : (
                        <Markdown text={m.text} />
                      ))}
                  </div>
                ),
              )}
            </div>
          )}
          <div ref={end} />
        </div>

        <div className="border-t border-ink-700 p-3">
          {send.error && <p className="mb-1.5 text-[11px] text-warn">{(send.error as Error).message}</p>}
          <div className="flex items-end gap-2">
            <textarea
              ref={box}
              aria-label="Describe your strategy"
              rows={3}
              className="input flex-1 resize-none py-2 text-sm"
              placeholder={messages.length ? 'Answer, or tell me what to change…' : 'Describe your strategy…'}
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
              <IconButton help={AI.stop} onClick={() => stop.mutate()} className="btn-ghost px-3 py-2.5">
                <Square className="w-4 h-4" />
              </IconButton>
            ) : (
              <IconButton help={AI.send} onClick={ask} disabled={!text.trim() || send.isPending} className="btn-primary px-3 py-2.5">
                {send.isPending ? <InlineSpinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
