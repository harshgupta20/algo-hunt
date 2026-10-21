/**
 * Groq's OpenAI-compatible chat API (https://console.groq.com/docs) with tool calling. Server only — the key never
 * reaches the browser. Groq limits tokens per minute (8,000 on the free plan) and requests / tokens per day: before
 * a call that wouldn't fit what's left this minute, and on a 429, this waits (saying so through `onWait`) instead of
 * failing. A daily limit is reported as such. The limits are read from Groq's response headers.
 */
import { childLogger } from '../utils/logger';

const log = childLogger('ai');
const URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
  content: string;
  toolCalls: ChatToolCall[];
  finish: string;
  usage: { prompt: number; completion: number };
}

export interface Limits {
  /** Tokens per minute (null until Groq's first answer). */
  tokensPerMinute: number | null;
  tokensLeft: number | null;
  /** When this minute's tokens are back (ms epoch). */
  tokensResetAt: number | null;
  requestsPerDay: number | null;
  requestsLeft: number | null;
  /** When the day's requests are back to the full allowance (ms epoch; Groq's window slides). */
  requestsResetAt: number | null;
  /** When Groq last told us (ms epoch). */
  checkedAt: number | null;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** "1m26.4s" / "952ms" / "7.66s" → ms. */
export function parseDuration(s: string | null): number | null {
  if (!s) return null;
  let ms = 0;
  let matched = false;
  for (const m of s.matchAll(/([\d.]+)(ms|h|m|s)/g)) {
    matched = true;
    const n = Number(m[1]);
    ms += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
  }
  if (matched) return Math.ceil(ms);
  const n = Number(s);
  return Number.isFinite(n) ? Math.ceil(n * 1000) : null;
}

/** Rough tokens of a text (Groq counts with the model's tokenizer; ~3.2 characters a token here, erring high). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.2);

export class GroqClient {
  /** Groq's prompt tokens ÷ our estimate, from the last answer (our estimate errs high). */
  private calibration = 1;
  readonly limits: Limits = { tokensPerMinute: null, tokensLeft: null, tokensResetAt: null, requestsPerDay: null, requestsLeft: null, requestsResetAt: null, checkedAt: null };

  constructor(
    private readonly key: string,
    readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = Date.now,
  ) {}

  private readHeaders(h: Headers) {
    const num = (k: string) => {
      const v = Number(h.get(k));
      return h.get(k) !== null && Number.isFinite(v) ? v : null;
    };
    const tpm = num('x-ratelimit-limit-tokens');
    if (tpm !== null) this.limits.tokensPerMinute = tpm;
    const left = num('x-ratelimit-remaining-tokens');
    if (left !== null) this.limits.tokensLeft = left;
    const reset = parseDuration(h.get('x-ratelimit-reset-tokens'));
    if (reset !== null) this.limits.tokensResetAt = this.now() + reset;
    const rpd = num('x-ratelimit-limit-requests');
    if (rpd !== null) this.limits.requestsPerDay = rpd;
    const rleft = num('x-ratelimit-remaining-requests');
    if (rleft !== null) this.limits.requestsLeft = rleft;
    const rreset = parseDuration(h.get('x-ratelimit-reset-requests'));
    if (rreset !== null) this.limits.requestsResetAt = this.now() + rreset;
    if (tpm !== null || rpd !== null) this.limits.checkedAt = this.now();
  }

  /** The prompt this account can send in one request: its per-minute tokens minus the answer's room. */
  promptBudget(maxCompletion: number): number {
    const tpm = this.limits.tokensPerMinute ?? 8000;
    return Math.max(2500, Math.min(60_000, Math.floor(tpm * 0.92) - maxCompletion));
  }

  async chat(
    req: { messages: ChatMessage[]; tools?: ToolSpec[]; toolChoice?: 'auto' | 'none'; maxCompletion: number; reasoning?: 'low' | 'medium' | 'high' },
    o: { onWait?: (ms: number, why: string) => void; cancelled?: () => boolean } = {},
  ): Promise<ChatResult> {
    const body = JSON.stringify({
      model: this.model,
      messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools, tool_choice: req.toolChoice ?? 'auto' } : {}),
      max_completion_tokens: req.maxCompletion,
      temperature: 0.2,
      ...(this.model.startsWith('openai/gpt-oss') ? { reasoning_effort: req.reasoning ?? 'medium', include_reasoning: false } : {}),
    });
    // What this request will take from the minute: its prompt (calibrated) and a typical answer — if Groq disagrees it
    // says so with a 429 and how long to wait.
    const estimate = estimateTokens(body);
    const need = Math.round(estimate * this.calibration) + Math.min(req.maxCompletion, 900);
    for (let attempt = 0; attempt < 6; attempt++) {
      if (o.cancelled?.()) throw new AiError('Stopped', 499);
      // Not enough of this minute's tokens left for this request: wait for them (cheaper than a 429).
      const l = this.limits;
      if (l.tokensLeft !== null && l.tokensResetAt !== null && l.tokensLeft < need && l.tokensResetAt > this.now()) {
        const ms = l.tokensResetAt - this.now() + 250;
        o.onWait?.(ms, 'tokens');
        await this.sleep(ms);
        l.tokensLeft = l.tokensPerMinute;
      }
      let res: Response;
      try {
        res = await this.fetcher(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` }, body });
      } catch (err) {
        if (attempt < 2) {
          await this.sleep(1500);
          continue;
        }
        throw new AiError(`Groq couldn’t be reached (${err instanceof Error ? err.message : String(err)}) — check the internet connection`);
      }
      this.readHeaders(res.headers);
      if (res.ok) {
        const j = (await res.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatToolCall[] }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const c = j.choices?.[0];
        if (j.usage?.prompt_tokens && estimate > 0) this.calibration = Math.min(1.2, Math.max(0.3, j.usage.prompt_tokens / estimate));
        return { content: c?.message?.content ?? '', toolCalls: c?.message?.tool_calls ?? [], finish: c?.finish_reason ?? '', usage: { prompt: j.usage?.prompt_tokens ?? 0, completion: j.usage?.completion_tokens ?? 0 } };
      }
      const text = await res.text().catch(() => '');
      let message = text.slice(0, 300);
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        /* not JSON */
      }
      if (res.status === 401) throw new AiError('Groq refused the API key — set a valid GROQ_API_KEY in .env and restart the app', 401);
      if (res.status === 413 || /request too large|reduce your message size/i.test(message)) throw new AiError(`Too large for Groq in one request: ${message}`, 413);
      if (res.status === 429) {
        if (/per day|\(TPD\)|\(RPD\)/i.test(message)) throw new AiError(`Groq’s daily limit is used up for this key — it resets within a day (or use a paid Groq plan). ${message}`, 429);
        const ms = parseDuration(res.headers.get('retry-after')) ?? 5000;
        o.onWait?.(ms, 'rate');
        await this.sleep(Math.min(ms + 250, 70_000));
        continue;
      }
      if (res.status >= 500 && attempt < 3) {
        log.warn({ status: res.status, message }, 'Groq error — retrying');
        await this.sleep(2000 * (attempt + 1));
        continue;
      }
      // A tool call the model wrote badly (Groq checks them): let the caller say so to the model.
      if (res.status === 400 && /tool|function/i.test(message)) throw new AiError(`TOOL_FORMAT: ${message}`, 400);
      throw new AiError(`Groq said: ${message || res.statusText} (${res.status})`, res.status);
    }
    throw new AiError('Groq kept asking to wait — try again in a minute', 429);
  }
}
