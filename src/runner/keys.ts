import type { JudgeProvider } from "../schema/spec.js";

/**
 * Secrets for a worker run. Omitted fields are unset. An empty string is set
 * and blank — for Google, a blank `gemini` does not fall through to `google`.
 */
export interface JudgeKeys {
  anthropic?: string;
  openai?: string;
  gemini?: string;
  google?: string;
  deepseek?: string;
  fireworks?: string;
  /** Keys for `openai_compatible` judges, addressed by `api_key_env`. */
  byEnv?: Readonly<Record<string, string | undefined>>;
}

export interface ResolvedJudgeKey {
  key?: string;
  /** Env var name the Node path would have reported, when the key is missing. */
  unset?: string;
}

export function resolveJudgeKey(
  judge: { provider?: JudgeProvider; apiKeyEnv?: string },
  keys: JudgeKeys,
): ResolvedJudgeKey {
  const provider = judge.provider ?? "anthropic";
  switch (provider) {
    case "anthropic":
      return keys.anthropic
        ? { key: keys.anthropic }
        : { unset: "ANTHROPIC_API_KEY" };
    case "openai":
      return keys.openai ? { key: keys.openai } : { unset: "OPENAI_API_KEY" };
    case "google": {
      // Same operator as the Node client: empty gemini must not fall through
      // to google, or the probe would pass a panel the client cannot staff.
      if (keys.gemini !== undefined) {
        return keys.gemini
          ? { key: keys.gemini }
          : { unset: "GEMINI_API_KEY" };
      }
      if (keys.google !== undefined) {
        return keys.google ? { key: keys.google } : { unset: "GOOGLE_API_KEY" };
      }
      return { unset: "GEMINI_API_KEY" };
    }
    case "deepseek":
      return keys.deepseek
        ? { key: keys.deepseek }
        : { unset: "DEEPSEEK_API_KEY" };
    case "fireworks":
      return keys.fireworks
        ? { key: keys.fireworks }
        : { unset: "FIREWORKS_API_KEY" };
    case "openai_compatible": {
      if (!judge.apiKeyEnv) return { unset: "api_key_env" };
      const value = keys.byEnv?.[judge.apiKeyEnv];
      return value ? { key: value } : { unset: judge.apiKeyEnv };
    }
  }
}

export function unsetJudgeKey(
  judge: { provider?: JudgeProvider; apiKeyEnv?: string },
  keys: JudgeKeys,
): string | undefined {
  return resolveJudgeKey(judge, keys).unset;
}
