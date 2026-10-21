/**
 * "Describe in words" inside the builder's Buy when / Sell when: one short exchange with the model that returns the
 * section's complete rules after the trader's words (current rules kept unless replaced), checked by the builder's
 * own validator — or one question when the words are too vague. Nothing changes until the trader applies it.
 */
import type { AiFillResult } from '@/shared/ai/types';
import type { EqStrategyDefinition } from '@/shared/equity';
import { normalizeDefinition, strategySummary, validateDefinition } from '@/shared/equity';
import { CompactError, fromDefinition, toDefinition } from './compact';
import { AiError, type ChatMessage, type GroqClient, type ToolSpec } from './groq';
import { fillPrompt } from './prompt';

const NODE = { description: 'COND [left, op, right] or GROUP {"all":[…]} / {"any":[…]}' };
const ASSUMPTIONS = { type: 'array', items: { type: 'string' }, description: 'every default or interpretation you chose, in plain words' };

const TOOL: Record<'entry' | 'exit', ToolSpec> = {
  entry: {
    type: 'function',
    function: {
      name: 'fill_entry',
      description: 'The complete buy conditions after the trader’s words.',
      parameters: { type: 'object', properties: { entry: NODE, trigger: { type: 'string', enum: ['when_true', 'becomes_true'] }, assumptions: ASSUMPTIONS }, required: ['entry'] },
    },
  },
  exit: {
    type: 'function',
    function: {
      name: 'fill_exit',
      description: 'The complete sell rules after the trader’s words (null = off).',
      parameters: {
        type: 'object',
        properties: {
          target: { type: ['number', 'null'] },
          stop: { type: ['number', 'null'] },
          trail: { type: ['number', 'null'] },
          base: { type: 'string', enum: ['average', 'first_buy'] },
          max_bars: { type: ['integer', 'null'] },
          when: { ...NODE, type: ['array', 'object', 'null'] },
          assumptions: ASSUMPTIONS,
        },
      },
    },
  },
};

/** The trader's strategy as the model sees it (unnamed drafts get a placeholder name). */
function current(d: EqStrategyDefinition): string {
  const c = fromDefinition({ ...d, name: d.name.trim() || 'Draft' });
  return JSON.stringify({ timeframe: c.timeframe, entry: c.entry, trigger: c.trigger ?? 'when_true', exit: c.exit, pyramid: c.pyramid });
}

/** The model's part, merged into the trader's strategy and checked; errors go back to the model. */
function merge(part: 'entry' | 'exit', args: Record<string, unknown>, d: EqStrategyDefinition): EqStrategyDefinition {
  const base = { name: 'x', timeframe: d.timeframe };
  try {
    if (part === 'entry') {
      const t = normalizeDefinition(toDefinition({ ...base, entry: args.entry, trigger: args.trigger }));
      return { ...d, entry: t.entry };
    }
    const t = normalizeDefinition(toDefinition({ ...base, entry: ['close', '>', 0], exit: { target: args.target, stop: args.stop, trail: args.trail, base: args.base, max_bars: args.max_bars, when: args.when ?? null } }));
    return { ...d, exit: t.exit };
  } catch (err) {
    if (err instanceof CompactError) throw new FillError(err.message);
    throw err;
  }
}

class FillError extends Error {}

export async function fillPart(
  groq: GroqClient,
  req: { part: 'entry' | 'exit'; text: string; strategy: EqStrategyDefinition; today: string },
  onUsage: (u: { prompt: number; completion: number }) => void,
): Promise<AiFillResult> {
  const { part, strategy } = req;
  const messages: ChatMessage[] = [
    { role: 'system', content: fillPrompt(part, req.today) },
    { role: 'user', content: `Current strategy: ${current(strategy)}\n\nThe trader says about the ${part === 'entry' ? 'BUY conditions' : 'SELL rules'}: ${req.text.trim()}` },
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await groq.chat({ messages, tools: [TOOL[part]], maxCompletion: 1500 });
    onUsage(res.usage);
    const call = res.toolCalls[0];
    if (!call) {
      const question = res.content.trim();
      if (question) return { part, question };
      throw new AiError('The AI gave no answer — try saying it another way', 502);
    }
    messages.push({ role: 'assistant', content: res.content ?? '', tool_calls: [call] });
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'The arguments aren’t valid JSON' }) });
      continue;
    }
    try {
      const merged = merge(part, args, strategy);
      // Only this section's problems count (the rest is the trader's work in progress).
      const issues = validateDefinition({ ...merged, name: merged.name.trim() || 'Draft' }).filter((i) => i.path.startsWith(part));
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) throw new FillError(`Not valid: ${errors.map((e) => e.message).join('; ')}`);
      const assumptions = Array.isArray(args.assumptions) ? args.assumptions.map((a) => String(a).trim()).filter(Boolean).slice(0, 8) : [];
      const lines = strategySummary({ ...merged, name: merged.name || 'Draft' });
      return {
        part,
        ...(part === 'entry' ? { entry: merged.entry } : { exit: merged.exit }),
        reads: part === 'entry' ? [lines[0]!] : [lines[1]!],
        assumptions,
        warnings: issues.filter((i) => i.severity === 'warning').map((i) => i.message),
      };
    } catch (err) {
      if (!(err instanceof FillError)) throw err;
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: err.message }) });
    }
  }
  throw new AiError('The AI couldn’t turn that into valid rules — try saying it more simply (e.g. “close crosses above SMA 20 and RSI(14) above 60”)', 422);
}
