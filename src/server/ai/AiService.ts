/**
 * The trading AI assistant: conversations (in memory — never the database), each answer worked out in the
 * background by Groq calling the app's tools (tools.ts) until it can answer. The panel polls the conversation and
 * shows each step as it happens.
 *
 * Groq's free plan allows 8,000 tokens a minute, and every request resends the conversation — so what the model
 * sees is kept inside that budget: older tool results shrink to one line, then older questions drop out (the panel
 * still shows them). Waits for the per-minute limit are shown, not failed.
 */
import { randomUUID } from 'node:crypto';
import type { AiConversation, AiConversationLine, AiMessage, AiMode, AiPageContext, AiStatus, AiStep } from '@/shared/ai/types';
import type { EqStrategyDefinition } from '@/shared/equity';
import type { EquityService } from '../equity';
import { childLogger } from '../utils/logger';
import { AiError, estimateTokens, type ChatMessage, type GroqClient, type ToolSpec } from './groq';
import { contextNote, creatorPrompt, systemPrompt } from './prompt';
import { CREATOR_TOOLS, ToolError, backtestAsked, chatTools, runTool } from './tools';

const log = childLogger('ai');

/** Tool rounds per answer before it must answer with what it has. */
const MAX_ROUNDS = 8;
const MAX_COMPLETION = 2000;
const KEEP_CONVERSATIONS = 30;
const IST_MS = 5.5 * 3600_000;
const istDate = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);
/** The last entry that is an assistant's tool calls (-1 if none). */
const lastToolCalls = (llm: Entry[]) => {
  for (let i = llm.length - 1; i >= 0; i--) {
    const m = llm[i]!.msg;
    if (m.role === 'assistant' && m.tool_calls?.length) return i;
  }
  return -1;
};

interface Entry {
  msg: ChatMessage;
  /** The question this belongs to (whole questions drop out together). */
  turn: number;
  /** A tool result's one-line form. */
  brief?: string;
  condensed?: boolean;
}

interface Conversation {
  view: AiConversation;
  llm: Entry[];
  turn: number;
  drafts: Map<string, EqStrategyDefinition>;
  stop: boolean;
}

export interface AiDeps {
  groq: GroqClient | null;
  equity: EquityService;
  now?: () => number;
}

export class AiService {
  private readonly conversations = new Map<string, Conversation>();
  private readonly now: () => number;
  private usage = { day: '', requests: 0, promptTokens: 0, completionTokens: 0 };
  private probed = false;

  constructor(private readonly deps: AiDeps) {
    this.now = deps.now ?? Date.now;
  }

  private groq(): GroqClient {
    if (!this.deps.groq) throw new AiError('The AI isn’t set up — add GROQ_API_KEY to .env (a key from console.groq.com) and restart the app', 503);
    return this.deps.groq;
  }

  async status(): Promise<AiStatus> {
    const g = this.deps.groq;
    // Groq tells its limits only in answers: ask once (1 request, ~80 tokens) so the header has numbers from the start.
    if (g && !this.probed && g.limits.checkedAt === null) {
      this.probed = true;
      await g.chat({ messages: [{ role: 'user', content: 'ok' }], maxCompletion: 1, reasoning: 'low' }).then(
        (r) => this.count(r.usage),
        (err: unknown) => log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Groq probe failed'),
      );
    }
    const today = istDate(this.now());
    if (this.usage.day !== today) this.usage = { day: today, requests: 0, promptTokens: 0, completionTokens: 0 };
    return {
      configured: !!g,
      model: g?.model ?? '',
      limits: g ? { ...g.limits } : { requestsPerDay: null, requestsLeft: null, requestsResetAt: null, tokensPerMinute: null, tokensLeft: null, tokensResetAt: null, checkedAt: null },
      usage: { ...this.usage },
      busy: [...this.conversations.values()].some((c) => c.view.status === 'RUNNING'),
      ...(g ? {} : { note: 'Add GROQ_API_KEY to .env (a key from console.groq.com) and restart the app.' }),
    };
  }

