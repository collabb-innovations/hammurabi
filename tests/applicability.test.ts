import { test } from "node:test";
import assert from "node:assert/strict";
import {
  criterionApplies,
  partitionByApplicability,
  referencedTags,
} from "../src/runner/applicability.js";
import { scoreFixture } from "../src/runner/score.js";
import { parseRubric } from "../src/loaders/rubric.js";
import type { Criterion, Rubric } from "../src/schema/rubric.js";
import type { Fixture } from "../src/schema/fixture.js";
import type { CriterionScore } from "../src/schema/report.js";

function criterion(over: Partial<Criterion> & { id: string }): Criterion {
  return {
    name: over.id,
    description: "",
    weight: 1,
    scale: { kind: "pass-fail" },
    ...over,
  };
}

function fixture(over: Partial<Fixture> & { id: string }): Fixture {
  return { input: {}, ...over };
}

function rubric(criteria: Criterion[], passThreshold = 0.5): Rubric {
  return { specName: "s", specVersion: "1", criteria, passThreshold };
}

function score(criterionId: string, s: number): CriterionScore {
  return { criterionId, score: s, reasoning: "", judgeVotes: [] };
}

test("a criterion with no appliesTo applies to every fixture", () => {
  const c = criterion({ id: "a" });
  assert.equal(criterionApplies(c, fixture({ id: "f" })), true);
  assert.equal(criterionApplies(c, fixture({ id: "f", tags: ["parse"] })), true);
});

test("a criterion applies when the fixture carries any one of its tags", () => {
  const c = criterion({ id: "a", appliesTo: ["parse", "adapters"] });
  assert.equal(
    criterionApplies(c, fixture({ id: "f", tags: ["adapters", "smoke"] })),
    true,
  );
});

test("a criterion does not apply when the fixture carries none of its tags", () => {
  const c = criterion({ id: "a", appliesTo: ["parse"] });
  assert.equal(criterionApplies(c, fixture({ id: "f", tags: ["collect"] })), false);
});

test("a restricted criterion does not apply to an untagged fixture", () => {
  const c = criterion({ id: "a", appliesTo: ["parse"] });
  assert.equal(criterionApplies(c, fixture({ id: "f" })), false);
});

test("partitionByApplicability splits and preserves rubric order", () => {
  const criteria = [
    criterion({ id: "shape" }),
    criterion({ id: "parse-only", appliesTo: ["parse"] }),
    criterion({ id: "collect-only", appliesTo: ["collect"] }),
  ];
  const { applicable, inapplicable } = partitionByApplicability(
    criteria,
    fixture({ id: "f", tags: ["collect"] }),
  );
  assert.deepEqual(
    applicable.map((c) => c.id),
    ["shape", "collect-only"],
  );
  assert.deepEqual(
    inapplicable.map((c) => c.id),
    ["parse-only"],
  );
});

test("referencedTags collects every tag any criterion restricts itself to", () => {
  const tags = referencedTags([
    criterion({ id: "a", appliesTo: ["parse"] }),
    criterion({ id: "b", appliesTo: ["parse", "collect"] }),
    criterion({ id: "c" }),
  ]);
  assert.deepEqual([...tags].sort(), ["collect", "parse"]);
});

// --- the denominator, which is the whole point -----------------------------

test("a fixture is scored out of the criteria that applied, not out of 1.0", () => {
  // 3 of 6 criteria apply. All three pass. The fixture is perfect on
  // everything that was asked of it, so it must score 1.0 — not 0.5, which is
  // what dividing by the full rubric weight would give.
  const criteria = [
    criterion({ id: "a", weight: 1 / 6 }),
    criterion({ id: "b", weight: 1 / 6 }),
    criterion({ id: "c", weight: 1 / 6 }),
    criterion({ id: "d", weight: 1 / 6, appliesTo: ["other"] }),
    criterion({ id: "e", weight: 1 / 6, appliesTo: ["other"] }),
    criterion({ id: "f", weight: 1 / 6, appliesTo: ["other"] }),
  ];
  const r = rubric(criteria, 0.8);
  const { applicable } = partitionByApplicability(criteria, fixture({ id: "fx" }));
  const scores = applicable.map((c) => score(c.id, 1));

  const { weightedScore, passed } = scoreFixture(scores, r);
  assert.equal(weightedScore, 1);
  assert.equal(passed, true);
});

test("renormalisation preserves relative weight among the criteria that apply", () => {
  const criteria = [
    criterion({ id: "heavy", weight: 0.6 }),
    criterion({ id: "light", weight: 0.2 }),
    criterion({ id: "absent", weight: 0.2, appliesTo: ["other"] }),
  ];
  const r = rubric(criteria, 0.5);
  const { applicable } = partitionByApplicability(criteria, fixture({ id: "fx" }));
  const scores = applicable.map((c) => score(c.id, c.id === "heavy" ? 1 : 0));

  // 0.6 of the 0.8 weight in play — not 0.6 of 1.0.
  const { weightedScore } = scoreFixture(scores, r);
  assert.equal(Math.round(weightedScore * 1000) / 1000, 0.75);
});

test("scoring is unchanged for a conformant rubric where everything applies", () => {
  const r = rubric(
    [criterion({ id: "a", weight: 0.3 }), criterion({ id: "b", weight: 0.7 })],
    0.5,
  );
  const { weightedScore } = scoreFixture([score("a", 1), score("b", 0)], r);
  assert.equal(Math.round(weightedScore * 1000) / 1000, 0.3);
});

test("a fixture no criterion applies to scores 0 and does not pass", () => {
  const r = rubric([criterion({ id: "a", weight: 1, appliesTo: ["other"] })], 0);
  const { weightedScore, passed } = scoreFixture([], r);
  assert.equal(weightedScore, 0);
  // passThreshold is 0, so a vacuous pass is exactly the trap here.
  assert.equal(passed, false);
});

// --- schema ----------------------------------------------------------------

test("parseRubric accepts appliesTo", () => {
  const r = parseRubric(
    JSON.stringify({
      specName: "s",
      specVersion: "1",
      passThreshold: 0.8,
      criteria: [
        {
          id: "a",
          name: "a",
          description: "",
          weight: 1,
          scale: { kind: "pass-fail" },
          appliesTo: ["parse"],
        },
      ],
    }),
  );
  assert.deepEqual(r.criteria[0]!.appliesTo, ["parse"]);
});

test("parseRubric rejects an empty appliesTo — it would never score", () => {
  assert.throws(
    () =>
      parseRubric(
        JSON.stringify({
          specName: "s",
          specVersion: "1",
          passThreshold: 0.8,
          criteria: [
            {
              id: "a",
              name: "a",
              description: "",
              weight: 1,
              scale: { kind: "pass-fail" },
              appliesTo: [],
            },
          ],
        }),
      ),
    /Invalid rubric/,
  );
});
