import type { ReasoningEffort } from "../schema/spec.js";
import { JudgeResponseSchema } from "./schema.js";
import type { JudgeCallRequest, JudgeCallResponse } from "./judge-types.js";

export const FIREWORKS_DEFAULT_BASE_URL =
  "https://api.fireworks.ai/inference/v1";

export const BASE_MAX_TOKENS = 16384;

export type OpenAICompatibleCompletionParams = {
  model: string;
  messages: { role: "system" | "user"; content: string }[];
  reasoning_effort?: "low" | "medium" | "high" | "none";
  temperature?: number;
  response_format?: { type: "json_object"; schema?: typeof JUDGE_JSON_SCHEMA };
};

// Hand-written so OpenAI's strict json_schema mode is satisfied without
// coupling to any SDK's zod-version-specific schema helper.
export const JUDGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          criterionId: { type: "string" },
          score: { type: "number" },
          reasoning: { type: "string" },
        },
        required: ["criterionId", "score", "reasoning"],
      },
    },
  },
  required: ["scores"],
} as const;

export const JSON_INSTRUCTION =
  'Respond with ONLY a JSON object of this exact shape, no markdown fences:\n' +
  '{"scores":[{"criterionId":"<id>","score":<number>,"reasoning":"<text>"}]}\n' +
  "Return exactly one entry per criterion, keyed by the criterion's id.";

export function joinBlocks(blocks: { text: string }[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

/** Normalize reasoning effort into an extended-thinking token budget. */
export function reasoningToTokens(r: ReasoningEffort): number {
  if (typeof r === "number") return Math.max(0, Math.floor(r));
  switch (r) {
    case "none":
      return 0;
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 12000;
  }
}

/** Map reasoning effort to OpenAI's reasoning_effort buckets. */
export function reasoningToOpenAIEffort(
  r: ReasoningEffort,
): "low" | "medium" | "high" | undefined {
  if (typeof r === "number") {
    if (r <= 0) return undefined;
    if (r <= 1500) return "low";
    if (r <= 6000) return "medium";
    return "high";
  }
  return r === "none" ? undefined : r;
}

export function isReasoningModel(model: string): boolean {
  return /^o\d/i.test(model) || /^gpt-5/i.test(model) || /reason/i.test(model);
}

export function hostIsNonNativeDeepSeek(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  return baseURL.replace(/\/+$/, "") !== "https://api.deepseek.com";
}

export function buildDeepSeekParams(
  req: JudgeCallRequest,
  baseURL: string | undefined,
): OpenAICompatibleCompletionParams {
  // Non-native hosts (DEEPSEEK_BASE_URL remapped to e.g. Fireworks) speak the
  // generic OpenAI-compatible wire shape. Delegating keeps that shape
  // byte-identical with the fireworks/openai_compatible providers by
  // construction — one builder, no drift.
  if (hostIsNonNativeDeepSeek(baseURL)) return buildOpenAICompatibleParams(req);
  // Native DeepSeek. Thinking is requested two ways and we honor both: an
  // intrinsically-reasoning model (the deepseek-reasoner alias) OR a configured
  // `reasoning` effort on a hybrid model (e.g. deepseek-v4-pro), mapped to
  // OpenAI-style `reasoning_effort`. In thinking mode DeepSeek rejects
  // `temperature`/`response_format` like OpenAI's reasoning models, so we pin
  // the JSON shape via the prompt (JSON_INSTRUCTION) and parse it back instead.
  // Native DeepSeek stays bare json_object (no schema-constrained decoding).
  const effort = reasoningToOpenAIEffort(req.reasoning);
  const reasoning = effort !== undefined || isReasoningModel(req.model);
  return {
    model: req.model,
    messages: [
      {
        role: "system",
        content: `${joinBlocks(req.systemBlocks)}\n\n${JSON_INSTRUCTION}`,
      },
      { role: "user", content: req.userMessage },
    ],
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(reasoning
      ? {}
      : {
          temperature: 0,
          response_format: { type: "json_object" as const },
        }),
  };
}

/**
 * Completion params for any OpenAI-compatible host that serves
 * thinking-by-default hybrid models (Fireworks, Together, vLLM, …). This is
 * exactly the wire shape the DeepSeek-on-a-non-native-host path sends as of
 * v0.2.2: non-reasoning calls pin `reasoning_effort: "none"` explicitly (#17)
 * and carry the judge JSON schema in `response_format` for schema-constrained
 * decoding (#19); thinking calls omit `temperature`/`response_format` like
 * OpenAI's reasoning models, so the JSON shape is prompt-pinned
 * (JSON_INSTRUCTION) and parsed back instead.
 */
export function buildOpenAICompatibleParams(
  req: JudgeCallRequest,
): OpenAICompatibleCompletionParams {
  const effort = reasoningToOpenAIEffort(req.reasoning);
  const reasoning = effort !== undefined || isReasoningModel(req.model);
  return {
    model: req.model,
    messages: [
      {
        role: "system",
        content: `${joinBlocks(req.systemBlocks)}\n\n${JSON_INSTRUCTION}`,
      },
      { role: "user", content: req.userMessage },
    ],
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(!reasoning ? { reasoning_effort: "none" as const } : {}),
    ...(reasoning
      ? {}
      : {
          temperature: 0,
          response_format: {
            type: "json_object" as const,
            schema: JUDGE_JSON_SCHEMA,
          },
        }),
  };
}

/** Where an OpenAI-compatible judge call goes, and which env var keys it. */
export function resolveCompatibleEndpoint(
  req: JudgeCallRequest,
  fireworksBaseURL: string | undefined,
): { baseURL: string; apiKeyEnv: string } {
  if (req.provider === "fireworks") {
    return {
      baseURL: fireworksBaseURL ?? FIREWORKS_DEFAULT_BASE_URL,
      apiKeyEnv: "FIREWORKS_API_KEY",
    };
  }
  // The spec schema requires both keys for openai_compatible; this guards
  // callers that build a JudgeCallRequest directly.
  if (!req.baseUrl || !req.apiKeyEnv) {
    throw new Error(
      `openai_compatible judge ${req.model} requires both base_url and api_key_env`,
    );
  }
  return { baseURL: req.baseUrl, apiKeyEnv: req.apiKeyEnv };
}

export function parseJudgeJson(raw: string, who: string): JudgeCallResponse {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!cleaned) throw new Error(`${who} returned empty output`);
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`${who} returned non-JSON output: ${(e as Error).message}`);
  }
  const parsed = JudgeResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `${who} output failed schema validation: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  return { scores: parsed.data.scores };
}
