export interface SpecFrontmatter {
  name: string;
  version: string;
  description: string;
  target: SpecTarget;
  /**
   * How rigorously to judge this spec — the size and reasoning of the judge
   * panel. Travels with the spec so the eval's rigor is version-controlled and
   * reviewable, not an ephemeral CLI flag. Omitted ⇒ a single default judge.
   */
  eval?: EvalConfig;
}

export type SpecTarget =
  | { kind: "cli"; command: string }
  | { kind: "function"; module: string; export: string }
  | { kind: "http"; url: string; method?: string }
  | { kind: "free-form"; description: string };

export type JudgeProvider = "anthropic" | "google" | "openai" | "deepseek";

export type AggregatorName = "mean" | "median" | "min" | "max";

/**
 * Risk tier shorthand. Expands to a default cross-provider panel + aggregator
 * (see RISK_TIER_PRESETS) unless `judges` is given explicitly. Mirrors hook.'s
 * soak risk-tier rubric: higher tier ⇒ more judges, more providers, more
 * reasoning, more conservative aggregation.
 */
export type RiskTier = "low" | "medium" | "high" | "critical";

/**
 * Per-judge reasoning effort. A named tier or an explicit thinking-token
 * budget. Mapped per provider by the runner (Anthropic extended thinking,
 * OpenAI reasoning effort, Gemini thinking budget).
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | number;

export interface JudgePanelMember {
  provider: JudgeProvider;
  model: string;
  /** Informational label for the audit trail (e.g. primary/secondary/tiebreaker). */
  role?: string;
  /** Reasoning effort for this judge. Defaults to "none". */
  reasoning?: ReasoningEffort;
  /** Relative vote weight within the panel. Defaults to 1. */
  weight?: number;
}

export interface EvalConfig {
  /** Shorthand that expands to a default panel + aggregator. */
  riskTier?: RiskTier;
  /** Explicit panel. Overrides the riskTier preset's judges when present. */
  judges?: JudgePanelMember[];
  /** How panel votes combine. Risk-sensitive specs should prefer "min". */
  aggregator?: AggregatorName;
  /** Per-fixture weighted-score delta below baseline that flags a regression. */
  regressionThreshold?: number;
  /**
   * The provider that PRODUCES the output under test. Advisory only — used to
   * warn when a judge shares the generator's provider (same-provider leniency
   * bias). Does not change scoring.
   */
  generatorProvider?: JudgeProvider;
}

export interface Spec {
  frontmatter: SpecFrontmatter;
  body: string;
}
