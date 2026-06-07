import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreFixture,
  computeRegressions,
  summarize,
} from "../src/runner/score.js";
import type { Rubric, Criterion } from "../src/schema/rubric.js";
import type { CriterionScore, FixtureResult } from "../src/schema/report.js";

function criterion(over: Partial<Criterion> & { id: string }): Criterion {
  return {
    name: over.id,
    description: "",
    weight: 1,
    scale: { kind: "pass-fail" },
    ...over,
  };
}

function rubric(criteria: Criterion[], passThreshold = 0.5): Rubric {
  return { specName: "s", specVersion: "1", criteria, passThreshold };
}

function score(criterionId: string, s: number): CriterionScore {
  return { criterionId, score: s, reasoning: "", judgeVotes: [] };
}

test("scoreFixture computes a weighted sum across pass-fail criteria", () => {
  const r = rubric([
    criterion({ id: "a", weight: 0.5 }),
    criterion({ id: "b", weight: 0.5 }),
  ]);
  const { weightedScore, passed } = scoreFixture(
    [score("a", 1), score("b", 0)],
    r,
  );
  assert.equal(weightedScore, 0.5);
  assert.equal(passed, true); // 0.5 >= passThreshold 0.5 (boundary)
});

test("scoreFixture normalizes ordinal scores into [0,1]", () => {
  const r = rubric([
    criterion({ id: "a", weight: 1, scale: { kind: "ordinal", min: 1, max: 5 } }),
  ]);
  const { weightedScore } = scoreFixture([score("a", 4)], r);
  assert.equal(weightedScore, 0.75); // (4-1)/(5-1)
});

test("scoreFixture treats a pass-fail score below 1 as a fail (0)", () => {
  const r = rubric([criterion({ id: "a", weight: 1 })]);
  const { weightedScore, passed } = scoreFixture([score("a", 0.9)], r);
  assert.equal(weightedScore, 0);
  assert.equal(passed, false);
});

test("scoreFixture guards ordinal scales where max === min", () => {
  const r = rubric([
    criterion({ id: "a", weight: 1, scale: { kind: "ordinal", min: 3, max: 3 } }),
  ]);
  const { weightedScore } = scoreFixture([score("a", 3)], r);
  assert.equal(weightedScore, 0);
});

test("scoreFixture clamps ordinal scores outside the declared range", () => {
  const r = rubric([
    criterion({ id: "a", weight: 1, scale: { kind: "ordinal", min: 0, max: 4 } }),
  ]);
  assert.equal(scoreFixture([score("a", 9)], r).weightedScore, 1);
  assert.equal(scoreFixture([score("a", -2)], r).weightedScore, 0);
});

test("scoreFixture ignores scores for unknown criteria", () => {
  const r = rubric([criterion({ id: "a", weight: 1 })]);
  const { weightedScore } = scoreFixture(
    [score("a", 1), score("ghost", 1)],
    r,
  );
  assert.equal(weightedScore, 1);
});

test("computeRegressions flags a drop beyond the threshold", () => {
  const current: FixtureResult[] = [
    { fixtureId: "f1", output: null, scores: [], weightedScore: 0.8, passed: true },
  ];
  const baseline = {
    results: [
      { fixtureId: "f1", output: null, scores: [], weightedScore: 0.9, passed: true },
    ],
  } as Parameters<typeof computeRegressions>[1];
  const regressions = computeRegressions({ results: current }, baseline, 0.05);
  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].fixtureId, "f1");
  assert.ok(Math.abs(regressions[0].delta - -0.1) < 1e-9);
});

test("computeRegressions ignores drops within the threshold and improvements", () => {
  const baseline = {
    results: [
      { fixtureId: "f1", output: null, scores: [], weightedScore: 0.9, passed: true },
      { fixtureId: "f2", output: null, scores: [], weightedScore: 0.5, passed: true },
    ],
  } as Parameters<typeof computeRegressions>[1];
  const current: FixtureResult[] = [
    { fixtureId: "f1", output: null, scores: [], weightedScore: 0.88, passed: true },
    { fixtureId: "f2", output: null, scores: [], weightedScore: 0.95, passed: true },
  ];
  assert.equal(computeRegressions({ results: current }, baseline, 0.05).length, 0);
});

test("computeRegressions skips fixtures absent from the baseline", () => {
  const baseline = { results: [] } as unknown as Parameters<
    typeof computeRegressions
  >[1];
  const current: FixtureResult[] = [
    { fixtureId: "new", output: null, scores: [], weightedScore: 0.1, passed: false },
  ];
  assert.equal(computeRegressions({ results: current }, baseline, 0.05).length, 0);
});

test("summarize counts passed, failed, and errored fixtures", () => {
  const results: FixtureResult[] = [
    { fixtureId: "p", output: null, scores: [], weightedScore: 1, passed: true },
    { fixtureId: "f", output: null, scores: [], weightedScore: 0, passed: false },
    { fixtureId: "e", output: null, scores: [], weightedScore: 0, passed: false, error: "boom" },
  ];
  const summary = summarize(results, undefined);
  assert.equal(summary.totalFixtures, 3);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.errored, 1);
  assert.ok(Math.abs(summary.weightedScore - 1 / 3) < 1e-9);
  assert.equal(summary.regressions, undefined);
});

test("summarize includes regressions when provided", () => {
  const summary = summarize([], [
    { fixtureId: "f1", baselineScore: 0.9, currentScore: 0.5, delta: -0.4 },
  ]);
  assert.equal(summary.regressions?.length, 1);
  assert.equal(summary.weightedScore, 0); // empty results → 0, no divide-by-zero
});
