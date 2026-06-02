import type { FixtureResult, Report } from "../schema/report.js";
import { MODELS } from "./client.js";
import { executeFixture } from "./execute.js";
import { judgeFixturePanel } from "./judge.js";
import { computeRegressions, scoreFixture, summarize } from "./score.js";
import type { Aggregator, JudgeConfig, RunOptions } from "./types.js";

export type { Aggregator, JudgeConfig, RunOptions } from "./types.js";

const DEFAULT_JUDGES: JudgeConfig[] = [{ model: MODELS.judge }];
const DEFAULT_AGGREGATOR: Aggregator = "mean";
const DEFAULT_REGRESSION_THRESHOLD = 0.05;

export async function run(options: RunOptions): Promise<Report> {
  const startedAt = new Date().toISOString();
  const runId = `run-${Date.now()}`;
  const judges = options.judges ?? DEFAULT_JUDGES;
  const aggregator = options.aggregator ?? DEFAULT_AGGREGATOR;
  const results: FixtureResult[] = [];

  for (const fixture of options.fixtures.fixtures) {
    const { output, error } = await executeFixture(
      options.spec.frontmatter.target,
      fixture.input,
      options.execute,
    );
    if (error) {
      results.push({
        fixtureId: fixture.id,
        output,
        scores: [],
        weightedScore: 0,
        passed: false,
        error,
      });
      continue;
    }
    const scores = await judgeFixturePanel({
      spec: options.spec,
      rubric: options.rubric,
      fixture,
      output,
      judges,
      aggregator,
    });
    const { weightedScore, passed } = scoreFixture(scores, options.rubric);
    results.push({
      fixtureId: fixture.id,
      output,
      scores,
      weightedScore,
      passed,
    });
  }

  const regressions = options.baseline
    ? computeRegressions(
        { results },
        options.baseline,
        options.regressionThreshold ?? DEFAULT_REGRESSION_THRESHOLD,
      )
    : undefined;

  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    specName: options.spec.frontmatter.name,
    specVersion: options.spec.frontmatter.version,
    judges,
    aggregator: typeof aggregator === "function" ? "custom" : aggregator,
    criteria: options.rubric.criteria,
    results,
    summary: summarize(results, regressions),
  };
}
