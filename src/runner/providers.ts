import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { client as anthropicClient } from "./client.js";
import { zodOutputFormatV4 as zodOutputFormat } from "./zod-format.js";
import { JudgeResponseSchema } from "./schema.js";
import type { JudgeProvider, ReasoningEffort } from "../schema/spec.js";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

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
  /** Endpoint base URL — `openai_compatible` judges only (spec `base_url`). */
  baseUrl?: string;
  /** Env var holding the endpoint's API key — `openai_compatible` judges only (spec `api_key_env`). */
  apiKeyEnv?: string;
}

export interface JudgeCallResponse {
  scores: { criterionId: string; score: number; reasoning: string }[];
}

const BASE_MAX_TOKENS = 16384;

type OpenAICompatibleCompletionParams = {
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
    case "fireworks":
    case "openai_compatible":
      return callOpenAICompatible(req);
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
  const completion = await deepseek().chat.completions.create(
    buildDeepSeekCompletionParams(
      req,
    ) as unknown as ChatCompletionCreateParamsNonStreaming,
  );

  const raw = completion.choices[0]?.message?.content ?? "";
  return parseJudgeJson(raw, `DeepSeek judge ${req.model}`);
}

export function buildDeepSeekCompletionParams(
  req: JudgeCallRequest,
): OpenAICompatibleCompletionParams {
  // Non-native hosts (DEEPSEEK_BASE_URL remapped to e.g. Fireworks) speak the
  // generic OpenAI-compatible wire shape. Delegating keeps that shape
  // byte-identical with the fireworks/openai_compatible providers by
  // construction — one builder, no drift.
  if (isNonNativeDeepSeekHost()) return buildOpenAICompatibleParams(req);
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

// ---------------------------------------------------------------------------
// Fireworks + generic OpenAI-compatible hosts — one shared parameterized
// client. `fireworks` is first-class (endpoint + key env baked in);
// `openai_compatible` is the escape hatch for any other OpenAI-compatible
// endpoint, configured per judge entry via base_url/api_key_env.
// ---------------------------------------------------------------------------

export const FIREWORKS_DEFAULT_BASE_URL =
  "https://api.fireworks.ai/inference/v1";

// Cached per (baseURL, api-key env var), NOT a single singleton — one panel
// can mix judges pointed at different hosts and keys in the same run.
const _openAICompatibleClients = new Map<string, OpenAI>();

function openAICompatibleClient(baseURL: string, apiKeyEnv: string): OpenAI {
  const cacheKey = `${baseURL}\u0000${apiKeyEnv}`;
  const cached = _openAICompatibleClients.get(cacheKey);
  if (cached) return cached;
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `OpenAI-compatible judge endpoint ${baseURL}: environment variable ` +
        `${apiKeyEnv} is not set — export it with the endpoint's API key`,
    );
  }
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 4 });
  _openAICompatibleClients.set(cacheKey, client);
  return client;
}

/** Where an OpenAI-compatible judge call goes, and which env var keys it. */
export function resolveOpenAICompatibleEndpoint(req: JudgeCallRequest): {
  baseURL: string;
  apiKeyEnv: string;
} {
  if (req.provider === "fireworks") {
    return {
      baseURL: process.env.FIREWORKS_BASE_URL ?? FIREWORKS_DEFAULT_BASE_URL,
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

export async function callOpenAICompatible(
  req: JudgeCallRequest,
): Promise<JudgeCallResponse> {
  const { baseURL, apiKeyEnv } = resolveOpenAICompatibleEndpoint(req);
  const completion = await openAICompatibleClient(
    baseURL,
    apiKeyEnv,
  ).chat.completions.create(
    // The model string flows verbatim from the spec frontmatter to the wire —
    // hosts like Fireworks use full paths (accounts/fireworks/models/...).
    buildOpenAICompatibleParams(
      req,
    ) as unknown as ChatCompletionCreateParamsNonStreaming,
  );

  const raw = completion.choices[0]?.message?.content ?? "";
  const who = req.provider === "fireworks" ? "Fireworks" : "OpenAI-compatible";
  return parseJudgeJson(raw, `${who} judge ${req.model}`);
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

/**
 * Name of the env var a resolved judge still needs, or undefined when it is
 * already set. Mirrors the reads in this file (Anthropic `ANTHROPIC_API_KEY`,
 * OpenAI `OPENAI_API_KEY`, Google `GEMINI_API_KEY ?? GOOGLE_API_KEY`, DeepSeek
 * `DEEPSEEK_API_KEY`, Fireworks `FIREWORKS_API_KEY`, openai_compatible the
 * judge's own `apiKeyEnv`). Empty string counts as unset — same as
 * `openAICompatibleClient`.
 */
export function unsetJudgeApiKeyEnv(judge: {
  provider?: JudgeProvider;
  apiKeyEnv?: string;
}): string | undefined {
  const provider = judge.provider ?? "anthropic";
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ? undefined : "ANTHROPIC_API_KEY";
    case "openai":
      return process.env.OPENAI_API_KEY ? undefined : "OPENAI_API_KEY";
    case "google": {
      // Same operator as gemini(): empty GEMINI_API_KEY must not fall through
      // to GOOGLE_API_KEY, or the probe would pass a panel the client cannot
      // staff.
      const apiKey =
        process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
      if (apiKey) return undefined;
      return process.env.GEMINI_API_KEY !== undefined
        ? "GEMINI_API_KEY"
        : process.env.GOOGLE_API_KEY !== undefined
          ? "GOOGLE_API_KEY"
          : "GEMINI_API_KEY";
    }
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY ? undefined : "DEEPSEEK_API_KEY";
    case "fireworks":
      return process.env.FIREWORKS_API_KEY ? undefined : "FIREWORKS_API_KEY";
    case "openai_compatible":
      if (!judge.apiKeyEnv) return "api_key_env";
      return process.env[judge.apiKeyEnv] ? undefined : judge.apiKeyEnv;
  }
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

export function isNonNativeDeepSeekHost(
  baseURL = process.env.DEEPSEEK_BASE_URL,
): boolean {
  if (!baseURL) return false;
  return baseURL.replace(/\/+$/, "") !== "https://api.deepseek.com";
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
