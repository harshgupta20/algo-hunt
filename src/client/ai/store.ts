'use client';

/**
 * The AI panel's shared state (one per tab): open or closed, the conversation shown, what the trader's screen is
 * about (pages publish it, so "this backtest" means something), and a strategy the AI wrote on its way to the
 * builder. A tiny external store — any component reads it with useAi().
 */
import { useSyncExternalStore } from 'react';
import type { AiPageContext } from '@/shared/ai/types';
import type { EqStrategyDefinition } from '@/shared/equity';

interface AiState {
  open: boolean;
  conversationId: string | null;
  /** What's on screen now (null = nothing in particular). */
  page: AiPageContext | null;
  /** Text put in the box by a page's "Ask AI" button; `send` = ask it straight away. */
  prompt: { text: string; send: boolean; at: number } | null;
  /** A strategy the AI wrote, waiting for the builder to open it. */
  toBuilder: EqStrategyDefinition | null;
}

const KEY = 'algo-hunt.ai-conversation';
let state: AiState = { open: false, conversationId: null, page: null, prompt: null, toBuilder: null };
const listeners = new Set<() => void>();

function set(patch: Partial<AiState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
  if ('conversationId' in patch) {
    try {
      if (patch.conversationId) window.localStorage.setItem(KEY, patch.conversationId);
      else window.localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

/** The last conversation (after a reload or in a new tab — while the server still has it). */
export function restoreConversation() {
  if (state.conversationId) return;
  try {
    const id = window.localStorage.getItem(KEY);
    if (id) state = { ...state, conversationId: id };
  } catch {
    /* storage unavailable */
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useAi(): AiState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export const ai = {
  /** Open the panel; with a prompt, put it in the box (and ask it, if `send`). */
  open: (prompt?: { text: string; send?: boolean }) => set({ open: true, ...(prompt ? { prompt: { text: prompt.text, send: !!prompt.send, at: Date.now() } } : {}) }),
  close: () => set({ open: false }),
  toggle: () => set({ open: !state.open }),
  takePrompt: () => {
    const p = state.prompt;
    if (p) state = { ...state, prompt: null };
    return p;
  },
  setConversation: (id: string | null) => set({ conversationId: id }),
  /** A page says what it shows (call with null when it goes away). */
  setPage: (page: AiPageContext | null) => {
    if (JSON.stringify(page) !== JSON.stringify(state.page)) set({ page });
  },
  /** Hand a strategy to the builder (the Strategies tab opens it). */
  toBuilder: (d: EqStrategyDefinition) => set({ toBuilder: d }),
  takeBuilderDraft: () => {
    const d = state.toBuilder;
    if (d) set({ toBuilder: null });
    return d;
  },
};
