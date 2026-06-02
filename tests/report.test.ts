import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReport } from "../src/loaders/report.js";

const validReport = {
  runId: "run-1",
  startedAt: "2026-06-02T00:00:00Z",
  finishedAt: "2026-06-02T00:00:10Z",
  specName: "foo",
  specVersion: "1.0.0",
  judges: [{ model: "claude-haiku-4-5" }],
  aggregator: "mean",
  criteria: [
    {
      id: "is-correct",
      name: "Is correct",
      description: "Output is correct",
      weight: 1.0,
      scale: { kind: "pass-fail" },
    },
  ],
  results: [
    {
      fixtureId: "happy",
      output: "HELLO",
      tags: ["happy-path"],
      scores: [
        {
          criterionId: "is-correct",
          score: 1.0,
          reasoning: "ok",
          judgeVotes: [
            { model: "claude-haiku-4-5", score: 1.0, reasoning: "ok" },
          ],
        },
      ],
      weightedScore: 1.0,
      passed: true,
    },
  ],
  summary: {
    totalFixtures: 1,
    passed: 1,
    failed: 0,
    errored: 0,
    weightedScore: 1.0,
  },
};

test("parseReport accepts a valid report", () => {
  const r = parseReport(JSON.stringify(validReport));
  assert.equal(r.runId, "run-1");
  assert.equal(r.results.length, 1);
});

test("parseReport rejects an empty object", () => {
  assert.throws(() => parseReport("{}"), /Invalid report/);
});

test("parseReport rejects a report missing 'results'", () => {
  const broken = { ...validReport };
  delete (broken as Partial<typeof validReport>).results;
  assert.throws(() => parseReport(JSON.stringify(broken)), /results/);
});

test("parseReport rejects a report with a non-numeric weightedScore", () => {
  const broken = JSON.parse(JSON.stringify(validReport));
  broken.results[0].weightedScore = "high";
  assert.throws(
    () => parseReport(JSON.stringify(broken)),
    /weightedScore/,
  );
});

test("parseReport rejects unknown top-level fields (strict)", () => {
  const broken = { ...validReport, extra: "nope" };
  assert.throws(() => parseReport(JSON.stringify(broken)), /extra/);
});

test("parseReport rejects malformed JSON", () => {
  assert.throws(() => parseReport("not json"), /Invalid report JSON/);
});

test("parseReport accepts a report without regressions", () => {
  const r = parseReport(JSON.stringify(validReport));
  assert.equal(r.summary.regressions, undefined);
});

test("parseReport accepts a report with regressions", () => {
  const withReg = {
    ...validReport,
    summary: {
      ...validReport.summary,
      regressions: [
        {
          fixtureId: "happy",
          baselineScore: 1.0,
          currentScore: 0.5,
          delta: -0.5,
        },
      ],
    },
  };
  const r = parseReport(JSON.stringify(withReg));
  assert.equal(r.summary.regressions?.length, 1);
});

test("parseReport accepts an errored fixture result", () => {
  const errored = {
    ...validReport,
    results: [
      {
        fixtureId: "boom",
        output: null,
        scores: [],
        weightedScore: 0,
        passed: false,
        error: "boom",
      },
    ],
    summary: {
      totalFixtures: 1,
      passed: 0,
      failed: 0,
      errored: 1,
      weightedScore: 0,
    },
  };
  const r = parseReport(JSON.stringify(errored));
  assert.equal(r.results[0].error, "boom");
});
