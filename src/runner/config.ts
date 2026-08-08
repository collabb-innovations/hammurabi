import type {
  AggregatorName,
  JudgePanelMember,
  RiskTier,
  Spec,
} from "../schema/spec.js";
import type { Aggregator, JudgeConfig } from "./types.js";

// Kept as a literal (not imported from client.ts) so this module stays free of
// the Anthropic SDK and is trivially unit-testable.
export const DEFAULT_JUDGE: JudgeConfig = {
  model: "claude-haiku-4-5",
  provider: "anthropic",
  role: "primary",
  reasoning: "none",
};

export const DEFAULT_AGGREGATOR: AggregatorName = "mean";

interface Preset {
  judges: JudgePanelMember[];
  aggregator: AggregatorName;
}

/**
 * Default panels per risk tier. These are STARTING POINTS the spec author
 * reviews and overrides — model ids and provider mix are deliberately
 * conservative. Higher tier ⇒ more judges, more providers (cross-provider bias
 * mitigation), more reasoning, more conservative aggregation.
 *
 * --- Judge-model policy (F-27 / W-14) ----------------------------------
 * A spec whose judges share the generator's provider emits a same-provider
 * leniency-bias warning (see warnSameProviderJudges). BLOCKING bundles (those
 * that gate CI or a deploy) MUST be cross-provider: the panel must include at
 * least one judge whose provider differs from `generatorProvider`. ADVISORY
 * bundles may stay same-provider when the criteria are structural or the
 * output is human-reviewed before action, with the rationale documented in the
 * spec frontmatter. Fireworks (`provider: fireworks`) is the preferred
 * non-Anthropic judge provider for Anthropic-generated output — US-hosted,
 * exfil-mitigated, one OpenAI-compatible surface for the OSS model space.
 *
 * CI constraint: Fireworks judges run session/local today (no LLM judge is
 * wired into CI). A future blocking bundle that resolves to a Fireworks
 * `riskTier` preset must either pin explicit judges that run in CI or
 * provision `FIREWORKS_API_KEY` as a CI secret.
 * ----------------------------------------------------------------------
 */
export const RISK_TIER_PRESETS: Record<RiskTier, Preset> = {
  low: {
    judges: [
      { provider: "anthropic", model: "claude-haiku-4-5", role: "primary", reasoning: "none" },
    ],
    aggregator: "mean",
  },
  medium: {
    judges: [
      { provider: "anthropic", model: "claude-sonnet-4-6", role: "primary", reasoning: "low" },
      // F-27: Fireworks cross-provider secondary — the OSS/exfil-mitigated seat.
      { provider: "fireworks", model: "accounts/fireworks/models/qwen3-235b-a22b", role: "secondary", reasoning: "none" },
    ],
    aggregator: "mean",
  },
  high: {
    judges: [
      { provider: "anthropic", model: "claude-sonnet-4-6", role: "primary", reasoning: "medium" },
      // F-27: replaced Google (closed provider, same exfil profile as Anthropic)
      // with Fireworks so the high-tier panel is genuinely cross-provider.
      { provider: "fireworks", model: "accounts/fireworks/models/qwen3-235b-a22b", role: "secondary", reasoning: "low" },
      { provider: "anthropic", model: "claude-haiku-4-5", role: "tiebreaker", reasoning: "none" },
    ],
    aggregator: "mean",
  },
  critical: {
    judges: [
      { provider: "anthropic", model: "claude-opus-4-8", role: "primary", reasoning: "high" },
      { provider: "openai", model: "gpt-4o", role: "secondary", reasoning: "high" },
      { provider: "google", model: "gemini-2.5-pro", role: "tiebreaker", reasoning: "medium" },
    ],
    aggregator: "min",
  },
};

export function memberToJudgeConfig(m: JudgePanelMember): JudgeConfig {
  return {
    model: m.model,
    provider: m.provider,
    ...(m.role ? { role: m.role } : {}),
    ...(m.reasoning !== undefined ? { reasoning: m.reasoning } : {}),
    ...(m.weight !== undefined ? { weight: m.weight } : {}),
    ...(m.base_url ? { baseUrl: m.base_url } : {}),
    ...(m.api_key_env ? { apiKeyEnv: m.api_key_env } : {}),
  };
}

/**
 * Resolve the judge panel. Precedence (highest first):
 *   explicit override (CLI/RunOptions) > spec eval.judges >
 *   spec eval.riskTier preset > single default judge.
 */
export function resolveJudges(
  spec: Spec,
  override?: JudgeConfig[],
): JudgeConfig[] {
  if (override && override.length > 0) return override;
  const ev = spec.frontmatter.eval;
  if (ev?.judges && ev.judges.length > 0) {
    return ev.judges.map(memberToJudgeConfig);
  }
  if (ev?.riskTier) {
    return RISK_TIER_PRESETS[ev.riskTier].judges.map(memberToJudgeConfig);
  }
  return [{ ...DEFAULT_JUDGE }];
}

/**
 * Resolve the aggregator. Precedence: override > spec eval.aggregator >
 * riskTier preset aggregator > "mean". A custom function override always wins.
 */
export function resolveAggregator(spec: Spec, override?: Aggregator): Aggregator {
  if (override !== undefined) return override;
  const ev = spec.frontmatter.eval;
  if (ev?.aggregator) return ev.aggregator;
  if (ev?.riskTier) return RISK_TIER_PRESETS[ev.riskTier].aggregator;
  return DEFAULT_AGGREGATOR;
}

export function resolveRegressionThreshold(
  spec: Spec,
  override?: number,
): number | undefined {
  if (override !== undefined) return override;
  return spec.frontmatter.eval?.regressionThreshold;
}
