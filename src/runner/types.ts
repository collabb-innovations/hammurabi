import type { Spec } from "../schema/spec.js";
import type { Rubric } from "../schema/rubric.js";
import type { FixtureSet } from "../schema/fixture.js";
import type { Report } from "../schema/report.js";

export interface JudgeConfig {
  model: string;
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
