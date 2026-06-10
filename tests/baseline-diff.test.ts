import { test } from "node:test";
import assert from "node:assert/strict";
import { diffAgainstBaseline } from "../src/cli/baseline-diff.js";
import type { FixtureResult, Report } from "../src/schema/report.js";

function fx(id: string, passed: boolean, opts: { error?: string } = {}): FixtureResult {
  return {
    fixtureId: id,
    output: null,
    scores: [],
    weightedScore: passed ? 1 : 0,
    passed,
    ...(opts.error ? { error: opts.error } : {}),
  };
}

function report(results: FixtureResult[]): Report {
  const passed = results.filter((r) => r.passed && !r.error).length;
  const failed = results.filter((r) => !r.passed && !r.error).length;
  const errored = results.filter((r) => r.error).length;
  return {
    runId: "run-test",
    startedAt: "2026-06-10T00:00:00Z",
    finishedAt: "2026-06-10T00:00:01Z",
    specName: "test-spec",
    specVersion: "1.0.0",
    judges: [{ model: "claude-haiku-4-5" }],
    aggregator: "mean",
    criteria: [],
    results,
    summary: {
      totalFixtures: results.length,
      passed,
      failed,
      errored,
      weightedScore: passed / Math.max(1, results.length - errored),
    },
  };
}

test("no baseline → every currently failing fixture is a newFailure", () => {
  const current = report([fx("a", false), fx("b", false), fx("c", true)]);
  const diff = diffAgainstBaseline(current, undefined);
  assert.deepEqual(diff.newFailures, ["a", "b"]);
  assert.deepEqual(diff.knownFailures, []);
  assert.deepEqual(diff.improvements, []);
});

test("fixture failing in baseline AND current → knownFailure (not new)", () => {
  const baseline = report([fx("a", false), fx("b", true)]);
  const current = report([fx("a", false), fx("b", true)]);
  const diff = diffAgainstBaseline(current, baseline);
  assert.deepEqual(diff.newFailures, []);
  assert.deepEqual(diff.knownFailures, ["a"]);
  assert.deepEqual(diff.improvements, []);
});

test("fixture passing in baseline, failing now → newFailure", () => {
  const baseline = report([fx("a", true), fx("b", true)]);
  const current = report([fx("a", false), fx("b", true)]);
  const diff = diffAgainstBaseline(current, baseline);
  assert.deepEqual(diff.newFailures, ["a"]);
  assert.deepEqual(diff.knownFailures, []);
});

test("fixture failing in baseline, passing now → improvement", () => {
  const baseline = report([fx("a", false), fx("b", true)]);
  const current = report([fx("a", true), fx("b", true)]);
  const diff = diffAgainstBaseline(current, baseline);
  assert.deepEqual(diff.newFailures, []);
  assert.deepEqual(diff.knownFailures, []);
  assert.deepEqual(diff.improvements, ["a"]);
});

test("mixed: 1 known-fail + 1 new-fail + 1 improvement + 1 steady-pass", () => {
  // baseline: a fails, b fails, c passes, d passes
  // current:  a fails, b passes, c fails, d passes
  const baseline = report([fx("a", false), fx("b", false), fx("c", true), fx("d", true)]);
  const current = report([fx("a", false), fx("b", true), fx("c", false), fx("d", true)]);
  const diff = diffAgainstBaseline(current, baseline);
  assert.deepEqual(diff.knownFailures, ["a"]);
  assert.deepEqual(diff.improvements, ["b"]);
  assert.deepEqual(diff.newFailures, ["c"]);
});

test("errored fixtures are excluded from classification entirely", () => {
  // Infrastructure errors are not stable states — never "known" or "improvement"
  const baseline = report([fx("a", false), fx("b", true)]);
  const current = report([
    fx("a", false, { error: "judge timeout" }),
    fx("b", true),
    fx("c", false, { error: "target unreachable" }),
  ]);
  const diff = diffAgainstBaseline(current, baseline);
  assert.deepEqual(diff.newFailures, []);
  assert.deepEqual(diff.knownFailures, []);
  assert.deepEqual(diff.improvements, []);
});

test("baseline with errored fixture does not count as 'baseline-failing'", () => {
  // A fixture errored in the baseline (infrastructure problem) failing in
  // current run should be treated as a new failure, not a known one — the
  // baseline doesn't carry signal about whether the fixture "really" fails.
  const baseline = report([fx("a", false, { error: "judge timeout" }), fx("b", true)]);
  const current = report([fx("a", false), fx("b", true)]);
  const diff = diffAgainstBaseline(current, baseline);
  assert.deepEqual(diff.newFailures, ["a"]);
  assert.deepEqual(diff.knownFailures, []);
});
