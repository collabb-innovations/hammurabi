import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { client as anthropicClient } from "./client.js";
import { zodOutputFormatV4 as zodOutputFormat } from "./zod-format.js";
import { JudgeResponseSchema } from "./schema.js";
import type { JudgeProvider, ReasoningEffort } from "../schema/spec.js";

/**
 * Provider-agnostic judge call. Each fixture's output is scored by one or more
 * judges that may run on different providers — cross-provider panels are the
 * core bias-mitigation device, so a judge must never share the output's
 * provider. This module is the single seam where a provider's SDK is touched.
 */
export interface JudgeCallRequest {
  provider: JudgeProvider;
  model: string;
  /** Reasoning effort for this judge. "none" ⇒ no extended thinking. */
  reasoning: ReasoningEffort;
  /** System context. `cache: true` blocks are cached on providers that support it. */
  systemBlocks: { text: string; cache?: boolean }[];
  userMessage: string;
}

export interface JudgeCallResponse {
  scores: { criterionId: string; score: number; reasoning: string }[];
}

const BASE_MAX_TOKENS = 16384;

// Hand-written so OpenAI's strict json_schema mode is satisfied without
// coupling to any SDK's zod-version-specific schema helper.
const JUDGE_JSON_SCHEMA = {
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

const JSON_INSTRUCTION =
  'Respond with ONLY a JSON object of this exact shape, no markdown fences:\n' +
  '{"scores":[{"criterionId":"<id>","score":<number>,"reasoning":"<text>"}]}\n' +
  "Return exactly one entry per criterion, keyed by the criterion's id.";

export async function callJudge(
  req: JudgeCallRequest,
): Promise<JudgeCallResponse> {
  switch (req.provider) {
    case "anthropic":
      return callAnthropic(req);
    case "openai":
      return callOpenAI(req);
    case "google":
      return callGoogle(req);
    case "deepseek":
      return callDeepSeek(req);
  }
}

// ---------------------------------------------------------------------------
// Anthropic — native structured output (output_config) + extended thinking.
// ---------------------------------------------------------------------------

async function callAnthropic(req: JudgeCallRequest): Promise<JudgeCallResponse> {
  const tokens = reasoningToTokens(req.reasoning);
  const system = req.systemBlocks.map((b) => ({
    type: "text" as const,
    text: b.text,
    ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));

  const response = await anthropicClient().messages.parse({
    model: req.model,
    max_tokens: tokens > 0 ? tokens + BASE_MAX_TOKENS : BASE_MAX_TOKENS,
    // Anthropic requires temperature 1 when extended thinking is enabled;
    // otherwise pin to 0 for reproducibility.
    temperature: tokens > 0 ? 1 : 0,
    ...(tokens > 0
      ? { thinking: { type: "enabled" as const, budget_tokens: tokens } }
      : {}),
    system,
    messages: [{ role: "user", content: req.userMessage }],
    output_config: { format: zodOutputFormat(JudgeResponseSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(`Anthropic judge ${req.model} returned no parseable output`);
  }
  return { scores: response.parsed_output.scores };
}

// ---------------------------------------------------------------------------
// OpenAI — strict json_schema response format; reasoning_effort on o-series.
// ---------------------------------------------------------------------------

let _openai: OpenAI | undefined;
function openai(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 4,
      ...(process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : {}),
    });
  }
  return _openai;
}

async function callOpenAI(req: JudgeCallRequest): Promise<JudgeCallResponse> {
  const effort = isReasoningModel(req.model)
    ? reasoningToOpenAIEffort(req.reasoning)
    : undefined;

  const completion = await openai().chat.completions.create({
    model: req.model,
    messages: [
      { role: "system", content: joinBlocks(req.systemBlocks) },
      { role: "user", content: req.userMessage },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "judge_scores",
        strict: true,
        schema: JUDGE_JSON_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    // Reasoning models reject `temperature`; non-reasoning models reject
    // `reasoning_effort`. Send exactly one.
    ...(effort ? { reasoning_effort: effort } : { temperature: 0 }),
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  return parseJudgeJson(raw, `OpenAI judge ${req.model}`);
}

// ---------------------------------------------------------------------------
// DeepSeek — OpenAI-compatible API. JSON-object response format + prompt-pinned
// shape (no strict json_schema support); validated with zod like Gemini.
// ---------------------------------------------------------------------------

let _deepseek: OpenAI | undefined;
function deepseek(): OpenAI {
  if (!_deepseek) {
    _deepseek = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      maxRetries: 4,
    });
  }
  return _deepseek;
}

async function callDeepSeek(req: JudgeCallRequest): Promise<JudgeCallResponse> {
  // deepseek-reasoner rejects `temperature` and `response_format`; deepseek-chat
  // supports JSON-object mode (which requires "json" to appear in the prompt —
  // JSON_INSTRUCTION satisfies that). Pin the shape via the prompt either way.
  const reasoner = isReasoningModel(req.model);
  const completion = await deepseek().chat.completions.create({
    model: req.model,
    messages: [
      {
        role: "system",
        content: `${joinBlocks(req.systemBlocks)}\n\n${JSON_INSTRUCTION}`,
      },
      { role: "user", content: req.userMessage },
    ],
    ...(reasoner
      ? {}
      : { temperature: 0, response_format: { type: "json_object" } }),
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  return parseJudgeJson(raw, `DeepSeek judge ${req.model}`);
}

// ---------------------------------------------------------------------------
// Google (Gemini) — JSON mime type + prompt-pinned shape, validated with zod.
// ---------------------------------------------------------------------------

let _gemini: GoogleGenAI | undefined;
function gemini(): GoogleGenAI {
  if (!_gemini) {
    _gemini = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    });
  }
  return _gemini;
}

async function callGoogle(req: JudgeCallRequest): Promise<JudgeCallResponse> {
  const tokens = reasoningToTokens(req.reasoning);
  const prompt = `${joinBlocks(req.systemBlocks)}\n\n${JSON_INSTRUCTION}\n\n---\n\n${req.userMessage}`;

  const response = await gemini().models.generateContent({
    model: req.model,
    contents: prompt,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      ...(tokens > 0 ? { thinkingConfig: { thinkingBudget: tokens } } : {}),
    },
  });

  return parseJudgeJson(response.text ?? "", `Google judge ${req.model}`);
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ---------------------------------------------------------------------------

function joinBlocks(blocks: { text: string }[]): string {
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
