/**
 * Credit costs for the AI Agent pipeline.
 *
 * Trippleviral charges credits only for the LLM-driven "thinking" stages —
 * KIE / ElevenLabs / Post For Me calls are billed by those external services
 * directly through the user's own API keys (which the user pays for).
 *
 * Base cost reflects raw LLM token usage. The actual user charge applies the
 * shared `CREDIT_MULTIPLIER` (×2.5, ceil) — same markup as KIE-wrap routes.
 *
 * Per 60-90s clip:
 *   base = 5 + 10 + 15 + 5 = 35
 *   charged = ceil(5×2.5) + ceil(10×2.5) + ceil(15×2.5) + ceil(5×2.5) = 13 + 25 + 38 + 13 = 89
 *
 * If LLM stage fails, the credits are refunded automatically by the runner.
 */
import { chargeCredits } from './generationPricing.js';

const STORY_AGENT_BASE_COSTS = {
  idea: 5,
  script: 10,
  storyboard: 15,
  captions: 5,
} as const;

export const STORY_AGENT_CREDIT_COSTS = {
  idea: chargeCredits(STORY_AGENT_BASE_COSTS.idea),
  script: chargeCredits(STORY_AGENT_BASE_COSTS.script),
  storyboard: chargeCredits(STORY_AGENT_BASE_COSTS.storyboard),
  captions: chargeCredits(STORY_AGENT_BASE_COSTS.captions),
} as const;

export type StoryAgentStageWithCost = keyof typeof STORY_AGENT_CREDIT_COSTS;

/**
 * Stable reference type for credit_transactions table.
 * Reference ID format: `<jobId>:<stage>` (e.g. "42:idea").
 * Reference type is shared so credit_transactions can be filtered by feature.
 */
export const STORY_AGENT_CREDIT_REF_TYPE = 'story_agent_llm';

export function storyAgentRefId(jobId: number, stage: StoryAgentStageWithCost): string {
  return `${jobId}:${stage}`;
}
