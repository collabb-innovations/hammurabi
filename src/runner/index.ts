import type { CriterionScore, FixtureResult, Report } from "../schema/report.js";
import {
  resolveAggregator,
  resolveJudges,
  resolveRegressionThreshold,
} from "./config.js";
import { executeFixture } from "./execute.js";
import { scoreCodeCriterion } from "./deterministic.js";
import { judgeFixturePanel } from "./judge.js";
import { computeRegressions, scoreFixture, summarize } from "./score.js";
import type { JudgeConfig, RunOptions } from "./types.js";
import type { Spec } from "../schema/spec.js";

export type { Aggregator, JudgeConfig, RunOptions } from "./types.js";
export {
  RISK_TIER_PRESETS,
  resolveJudges,
  resolveAggregator,
  resolveRegressionThreshold,
} from "./config.js";

const DEFAULT_REGRESSION_THRESHOLD = 0.05;

export async function run(options: RunOptions): Promise<Report> {
  const startedAt = new Date().toISOString();
  const runId = `run-${Date.now()}`;
  // Panel/aggregator/threshold resolve from the spec's eval block unless the
  // caller overrides them. Precedence lives in ./config.ts.
  const judges = resolveJudges(options.spec, options.judges);
  const aggregator = resolveAggregator(options.spec, options.aggregator);
  warnSameProviderJudges(options.spec, judges);
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
        ...(fixture.tags ? { tags: fixture.tags } : {}),
        scores: [],
        weightedScore: 0,
        passed: false,
        error,
      });
      continue;
    }
    // Code-scored criteria run deterministically; LLM criteria go to the
    // panel. A misconfigured code evaluator errors the whole fixture.
    const codeCriteria = options.rubric.criteria.filter(
      (c) => c.evaluator?.kind === "code",
    );
    const llmCriteria = options.rubric.criteria.filter(
      (c) => (c.evaluator?.kind ?? "llm") === "llm",
    );

    let codeScores: CriterionScore[];
    try {
      codeScores = await Promise.all(
        codeCriteria.map((c) => scoreCodeCriterion(c, fixture, output)),
      );
    } catch (e) {
      results.push({
        fixtureId: fixture.id,
        output,
        ...(fixture.tags ? { tags: fixture.tags } : {}),
        scores: [],
        weightedScore: 0,
        passed: false,
        error: `code evaluator failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    let llmScores: CriterionScore[] = [];
    let unscoreable: string[] = [];
    if (llmCriteria.length > 0) {
      const judged = await judgeFixturePanel({
        spec: options.spec,
        criteria: llmCriteria,
        passThreshold: options.rubric.passThreshold,
        fixture,
        output,
        judges,
        aggregator,
      });
      llmScores = judged.scores;
      unscoreable = judged.unscoreable;
    }
    if (unscoreable.length > 0) {
      // Every judge errored or omitted these criteria — we genuinely could not
      // evaluate the fixture. Report it errored (⚠), never a quality failure
      // (✗), but still non-zero in CI so it cannot pass silently.
      results.push({
        fixtureId: fixture.id,
        output,
        ...(fixture.tags ? { tags: fixture.tags } : {}),
        scores: [...codeScores, ...llmScores],
        weightedScore: 0,
        passed: false,
        error: `could not score criteria [${unscoreable.join(", ")}]: every judge errored or omitted them`,
      });
      continue;
    }

    // Reassemble in the rubric's declared criterion order.
    const byId = new Map(
      [...codeScores, ...llmScores].map((s) => [s.criterionId, s]),
    );
    const scores = options.rubric.criteria
      .map((c) => byId.get(c.id))
      .filter((s): s is CriterionScore => s !== undefined);

    const { weightedScore, passed } = scoreFixture(scores, options.rubric);
    results.push({
      fixtureId: fixture.id,
      output,
      ...(fixture.tags ? { tags: fixture.tags } : {}),
      scores,
      weightedScore,
      passed,
    });
  }

  const regressions = options.baseline
    ? computeRegressions(
        { results },
        options.baseline,
        resolveRegressionThreshold(options.spec, options.regressionThreshold) ??
          DEFAULT_REGRESSION_THRESHOLD,
      )
    : undefined;

  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    specName: options.spec.frontmatter.name,
    specVersion: options.spec.frontmatter.version,
    judges: judges.map((j) => ({
      model: j.model,
      ...(j.provider ? { provider: j.provider } : {}),
      ...(j.role ? { role: j.role } : {}),
    })),
    aggregator: typeof aggregator === "function" ? "custom" : aggregator,
    criteria: options.rubric.criteria,
    results,
    summary: summarize(results, regressions),
  };
}

/**
 * Same-provider judging produces leniency bias — a model rates output that
 * "sounds like" its own generation more favorably. If the spec declares the
 * generator's provider, warn when any judge shares it.
 */
function warnSameProviderJudges(spec: Spec, judges: JudgeConfig[]): void {
  const generator = spec.frontmatter.eval?.generatorProvider;
  if (!generator) return;
  const shared = judges.filter((j) => (j.provider ?? "anthropic") === generator);
  if (shared.length > 0) {
    console.warn(
      `[hammurabi] ${shared.length} judge(s) share the generator's provider ` +
        `'${generator}' (${shared.map((j) => j.model).join(", ")}) — same-provider ` +
        `leniency bias. Prefer a cross-provider panel.`,
    );
  }
}
