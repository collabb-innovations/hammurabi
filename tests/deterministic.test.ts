import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCodeCriterion } from "../src/runner/deterministic.js";
import type { Criterion } from "../src/schema/rubric.js";
import type { Fixture } from "../src/schema/fixture.js";

const targetUrl = new URL("./_exec-target.ts", import.meta.url).href;

function codeCriterion(exportName: string): Criterion {
  return {
    id: "recall",
    name: "Recall",
    description: "",
    weight: 1,
    scale: { kind: "ordinal", min: 0, max: 1 },
    evaluator: { kind: "code", module: targetUrl, export: exportName },
  };
}

const fixture: Fixture = {
  id: "f1",
  input: { n: 3 },
  expected: { want: 9 },
};

test("scoreCodeCriterion accepts a bare number return", async () => {
  // `scoreHalf` returns 0.5 (see _exec-target.ts)
  const result = await scoreCodeCriterion(codeCriterion("scoreHalf"), fixture, {
    n: 3,
  });
  assert.equal(result.criterionId, "recall");
  assert.equal(result.score, 0.5);
  assert.equal(result.judgeVotes[0].model, "code:scoreHalf");
});

test("scoreCodeCriterion accepts a { score, reasoning } object return", async () => {
  const result = await scoreCodeCriterion(
    codeCriterion("scoreWithReasoning"),
    fixture,
    {},
  );
  assert.equal(result.score, 0.8);
  assert.equal(result.reasoning, "looks good");
});

test("scoreCodeCriterion passes input/expected/output to the evaluator", async () => {
  // `scoreEchoesOutput` returns output.n / expected.want, i.e. 3/9
  const result = await scoreCodeCriterion(
    codeCriterion("scoreEchoesOutput"),
    fixture,
    { n: 3 },
  );
  assert.ok(Math.abs(result.score - 3 / 9) < 1e-9);
});

test("scoreCodeCriterion throws when the export is missing", async () => {
  await assert.rejects(
    () => scoreCodeCriterion(codeCriterion("doesNotExist"), fixture, {}),
    /not a function/,
  );
});

test("scoreCodeCriterion throws when the evaluator returns the wrong type", async () => {
  await assert.rejects(
    () => scoreCodeCriterion(codeCriterion("scoreBadReturn"), fixture, {}),
    /expected a number/,
  );
});
