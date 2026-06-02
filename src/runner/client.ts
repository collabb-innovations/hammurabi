import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | undefined;

export function client(): Anthropic {
  if (!_client) {
    const baseURL = process.env.AI_GATEWAY_URL;
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(baseURL ? { baseURL } : {}),
    });
  }
  return _client;
}

export const MODELS = {
  judge: "claude-haiku-4-5",
} as const;

export const SYS_JUDGE =
  "You are an evaluation judge. Score the output against each criterion in the rubric. Be strict and consistent. For pass-fail criteria, score 1 for pass and 0 for fail. For ordinal criteria, score within the declared min-max range. Always return exactly one entry per criterion in the schema's scores array, keyed by the criterion's id.";
