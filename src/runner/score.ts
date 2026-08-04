import type { Criterion, Rubric } from "../schema/rubric.js";
import type {
  CriterionScore,
  FixtureResult,
  RegressionDelta,
  Report,
  ReportSummary,
} from "../schema/report.js";

/**
 * Fold a fixture's criterion scores into one weighted score.
 *
 * The score is renormalised over the weight actually in play — the criteria
 * that were scored — rather than assumed to be out of 1.0. For a conformant
 * rubric where every criterion applies, the weights sum to 1 and this is
 * exactly the previous arithmetic. It matters when a criterion sat out via
 * `appliesTo`: a fixture where 3 of 6 criteria apply must be scored out of
 * those 3, not divided by weight that was never in play. Without this, an
 * inapplicable criterion is indistinguishable from one that scored 0.
 */
export function scoreFixture(
  scores: CriterionScore[],
  rubric: Rubric,
): { weightedScore: number; passed: boolean } {
  const byId = new Map(rubric.criteria.map((c) => [c.id, c]));
  let totalWeight = 0;
  let weightedSum = 0;
  for (const s of scores) {
    const criterion = byId.get(s.criterionId);
    if (!criterion) continue;
    weightedSum += normalizeScore(s.score, criterion) * criterion.weight;
    totalWeight += criterion.weight;
  }
  // Nothing applied: there is no evidence either way, so no score to report.
  // The caller decides whether that is an authoring error (it usually is).
  if (totalWeight === 0) {
    return { weightedScore: 0, passed: false };
  }
  const weightedScore = weightedSum / totalWeight;
  return {
    weightedScore,
    passed: weightedScore >= rubric.passThreshold,
  };
}

function normalizeScore(raw: number, criterion: Criterion): number {
  switch (criterion.scale.kind) {
    case "pass-fail":
      return raw >= 1 ? 1 : 0;
    case "ordinal": {
      const { min, max } = criterion.scale;
      if (max === min) return 0;
      return Math.max(0, Math.min(1, (raw - min) / (max - min)));
    }
  }
}

export function computeRegressions(
  current: { results: FixtureResult[] },
  baseline: Report,
  threshold: number,
): RegressionDelta[] {
  const baselineMap = new Map(
    baseline.results.map((r) => [r.fixtureId, r] as const),
  );
  const regressions: RegressionDelta[] = [];
  for (const r of current.results) {
    const b = baselineMap.get(r.fixtureId);
    if (!b) continue;
    const delta = r.weightedScore - b.weightedScore;
    if (delta < -threshold) {
      regressions.push({
        fixtureId: r.fixtureId,
        baselineScore: b.weightedScore,
        currentScore: r.weightedScore,
        delta,
      });
    }
  }
  return regressions;
}

export function summarize(
  results: FixtureResult[],
  regressions: RegressionDelta[] | undefined,
): ReportSummary {
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let totalScore = 0;
  for (const r of results) {
    if (r.error) errored++;
    else if (r.passed) passed++;
    else failed++;
    totalScore += r.weightedScore;
  }
  return {
    totalFixtures: results.length,
    passed,
    failed,
    errored,
    weightedScore: results.length > 0 ? totalScore / results.length : 0,
    ...(regressions !== undefined ? { regressions } : {}),
  };
}
