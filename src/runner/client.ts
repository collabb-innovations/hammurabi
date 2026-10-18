import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | undefined;

export function client(): Anthropic {
  if (!_client) {
    const baseURL = process.env.AI_GATEWAY_URL;
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // Eval gates must survive transient 429/500/503/overloaded responses —
      // a single dropped judge call should not fabricate a CI-failing
      // regression. The SDK retries these with exponential backoff.
      maxRetries: 4,
      ...(baseURL ? { baseURL } : {}),
    });
  }
  return _client;
}

export const MODELS = {
  judge: "claude-haiku-4-5",
} as const;

export { SYS_JUDGE } from "./prompt.js";
