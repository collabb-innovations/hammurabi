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
    ],
    aggregator: "mean",
  },
  high: {
    judges: [
      { provider: "anthropic", model: "claude-sonnet-4-6", role: "primary", reasoning: "medium" },
      { provider: "google", model: "gemini-2.5-flash", role: "secondary", reasoning: "low" },
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
