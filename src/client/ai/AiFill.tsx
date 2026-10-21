'use client';

/**
 * "Describe in words" inside the builder's Buy when / Sell when: the trader writes the rules, the AI returns the
 * section's complete rules (the current ones kept unless the words replace them), shown in plain words with what it
 * assumed — nothing changes until Apply. Too vague → one question to answer.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, X } from 'lucide-react';
import type { AiFillResult } from '@/shared/ai/types';
import type { EqGroup, EqNode, EqStrategyDefinition } from '@/shared/equity';
import { Tooltip } from '../components/Tooltip';
import { IconButton } from '../components/ui';
import { InlineSpinner } from '../components/loaders';
import { uid } from '../equity/format';
import { aiApi } from './api';
import { AI } from './help';

const EXAMPLE = {
  entry: 'e.g. SMA 50 crosses above SMA 100 and RSI(14) above 60 — or “also: close above the 200 EMA”',
  exit: 'e.g. 20% target, 8% stop-loss, or when the close crosses below SMA 50 — or “add a 10% trailing stop”',
};

/** Fresh ids for the AI's conditions, so they never clash with the builder's. */
function reId<T extends EqNode>(n: T): T {
  if (n.type === 'CONDITION') return { ...n, id: uid() };
  return { ...n, id: uid(), children: (n as EqGroup).children.map(reId) } as T;
}

export function AiFill({ part, strategy, onApply, onClose }: { part: 'entry' | 'exit'; strategy: EqStrategyDefinition; onApply: (next: EqStrategyDefinition) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [result, setResult] = useState<AiFillResult | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
  const write = useMutation({
    mutationFn: () => aiApi.fill({ part, text, strategy }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    },
  });
  const apply = () => {
    if (!result) return;
    if (part === 'entry' && result.entry) onApply({ ...strategy, entry: { ...result.entry, when: reId(result.entry.when) } });
    if (part === 'exit' && result.exit) onApply({ ...strategy, exit: { ...result.exit, when: result.exit.when ? reId(result.exit.when) : null } });
    onClose();
  };
  const ready = result && !result.question;

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-accent-soft" />
        <Tooltip content={part === 'entry' ? AI.fillEntry : AI.fillExit}>
          <span className="text-xs font-semibold text-slate-200">{part === 'entry' ? 'Describe the buy conditions in words' : 'Describe the sell rules in words'}</span>
        </Tooltip>
        <IconButton help={AI.fillClose} onClick={onClose} className="ml-auto p-1 rounded text-slate-400 hover:text-slate-200">
          <X className="w-3.5 h-3.5" />
        </IconButton>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          aria-label={part === 'entry' ? 'Buy conditions in words' : 'Sell rules in words'}
          rows={2}
          className="input flex-1 resize-none py-1.5 text-xs"
          placeholder={EXAMPLE[part]}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (text.trim() && !write.isPending) write.mutate();
            }
          }}
        />
        <Tooltip content={AI.fillWrite}>
          <button type="button" className="btn-primary py-1.5 text-xs" disabled={!text.trim() || write.isPending} onClick={() => write.mutate()}>
            {write.isPending ? <InlineSpinner className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />} {write.isPending ? 'Writing…' : 'Write it'}
          </button>
        </Tooltip>
      </div>
      {write.isPending && <p className="mt-1.5 text-[11px] text-slate-500">A few seconds — up to a minute when Groq’s free per-minute limit is used up.</p>}
      {write.error && <p className="mt-2 text-xs text-warn">{(write.error as Error).message}</p>}
      {result?.question && (
        <div className="mt-2 rounded-md border border-ink-700 bg-ink-900/60 px-3 py-2 text-xs text-slate-300">
          <span className="font-medium text-slate-200">The AI asks: </span>
          <span className="whitespace-pre-wrap">{result.question}</span>
          <p className="mt-1 text-[11px] text-slate-500">Add the answer to your words above and write it again.</p>
        </div>
      )}
      {ready && (
        <div className="mt-3 rounded-md border border-ink-700 bg-ink-900/60 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">The {part === 'entry' ? 'buy conditions' : 'sell rules'} would become</span>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-200">
            {result.reads?.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {result.assumptions && result.assumptions.length > 0 && (
            <div className="mt-2">
              <Tooltip content={AI.creatorAssumed}>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-warn">Assumed — check these</span>
              </Tooltip>
              <ul className="mt-0.5 list-disc pl-4 text-xs text-slate-300">
                {result.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings && result.warnings.length > 0 && <p className="mt-2 text-xs text-warn">{result.warnings.join(' · ')}</p>}
          <div className="mt-3 flex gap-2">
            <Tooltip content={AI.fillApply}>
              <button type="button" className="btn-primary py-1 text-xs" onClick={apply}>
                Apply
              </button>
            </Tooltip>
            <Tooltip content={AI.fillDiscard}>
              <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setResult(null)}>
                Discard
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}
