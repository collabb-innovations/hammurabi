import type { JudgeProvider, ReasoningEffort } from "../schema/spec.js";

/**
 * Provider-agnostic judge call. Each fixture's output is scored by one or more
 * judges that may run on different providers — cross-provider panels are the
 * core bias-mitigation device, so a judge must never share the output's
 * provider.
 */
export interface JudgeCallRequest {
  provider: JudgeProvider;
  model: string;
  /** Reasoning effort for this judge. "none" ⇒ no extended thinking. */
  reasoning: ReasoningEffort;
  /** System context. `cache: true` blocks are cached on providers that support it. */
  systemBlocks: { text: string; cache?: boolean }[];
  userMessage: string;
  /** Endpoint base URL — `openai_compatible` judges only (spec `base_url`). */
  baseUrl?: string;
  /** Env var holding the endpoint's API key — `openai_compatible` judges only (spec `api_key_env`). */
  apiKeyEnv?: string;
}

export interface JudgeCallResponse {
  scores: { criterionId: string; score: number; reasoning: string }[];
}
