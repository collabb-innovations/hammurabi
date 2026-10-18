import {
  BASE_MAX_TOKENS,
  buildDeepSeekParams,
  buildOpenAICompatibleParams,
  FIREWORKS_DEFAULT_BASE_URL,
  isReasoningModel,
  joinBlocks,
  JSON_INSTRUCTION,
  JUDGE_JSON_SCHEMA,
  parseJudgeJson,
  reasoningToOpenAIEffort,
  reasoningToTokens,
  resolveCompatibleEndpoint,
} from "./judge-pure.js";
import type { JudgeCallRequest, JudgeCallResponse } from "./judge-types.js";
import { resolveJudgeKey, type JudgeKeys } from "./keys.js";

export interface JudgeEndpoints {
  anthropic?: string;
  openai?: string;
  deepseek?: string;
  fireworks?: string;
  google?: string;
}

export interface FetchJudgeOptions {
  keys: JudgeKeys;
  fetch?: typeof fetch;
  endpoints?: JudgeEndpoints;
}

const ANTHROPIC_ORIGIN = "https://api.anthropic.com";
const OPENAI_ORIGIN = "https://api.openai.com/v1";
const DEEPSEEK_ORIGIN = "https://api.deepseek.com";
const GOOGLE_ORIGIN = "https://generativelanguage.googleapis.com/v1beta";

const RETRY_STATUSES = new Set([429, 500, 502, 503, 529]);

export async function fetchJudge(
  req: JudgeCallRequest,
  options: FetchJudgeOptions,
): Promise<JudgeCallResponse> {
  const doFetch = options.fetch ?? fetch;
  switch (req.provider) {
    case "anthropic":
      return callAnthropic(req, options, doFetch);
    case "openai":
      return callOpenAI(req, options, doFetch);
    case "google":
      return callGoogle(req, options, doFetch);
    case "deepseek":
      return callDeepSeek(req, options, doFetch);
    case "fireworks":
    case "openai_compatible":
      return callOpenAICompatible(req, options, doFetch);
  }
}

async function callAnthropic(
  req: JudgeCallRequest,
  options: FetchJudgeOptions,
  doFetch: typeof fetch,
): Promise<JudgeCallResponse> {
  const key = requireKey(req, options.keys);
  const tokens = reasoningToTokens(req.reasoning);
  const origin = options.endpoints?.anthropic ?? ANTHROPIC_ORIGIN;
  const json = await postJson(
    doFetch,
    joinUrl(origin, "/v1/messages"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: tokens > 0 ? tokens + BASE_MAX_TOKENS : BASE_MAX_TOKENS,
        temperature: tokens > 0 ? 1 : 0,
        ...(tokens > 0
          ? { thinking: { type: "enabled", budget_tokens: tokens } }
          : {}),
        system: req.systemBlocks.map((b) => ({
          type: "text",
          text: b.text,
          ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}),
        })),
        messages: [
          { role: "user", content: `${req.userMessage}\n\n${JSON_INSTRUCTION}` },
        ],
      }),
    },
  );
  const content =
    (json as { content?: { type?: string; text?: string }[] }).content ?? [];
  const text = content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
  return parseJudgeJson(text, `Anthropic judge ${req.model}`);
}

async function callOpenAI(
  req: JudgeCallRequest,
  options: FetchJudgeOptions,
  doFetch: typeof fetch,
): Promise<JudgeCallResponse> {
  const key = requireKey(req, options.keys);
  const effort = isReasoningModel(req.model)
    ? reasoningToOpenAIEffort(req.reasoning)
    : undefined;
  const origin = options.endpoints?.openai ?? OPENAI_ORIGIN;
  const json = await postJson(
    doFetch,
    joinUrl(origin, "/chat/completions"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
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
            schema: JUDGE_JSON_SCHEMA,
          },
        },
        ...(effort ? { reasoning_effort: effort } : { temperature: 0 }),
      }),
    },
  );
  return parseJudgeJson(messageContent(json), `OpenAI judge ${req.model}`);
}

