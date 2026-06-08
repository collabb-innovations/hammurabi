import type {
  JudgeProvider,
  ReasoningEffort,
  Spec,
} from "../schema/spec.js";
import type { Rubric } from "../schema/rubric.js";
import type { FixtureSet } from "../schema/fixture.js";
import type { Report } from "../schema/report.js";

export interface JudgeConfig {
  model: string;
  /** Defaults to "anthropic" when unset. */
  provider?: JudgeProvider;
  /** Informational label preserved in the report's audit trail. */
  role?: string;
  /** Reasoning effort for this judge. Defaults to "none". */
  reasoning?: ReasoningEffort;
  /** Relative vote weight within the panel. Defaults to 1. */
  weight?: number;
}

export type Aggregator =
  | "mean"
  | "median"
  | "min"
  | "max"
  | ((scores: number[]) => number);

export interface RunOptions {
  spec: Spec;
  rubric: Rubric;
  fixtures: FixtureSet;
  judges?: JudgeConfig[];
  aggregator?: Aggregator;
  baseline?: Report;
  regressionThreshold?: number;
  execute?: (input: unknown) => Promise<unknown>;
}
