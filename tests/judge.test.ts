import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCriterionScores,
  applyAggregator,
  type PanelJudgeResult,
} from "../src/runner/judge.js";
import type { Criterion } from "../src/schema/rubric.js";

const C: Criterion[] = [
  { id: "a", name: "A", description: "", weight: 0.5, scale: { kind: "pass-fail" } },
  {
    id: "b",
    name: "B",
    description: "",
    weight: 0.5,
    scale: { kind: "ordinal", min: 0, max: 5 },
  },
];

function judge(model: string, a: number, b: number): PanelJudgeResult {
  return {
    model,
    scores: [
      { criterionId: "a", score: a, reasoning: `a=${a}` },
      { criterionId: "b", score: b, reasoning: `b=${b}` },
    ],
  };
}

test("applyAggregator implements mean/median/min/max and custom fns", () => {
  assert.equal(applyAggregator("mean", [1, 0]), 0.5);
  assert.equal(applyAggregator("min", [1, 0, 0.4]), 0);
  assert.equal(applyAggregator("max", [1, 0, 0.4]), 1);
  assert.equal(applyAggregator("median", [3, 1, 2]), 2); // odd
  assert.equal(applyAggregator("median", [1, 2, 3, 4]), 2.5); // even
  assert.equal(applyAggregator((s) => s.length, [9, 9, 9]), 3); // custom
  assert.equal(applyAggregator("mean", []), 0); // empty guard
});

test("aggregateCriterionScores folds a healthy panel with the mean aggregator", () => {
  const { scores, unscoreable } = aggregateCriterionScores(
    C,
    [judge("m1", 1, 4), judge("m2", 0, 2)],
    "mean",
  );
  assert.equal(unscoreable.length, 0);
  assert.equal(scores.find((s) => s.criterionId === "a")?.score, 0.5);
  assert.equal(scores.find((s) => s.criterionId === "b")?.score, 3);
  // every judge's raw vote is preserved for the audit trail
  assert.equal(scores[0].judgeVotes.length, 2);
  assert.deepEqual(
    aggregateCriterionScores(C, [judge("m1", 1, 4), judge("m2", 0, 2)], "mean")
      .excludedJudges,
    [],
  );
});

test("min aggregator takes the worst valid vote", () => {
  const { scores } = aggregateCriterionScores(
    C,
    [judge("m1", 1, 5), judge("m2", 0, 1)],
    "min",
  );
  assert.equal(scores.find((s) => s.criterionId === "a")?.score, 0);
  assert.equal(scores.find((s) => s.criterionId === "b")?.score, 1);
});

test("an errored judge is recorded but excluded from the aggregate", () => {
  const errored: PanelJudgeResult = { model: "down", scores: [], error: "529 overloaded" };
  const { scores, unscoreable } = aggregateCriterionScores(
    C,
    [judge("up", 1, 4), errored],
    "mean",
  );
  assert.equal(unscoreable.length, 0);
  // aggregate is the single healthy vote, NOT dragged toward 0 by the failure
  assert.equal(scores.find((s) => s.criterionId === "a")?.score, 1);
  const votes = scores[0].judgeVotes;
  assert.equal(votes.length, 2);
  const downVote = votes.find((v) => v.model === "down");
  assert.match(downVote?.error ?? "", /529 overloaded/);
  assert.deepEqual(
    aggregateCriterionScores(C, [judge("up", 1, 4), errored], "mean")
      .excludedJudges,
    [{ model: "down", error: "529 overloaded" }],
  );
});

test("an omitted criterion is excluded from its aggregate", () => {
  const partial: PanelJudgeResult = {
    model: "partial",
    scores: [
      { criterionId: "a", score: 1, reasoning: "a=1" },
      { criterionId: "b", score: 0, reasoning: "omitted", omitted: true },
    ],
  };
  const { scores, unscoreable } = aggregateCriterionScores(
    C,
    [judge("full", 1, 4), partial],
    "mean",
  );
  assert.equal(unscoreable.length, 0);
  // b aggregates over the one judge that actually scored it
  assert.equal(scores.find((s) => s.criterionId === "b")?.score, 4);
  const bVotes = scores.find((s) => s.criterionId === "b")?.judgeVotes;
  assert.ok(bVotes?.find((v) => v.model === "partial")?.error);
});

test("a criterion no judge could score lands in unscoreable", () => {
  const e1: PanelJudgeResult = { model: "j1", scores: [], error: "timeout" };
  const e2: PanelJudgeResult = { model: "j2", scores: [], error: "timeout" };
  const { scores, unscoreable } = aggregateCriterionScores(C, [e1, e2], "mean");
  assert.deepEqual(unscoreable.sort(), ["a", "b"]);
  // scores still present (with errored votes) for the audit trail
  assert.equal(scores.length, 2);
  assert.ok(scores[0].judgeVotes.every((v) => v.error));
  assert.deepEqual(
    aggregateCriterionScores(C, [e1, e2], "mean").excludedJudges,
    [
      { model: "j1", error: "timeout" },
      { model: "j2", error: "timeout" },
    ],
  );
});