  private count(u: { prompt: number; completion: number }) {
    const today = istDate(this.now());
    if (this.usage.day !== today) this.usage = { day: today, requests: 0, promptTokens: 0, completionTokens: 0 };
    this.usage.requests++;
    this.usage.promptTokens += u.prompt;
    this.usage.completionTokens += u.completion;
  }

  /** Conversations of one kind (the chat's and the strategy creator's are kept apart), newest first. */
  list(mode: AiMode = 'CHAT'): AiConversationLine[] {
    return [...this.conversations.values()]
      .filter((c) => c.view.mode === mode)
      .map((c) => ({ id: c.view.id, mode: c.view.mode, title: c.view.title, updatedAt: c.view.updatedAt, messages: c.view.messages.length }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): AiConversation {
    const c = this.conversations.get(id);
    if (!c) throw new AiError('This conversation is no longer in memory (the app restarted) — start a new one', 404);
    return structuredClone(c.view);
  }

  remove(id: string): void {
    const c = this.conversations.get(id);
    if (c) c.stop = true;
    this.conversations.delete(id);
  }

  stop(id: string): AiConversation {
    const c = this.conversations.get(id);
    if (!c) throw new AiError('This conversation is no longer in memory', 404);
    c.stop = true;
    return structuredClone(c.view);
  }

  /** A question: answered in the background — poll get(id). */
  send(req: { mode?: AiMode; conversationId?: string; message: string; context?: AiPageContext }): AiConversation {
    this.groq();
    const text = req.message.trim();
    if (!text) throw new AiError('Ask something', 400);
    let c = req.conversationId ? this.conversations.get(req.conversationId) : undefined;
    if (req.conversationId && !c) throw new AiError('This conversation is no longer in memory (the app restarted) — start a new one', 404);
    if (c?.view.status === 'RUNNING') throw new AiError('Still working on the last question — wait or stop it', 409);
    const at = this.now();
    if (!c) {
      c = {
        view: { id: randomUUID(), mode: req.mode ?? 'CHAT', title: text.replace(/\s+/g, ' ').slice(0, 70), status: 'IDLE', activity: null, messages: [], createdAt: at, updatedAt: at, usage: { requests: 0, promptTokens: 0, completionTokens: 0 } },
        llm: [],
        turn: 0,
        drafts: new Map(),
        stop: false,
      };
      this.conversations.set(c.view.id, c);
      for (const old of [...this.conversations.values()].sort((a, b) => a.view.updatedAt - b.view.updatedAt).slice(0, Math.max(0, this.conversations.size - KEEP_CONVERSATIONS))) this.conversations.delete(old.view.id);
    }
    c.turn++;
    c.stop = false;
    c.view.messages.push({ id: randomUUID(), role: 'user', text, at, ...(req.context?.label ? { context: req.context.label } : {}) });
    // The creator is independent of the page: it gets the trader's words only.
    c.llm.push({ msg: { role: 'user', content: `${c.view.mode === 'CHAT' ? contextNote(req.context) : ''}${text}` }, turn: c.turn });
    const answer: AiMessage = { id: randomUUID(), role: 'assistant', text: '', at, steps: [] };
    c.view.messages.push(answer);
    Object.assign(c.view, { status: 'RUNNING', activity: 'Thinking…', updatedAt: at });
    const conv = c;
    void this.answer(conv, answer).catch((err: unknown) => {
      const stopped = err instanceof AiError && err.status === 499;
      answer.text = stopped ? (answer.text || 'Stopped.') : err instanceof AiError || err instanceof Error ? err.message : String(err);
      if (!stopped) answer.failed = true;
      if (!stopped) log.warn({ err: answer.text }, 'AI answer failed');
      // Unanswered tool calls can't stay in what the model sees next time.
      this.dropUnanswered(conv);
      Object.assign(conv.view, { status: 'IDLE', activity: null, updatedAt: this.now() });
    });
    return structuredClone(c.view);
  }

  /** After a stop or failure: every tool call gets a result and the question an answer, so the next request is valid. */
  private dropUnanswered(c: Conversation) {
    const i = lastToolCalls(c.llm);
    if (i >= 0) {
      const answered = new Set(c.llm.slice(i + 1).flatMap((e) => (e.msg.role === 'tool' ? [e.msg.tool_call_id] : [])));
      const calls = c.llm[i]!.msg.role === 'assistant' ? (c.llm[i]!.msg as { tool_calls?: Array<{ id: string }> }).tool_calls ?? [] : [];
      for (const call of calls) if (!answered.has(call.id)) c.llm.push({ msg: { role: 'tool', tool_call_id: call.id, content: '{"error":"stopped"}' }, turn: c.turn, brief: 'stopped', condensed: true });
    }
    const role = c.llm.at(-1)?.msg.role;
    if (role === 'tool' || role === 'user') c.llm.push({ msg: { role: 'assistant', content: '(No answer — it was stopped or failed.)' }, turn: c.turn });
  }

  /** What the model sees: the system prompt, then as much of the conversation as the per-minute budget allows. */
  private window(c: Conversation, system: string, tools: ToolSpec[]): ChatMessage[] {
    const g = this.groq();
    const budget = g.promptBudget(MAX_COMPLETION) - estimateTokens(system) - estimateTokens(JSON.stringify(tools));
    const size = () => c.llm.reduce((a, e) => a + estimateTokens(JSON.stringify(e.msg)) + 4, 0);
    // 1. Older tool results become one line (oldest first; the latest round stays whole).
    const lastCall = lastToolCalls(c.llm);
    for (let i = 0; i < c.llm.length && size() > budget; i++) {
      const e = c.llm[i]!;
      if (e.msg.role === 'tool' && !e.condensed && i < lastCall) {
        e.msg = { ...e.msg, content: `[shortened] ${e.brief ?? ''}` };
        e.condensed = true;
      }
    }
    // 2. Earlier questions drop out whole (the panel still shows them).
    while (size() > budget && c.llm.length && c.llm[0]!.turn < c.turn) {
      const t = c.llm[0]!.turn;
      while (c.llm.length && c.llm[0]!.turn === t) c.llm.shift();
    }
    // 3. Still too big (one long answer): shorten this question's results too, all but the newest.
    for (let i = 0; i < c.llm.length && size() > budget; i++) {
      const e = c.llm[i]!;
      if (e.msg.role === 'tool' && !e.condensed && i < c.llm.length - 1) {
        e.msg = { ...e.msg, content: `[shortened] ${e.brief ?? ''}` };
        e.condensed = true;
      }
    }
    return c.llm.map((e) => e.msg);
  }

  private async answer(c: Conversation, answer: AiMessage): Promise<void> {
    const g = this.groq();
    const today = istDate(this.now());
    const creator = c.view.mode === 'CREATOR';
    // The creator knows the trader's strategies as they are now.
    const system = creator ? creatorPrompt(today, await this.deps.equity.listStrategies().catch(() => [])) : systemPrompt(today);
    // Do only what was asked: the tools that run backtests only when the trader asked for one (or said yes to it).
    const msgs = c.view.messages;
    const question = msgs.at(-2)?.text ?? '';
    const before = msgs.length >= 3 ? msgs.at(-3) : undefined;
    const allowRuns = !creator && backtestAsked(question, before?.role === 'assistant' ? before.text : null);
    const tools = creator ? CREATOR_TOOLS : chatTools(allowRuns);
    const guard = creator || allowRuns ? null : 'This question doesn’t ask for a backtest, so the tools that run one aren’t available. Answer only what was asked; if a backtest would help, end by asking whether they want one.';
    const touch = (activity: string | null) => Object.assign(c.view, { activity, updatedAt: this.now() });
    const cancelled = () => c.stop;
    let formatRetry: string | null = null;
    for (let round = 0; ; round++) {
      if (c.stop) throw new AiError('Stopped', 499);
      const last = round >= MAX_ROUNDS;
      touch(round === 0 ? 'Thinking…' : 'Reading the results…');
      const messages: ChatMessage[] = [{ role: 'system', content: system }, ...this.window(c, system, tools)];
      if (guard) messages.push({ role: 'system', content: guard });
      if (formatRetry) messages.push({ role: 'system', content: `Your last tool call was rejected: ${formatRetry}. Call the tool again with valid JSON arguments.` });
      if (last) messages.push({ role: 'system', content: 'No more tool calls: answer now with what you have, and say what is still unchecked.' });
      let res;
      try {
        res = await g.chat(
          { messages, tools: last ? undefined : tools, maxCompletion: MAX_COMPLETION },
          {
            cancelled,
            onWait: (ms, why) => touch(`Waiting for Groq’s ${why === 'tokens' ? 'per-minute token' : 'rate'} limit — ${Math.ceil(ms / 1000)} s (free plan: 8,000 tokens a minute)`),
          },
        );
      } catch (err) {
        if (err instanceof AiError && err.message.startsWith('TOOL_FORMAT') && !formatRetry) {
          formatRetry = err.message.replace(/^TOOL_FORMAT:\s*/, '').slice(0, 300);
          continue;
        }
        throw err;
      }
      formatRetry = null;
      this.count(res.usage);
      c.view.usage.requests++;
      c.view.usage.promptTokens += res.usage.prompt;
      c.view.usage.completionTokens += res.usage.completion;

      if (res.toolCalls.length && !last) {
        c.llm.push({ msg: { role: 'assistant', content: res.content ?? '', tool_calls: res.toolCalls }, turn: c.turn });
        for (const call of res.toolCalls) {
          const step: AiStep = { id: call.id, tool: call.function.name, title: call.function.name.replace(/_/g, ' '), status: 'running', detail: null, startedAt: this.now(), finishedAt: null };
          answer.steps!.push(step);
          touch(`Working: ${step.title}`);
          let content: string;
          let brief: string;
          try {
            let args: Record<string, unknown> = {};
            try {
              args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
            } catch {
              throw new ToolError(`The arguments aren't valid JSON: ${call.function.arguments.slice(0, 200)}`);
            }
            const out = await runTool(call.function.name, args, {
              equity: this.deps.equity,
              drafts: c.drafts,
              today,
              cancelled,
              progress: (detail) => {
                step.detail = detail;
                touch(detail);
              },
            });
            content = out.content;
            brief = out.brief;
            if (out.title) step.title = out.title;
            Object.assign(step, { status: 'done', detail: out.brief.replace(/^[^:]*:\s*/, '').slice(0, 220), finishedAt: this.now() });
            if (out.proposal) (answer.proposals ??= []).push(out.proposal);
            if (out.backtest) (answer.backtests ??= []).push(out.backtest);
          } catch (err) {
            if (c.stop) throw new AiError('Stopped', 499);
            const message = err instanceof Error ? err.message : String(err);
            content = JSON.stringify({ error: message });
            brief = `${call.function.name} failed: ${message.slice(0, 160)}`;
            Object.assign(step, { status: 'failed', detail: message.slice(0, 300), finishedAt: this.now() });
            if (!(err instanceof ToolError)) log.warn({ tool: call.function.name, err: message }, 'AI tool failed');
          }
          c.llm.push({ msg: { role: 'tool', tool_call_id: call.id, content }, turn: c.turn, brief });
        }
        continue;
      }

      let text = res.content.trim();
      if (!text) text = 'I couldn’t put an answer together — ask again, maybe more specifically.';
      if (res.finish === 'length') text += '\n\n_(The answer was cut short by the length limit — ask for the rest.)_';
      c.llm.push({ msg: { role: 'assistant', content: text }, turn: c.turn });
      answer.text = text;
      Object.assign(c.view, { status: 'IDLE', activity: null, updatedAt: this.now() });
      return;
    }
  }
}
