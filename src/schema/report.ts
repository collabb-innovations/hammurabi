import type { Criterion } from "./rubric.js";

export interface JudgeVote {
  model: string;
  score: number;
  reasoning: string;
  error?: string;
}

export interface CriterionScore {
  criterionId: string;
  score: number;
  reasoning: string;
  judgeVotes: JudgeVote[];
}

export interface FixtureResult {
  fixtureId: string;
  output: unknown;
  scores: CriterionScore[];
  weightedScore: number;
  passed: boolean;
  error?: string;
}

export interface Report {
  runId: string;
  startedAt: string;
  finishedAt: string;
  specName: string;
  specVersion: string;
  judges: { model: string }[];
  aggregator: string;
  criteria: Criterion[];
  results: FixtureResult[];
  summary: ReportSummary;
}

export interface ReportSummary {
  totalFixtures: number;
  passed: number;
  failed: number;
  errored: number;
  weightedScore: number;
  regressions?: RegressionDelta[];
}

export interface RegressionDelta {
  fixtureId: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
}