async function callGoogle(
  req: JudgeCallRequest,
  options: FetchJudgeOptions,
  doFetch: typeof fetch,
): Promise<JudgeCallResponse> {
  const key = requireKey(req, options.keys);
  const tokens = reasoningToTokens(req.reasoning);
  const origin = options.endpoints?.google ?? GOOGLE_ORIGIN;
  const prompt = `${joinBlocks(req.systemBlocks)}\n\n${JSON_INSTRUCTION}\n\n---\n\n${req.userMessage}`;
  const json = await postJson(
    doFetch,
    joinUrl(origin, `/models/${encodeURIComponent(req.model)}:generateContent`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          ...(tokens > 0 ? { thinkingConfig: { thinkingBudget: tokens } } : {}),
        },
      }),
    },
  );
  const parts =
    (
      json as {
        candidates?: {
          content?: { parts?: { text?: string; thought?: boolean }[] };
        }[];
      }
    ).candidates?.[0]?.content?.parts ?? [];
  // The Node SDK's response.text skips thought parts. Joining them prepends
  // reasoning to the JSON and the judge fails schema parsing.
  const text = parts
    .filter((part) => part.thought !== true)
    .map((part) => part.text ?? "")
    .join("");
  return parseJudgeJson(text, `Google judge ${req.model}`);
}

async function callDeepSeek(
  req: JudgeCallRequest,
  options: FetchJudgeOptions,
  doFetch: typeof fetch,
): Promise<JudgeCallResponse> {
  const key = requireKey(req, options.keys);
  const origin = options.endpoints?.deepseek ?? DEEPSEEK_ORIGIN;
  const json = await postJson(
    doFetch,
    joinUrl(origin, "/chat/completions"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(buildDeepSeekParams(req, origin)),
    },
  );
  return parseJudgeJson(messageContent(json), `DeepSeek judge ${req.model}`);
}

async function callOpenAICompatible(
  req: JudgeCallRequest,
  options: FetchJudgeOptions,
  doFetch: typeof fetch,
): Promise<JudgeCallResponse> {
  const fireworksBase =
    req.provider === "fireworks"
      ? (options.endpoints?.fireworks ?? FIREWORKS_DEFAULT_BASE_URL)
      : undefined;
  const { baseURL, apiKeyEnv } = resolveCompatibleEndpoint(req, fireworksBase);
  const key = resolveJudgeKey(
    { provider: req.provider, apiKeyEnv },
    options.keys,
  ).key;
  if (!key) {
    throw new Error(
      `OpenAI-compatible judge endpoint ${baseURL}: environment variable ` +
        `${apiKeyEnv} is not set — export it with the endpoint's API key`,
    );
  }
  const json = await postJson(
    doFetch,
    joinUrl(baseURL, "/chat/completions"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(buildOpenAICompatibleParams(req)),
    },
  );
  const who = req.provider === "fireworks" ? "Fireworks" : "OpenAI-compatible";
  return parseJudgeJson(messageContent(json), `${who} judge ${req.model}`);
}

function requireKey(req: JudgeCallRequest, keys: JudgeKeys): string {
  const resolved = resolveJudgeKey(req, keys);
  if (!resolved.key) {
    throw new Error(
      `judge ${req.model}: environment variable ${resolved.unset} is not set — refusing to run a panel that cannot be staffed`,
    );
  }
  return resolved.key;
}

function messageContent(json: unknown): string {
  const choice = (json as { choices?: { message?: { content?: string } }[] })
    .choices?.[0];
  return choice?.message?.content ?? "";
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function postJson(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let last = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await doFetch(url, init);
    if (response.ok) return response.json();
    last = await response.text();
    if (!RETRY_STATUSES.has(response.status) || attempt === 4) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText}: ${last}`.trim(),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw new Error(last);
}
