import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/runner/index.js";
import type { Spec } from "../src/schema/spec.js";
import type { Criterion, Rubric } from "../src/schema/rubric.js";
import type { FixtureSet } from "../src/schema/fixture.js";

/**
 * End-to-end `run()` coverage for `appliesTo`, using code evaluators only so
 * the test needs no judge and no network. The judged path is the same filter:
 * `llmCriteria` is derived from the applicable set, so an inapplicable judged
 * criterion is never handed to the panel and costs no call.
 */

const targetUrl = new URL("./_exec-target.ts", import.meta.url).href;

const spec: Spec = {
  frontmatter: {
    name: "split",
    version: "1.0.0",
    description: "A target with two output shapes",
    target: { kind: "free-form", description: "x" },
  },
  body: "body",
} as Spec;

function codeCriterion(
  id: string,
  weight: number,
  appliesTo?: string[],
): Criterion {
  return {
    id,
    name: id,
    description: "",
    weight,
    scale: { kind: "ordinal", min: 0, max: 1 },
    evaluator: { kind: "code", module: targetUrl, export: "scoreHalf" },
    ...(appliesTo ? { appliesTo } : {}),
  };
}

const rubric: Rubric = {
  specName: "split",
  specVersion: "1.0.0",
  passThreshold: 0.4,
  criteria: [
    codeCriterion("shape", 0.4),
    codeCriterion("parse-only", 0.3, ["parse"]),
    codeCriterion("collect-only", 0.3, ["collect"]),
  ],
};

const fixtures: FixtureSet = {
  specName: "split",
  specVersion: "1.0.0",
  fixtures: [
    { id: "a-parse", input: { op: "parse" }, tags: ["parse"] },
    { id: "a-collect", input: { op: "collect" }, tags: ["collect"] },
  ],
};

const execute = async (input: unknown) => input;

test("run() scores each fixture only on the criteria that apply to it", async () => {
  const report = await run({ spec, rubric, fixtures, execute });

  const parse = report.results.find((r) => r.fixtureId === "a-parse")!;
  assert.deepEqual(
    parse.scores.map((s) => s.criterionId),
    ["shape", "parse-only"],
  );
  assert.deepEqual(parse.inapplicable, ["collect-only"]);

  const collect = report.results.find((r) => r.fixtureId === "a-collect")!;
  assert.deepEqual(
    collect.scores.map((s) => s.criterionId),
    ["shape", "collect-only"],
  );
  assert.deepEqual(collect.inapplicable, ["parse-only"]);
});

test("run() renormalises over the applicable weight", async () => {
  // Every evaluator returns 0.5. Only 0.7 of the rubric's weight applies to
  // any one fixture, so the un-renormalised sum would be 0.35 and the fixture
  // would fail its 0.4 threshold purely because a criterion sat out.
  const report = await run({ spec, rubric, fixtures, execute });
  for (const r of report.results) {
    assert.equal(r.weightedScore, 0.5);
    assert.equal(r.passed, true);
  }
});

test("run() errors a fixture that no criterion applies to", async () => {
  const orphan: FixtureSet = {
    ...fixtures,
    fixtures: [{ id: "orphan", input: {}, tags: ["neither"] }],
  };
  const onlyRestricted: Rubric = {
    ...rubric,
    criteria: rubric.criteria.filter((c) => c.appliesTo !== undefined),
  };
  const report = await run({
    spec,
    rubric: onlyRestricted,
    fixtures: orphan,
    execute,
  });

  const r = report.results[0]!;
  assert.equal(r.passed, false);
  assert.match(r.error ?? "", /no criterion applies to this fixture/);
  assert.equal(report.summary.errored, 1);
});

test("run() is unchanged when no criterion declares appliesTo", async () => {
  const plain: Rubric = {
    ...rubric,
    criteria: [codeCriterion("a", 0.5), codeCriterion("b", 0.5)],
  };
  const report = await run({ spec, rubric: plain, fixtures, execute });
  for (const r of report.results) {
    assert.equal(r.inapplicable, undefined);
    assert.equal(r.weightedScore, 0.5);
  }
});
