import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { client as anthropicClient } from "./client.js";
import { zodOutputFormatV4 as zodOutputFormat } from "./zod-format.js";
import { JudgeResponseSchema } from "./schema.js";
import type { JudgeProvider } from "../schema/spec.js";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { JudgeCallRequest, JudgeCallResponse } from "./judge-types.js";
import {
  BASE_MAX_TOKENS,
  buildDeepSeekParams,
  buildOpenAICompatibleParams,
  hostIsNonNativeDeepSeek,
  isReasoningModel,
  joinBlocks,
  JSON_INSTRUCTION,
  JUDGE_JSON_SCHEMA,
  parseJudgeJson,
  reasoningToOpenAIEffort,
  reasoningToTokens,
  resolveCompatibleEndpoint,
} from "./judge-pure.js";

export type { JudgeCallRequest, JudgeCallResponse } from "./judge-types.js";
export {
  FIREWORKS_DEFAULT_BASE_URL,
  JUDGE_JSON_SCHEMA,
  buildOpenAICompatibleParams,
  isReasoningModel,
  parseJudgeJson,
  reasoningToOpenAIEffort,
  reasoningToTokens,
} from "./judge-pure.js";

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
): ReturnType<typeof buildDeepSeekParams> {
  return buildDeepSeekParams(req, process.env.DEEPSEEK_BASE_URL);
}

// ---------------------------------------------------------------------------
// Fireworks + generic OpenAI-compatible hosts — one shared parameterized
// client. `fireworks` is first-class (endpoint + key env baked in);
// `openai_compatible` is the escape hatch for any other OpenAI-compatible
// endpoint, configured per judge entry via base_url/api_key_env.
// ---------------------------------------------------------------------------

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
  return resolveCompatibleEndpoint(req, process.env.FIREWORKS_BASE_URL);
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

export function isNonNativeDeepSeekHost(
  baseURL = process.env.DEEPSEEK_BASE_URL,
): boolean {
  return hostIsNonNativeDeepSeek(baseURL);
}
