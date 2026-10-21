/**
 * The trading AI assistant (Groq) — what the panel shows. Conversations live in the server's memory (never the
 * database); the AI works through the app's own tools (backtests, strategies, stock lists), so every number it
 * gives comes from them. It proposes strategies; the trader opens them in the builder and saves them.
 */
import type { EqStrategyDefinition, ValidationIssue } from '../equity';

/** Where the trader is when asking — so "this backtest" / "my strategy" mean something to the AI. */
export interface AiPageContext {
  page: 'equity-strategies' | 'equity-builder' | 'equity-backtest' | 'equity-screener' | 'equity-watchlists' | 'other';
  /** In words, for the panel ("Backtest: d on NIFTY 50, 2021 → 2026"). */
  label?: string;
  /** The builder's strategy as it is on screen (maybe unsaved). */
  draft?: EqStrategyDefinition;
  /** The saved strategy being edited or chosen. */
  strategyId?: string;
  /** The backtest on screen (its history entry). */
  backtestId?: string;
}

/** One thing the AI did for an answer (a tool call), shown as it happens. */
export interface AiStep {
  id: string;
  tool: string;
  /** "Backtest: SMA 20 on NIFTY 50, 2021 → 2026". */
  title: string;
  status: 'running' | 'done' | 'failed';
  /** Progress while running ("fetching 23 / 50"), the outcome when done ("CAGR 14.2 %, 61 trades"), or the error. */
  detail: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/** A strategy the AI wrote — the trader opens it in the builder (nothing is saved by the AI). */
export interface AiProposal {
  draftId: string;
  definition: EqStrategyDefinition;
  /** The builder's plain-language lines. */
  summary: string[];
  warnings: ValidationIssue[];
  /** Defaults and interpretations the AI chose (shown so the trader can correct them). */
  assumptions?: string[];
}

/** CHAT: the AI panel (ask anything). CREATOR: "Create with AI" on the Strategies page — builds strategies only. */
export type AiMode = 'CHAT' | 'CREATOR';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  /** Markdown (the assistant's answer) or the trader's words. */
  text: string;
  at: number;
  /** The page it was asked from (a user message). */
  context?: string;
  steps?: AiStep[];
  proposals?: AiProposal[];
  /** Backtests it ran, kept in the history — open them on the Backtest tab. */
  backtests?: Array<{ historyId: string; label: string }>;
  /** The answer failed (the error is the text). */
  failed?: boolean;
}

export interface AiConversation {
  id: string;
  mode: AiMode;
  title: string;
  status: 'IDLE' | 'RUNNING';
  /** What it's doing right now ("Waiting for Groq’s per-minute limit — 24 s"). */
  activity: string | null;
  messages: AiMessage[];
  createdAt: number;
  updatedAt: number;
  usage: { requests: number; promptTokens: number; completionTokens: number };
}

export interface AiConversationLine {
  id: string;
  mode: AiMode;
  title: string;
  updatedAt: number;
  messages: number;
}

/** Groq's allowance for this key, from its last answer's headers (null before the first). */
export interface AiLimits {
  requestsPerDay: number | null;
  requestsLeft: number | null;
  /** When the day's requests are all back (ms epoch — Groq's window slides, so it's sooner for some). */
  requestsResetAt: number | null;
  tokensPerMinute: number | null;
  tokensLeft: number | null;
  tokensResetAt: number | null;
  /** When Groq last told us (ms epoch). */
  checkedAt: number | null;
}

export interface AiStatus {
  configured: boolean;
  model: string;
  limits: AiLimits;
  /** What this app used today (IST date), since it started. */
  usage: { day: string; requests: number; promptTokens: number; completionTokens: number };
  /** An answer is being worked on. */
  busy: boolean;
  /** Why it isn't available. */
  note?: string;
}

export interface AiSendRequest {
  /** For a new conversation (default CHAT). */
  mode?: AiMode;
  conversationId?: string;
  message: string;
  context?: AiPageContext;
}

/** "Describe in words" in the builder: the section's complete rules after the trader's words, or one question. */
export interface AiFillRequest {
  part: 'entry' | 'exit';
  text: string;
  /** The strategy as it is in the builder (maybe unsaved). */
  strategy: EqStrategyDefinition;
}

export interface AiFillResult {
  part: 'entry' | 'exit';
  entry?: EqStrategyDefinition['entry'];
  exit?: EqStrategyDefinition['exit'];
  /** The section in the builder's plain words. */
  reads?: string[];
  assumptions?: string[];
  warnings?: string[];
  /** The words were too vague — what the AI needs to know. */
  question?: string;
}
