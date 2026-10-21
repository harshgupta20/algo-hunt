/**
 * The trading AI assistant (Groq) — reads and tests through the Equity service, never trades or saves. Wired in
 * server/api/context.ts; the key (GROQ_API_KEY) stays on the server.
 */
import { getConfig } from '../config/index';
import type { EquityService } from '../equity';
import { AiService } from './AiService';
import { GroqClient } from './groq';

export { AiService } from './AiService';
export { AiError } from './groq';

export interface AiModule {
  service: AiService;
}

export function createAiModule(deps: { equity: EquityService }): AiModule {
  const { groq } = getConfig();
  return { service: new AiService({ groq: groq.apiKey ? new GroqClient(groq.apiKey, groq.model) : null, equity: deps.equity }) };
}
