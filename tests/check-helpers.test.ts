import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bundleEntryForCombined,
  exitCode,
  formatSummary,
  type BundleOutcome,
} from "../src/cli/check-helpers.js";
import type { Report } from "../src/schema/report.js";

function reportWithSummary(
  partial: Partial<Report["summary"]> & { failed: number; passed?: number },
): Report {
  const passed = partial.passed ?? 0;
  return {
    runId: "run-test",
    startedAt: "2026-06-10T00:00:00Z",
    finishedAt: "2026-06-10T00:00:01Z",
    specName: "test-spec",
    specVersion: "1.0.0",
    judges: [{ model: "claude-haiku-4-5" }],
    aggregator: "mean",
    criteria: [],
    results: [],
    summary: {
      totalFixtures: passed + partial.failed,
      passed,
      failed: partial.failed,
      errored: partial.errored ?? 0,
      weightedScore: partial.weightedScore ?? 0,
      ...(partial.regressions ? { regressions: partial.regressions } : {}),
    },
  };
}

test("exitCode → 0 when all bundles fully green (no diff present)", () => {
  const outcomes: BundleOutcome[] = [
    { specPath: "a", report: reportWithSummary({ failed: 0, passed: 3 }) },
  ];
  assert.equal(exitCode(outcomes), 0);
});

test("exitCode → 2 when any bundle has a load/run error", () => {
  const outcomes: BundleOutcome[] = [
    { specPath: "a", error: "could not load bundle: missing rubric.json" },
    { specPath: "b", report: reportWithSummary({ failed: 0, passed: 5 }) },
  ];
  assert.equal(exitCode(outcomes), 2);
});

test("exitCode → 0 when current failures match baseline (knownFailures only)", () => {
  // The critical contract from issue #12: a bundle whose baseline has legit
  // reds, reproduced exactly in the current run, must NOT break the gate.
  const outcomes: BundleOutcome[] = [
    {
      specPath: "mood-board-search.spec.md",
      report: reportWithSummary({ failed: 2, passed: 17 }),
      diff: { newFailures: [], knownFailures: ["es-015", "es-019"], improvements: [] },
    },
  ];
  assert.equal(exitCode(outcomes), 0);
});

test("exitCode → 1 when there's a new failure on top of baselined reds", () => {
  const outcomes: BundleOutcome[] = [
    {
      specPath: "mood-board-search.spec.md",
      report: reportWithSummary({ failed: 3, passed: 16 }),
      diff: {
        newFailures: ["new-fail-1"],
        knownFailures: ["es-015", "es-019"],
        improvements: [],
      },
    },
  ];
  assert.equal(exitCode(outcomes), 1);
});

test("exitCode → 1 when there's a regression (score dropped past threshold)", () => {
  const outcomes: BundleOutcome[] = [
    {
      specPath: "a",
      report: reportWithSummary({
        failed: 0,
        passed: 5,
        regressions: [
          { fixtureId: "x", baselineScore: 1.0, currentScore: 0.7, delta: -0.3 },
        ],
      }),
      diff: { newFailures: [], knownFailures: [], improvements: [] },
    },
  ];
  assert.equal(exitCode(outcomes), 1);
});

test("exitCode → 1 when any fixture errored (errors are never 'known')", () => {
  const outcomes: BundleOutcome[] = [
    {
      specPath: "a",
      report: reportWithSummary({ failed: 0, passed: 4, errored: 1 }),
      diff: { newFailures: [], knownFailures: [], improvements: [] },
    },
  ];
  assert.equal(exitCode(outcomes), 1);
});

test("exitCode → 0 when only improvements present (baselined fails now pass)", () => {
  const outcomes: BundleOutcome[] = [
    {
      specPath: "a",
      report: reportWithSummary({ failed: 0, passed: 5 }),
      diff: { newFailures: [], knownFailures: [], improvements: ["was-failing"] },
    },
  ];
  assert.equal(exitCode(outcomes), 0);
});

test("formatSummary surfaces known-fail count without breaking pass status", () => {
  const outcomes: BundleOutcome[] = [
    {
      specPath: "mood-board-search.spec.md",
      specName: "mood-board-search",
      report: reportWithSummary({ failed: 2, passed: 17, weightedScore: 0.89 }),
      diff: { newFailures: [], knownFailures: ["es-015", "es-019"], improvements: [] },
    },
  ];
  const out = formatSummary(outcomes, false);
  assert.match(out, /✓ PASS/);
  assert.match(out, /2 known-fail \(baselined\)/);
  assert.doesNotMatch(out, /new failure/);
});

test("formatSummary prompts re-bless when improvements present", () => {
  const outcomes: BundleOutcome[] = [
    {
      specPath: "a",
      specName: "a",
      report: reportWithSummary({ failed: 0, passed: 5, weightedScore: 1.0 }),
      diff: { newFailures: [], knownFailures: [], improvements: ["was-failing"] },
    },
  ];
  const out = formatSummary(outcomes, false);
  assert.match(out, /1 improvement\(s\)/);
  assert.match(out, /consider re-blessing with --update-baseline/);
});

test("bundleEntryForCombined includes the diff counts on the JSON entry", () => {
  const o: BundleOutcome = {
    specPath: "a.spec.md",
    specName: "a",
    report: reportWithSummary({ failed: 2, passed: 3 }),
    diff: { newFailures: ["b"], knownFailures: ["c", "d"], improvements: ["e"] },
  };
  const entry = bundleEntryForCombined(o);
  assert.equal(entry.specName, "a");
  assert.equal(entry.newFailures, 1);
  assert.equal(entry.knownFailures, 2);
  assert.equal(entry.improvements, 1);
});

test("bundleEntryForCombined preserves error shape when present", () => {
  const o: BundleOutcome = {
    specPath: "a.spec.md",
    error: "could not load bundle",
  };
  const entry = bundleEntryForCombined(o);
  assert.equal(entry.error, "could not load bundle");
  assert.equal(entry.summary, undefined);
});
