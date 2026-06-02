import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReportMarkdown } from "../src/cli/report-md.js";
import type { Report } from "../src/schema/report.js";

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
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
            reasoning: "[claude-haiku-4-5] correct.",
            judgeVotes: [
              {
                model: "claude-haiku-4-5",
                score: 1.0,
                reasoning: "correct.",
              },
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
    ...overrides,
  };
}

test("renderReportMarkdown emits the spec title", () => {
  const md = renderReportMarkdown(makeReport());
  assert.match(md, /# Eval Report — foo v1\.0\.0/);
});

test("renderReportMarkdown lists judges and aggregator in header", () => {
  const r = makeReport({
    judges: [{ model: "claude-haiku-4-5" }, { model: "claude-sonnet-4-6" }],
    aggregator: "min",
  });
  const md = renderReportMarkdown(r);
  assert.match(md, /Judges.*claude-haiku-4-5.*claude-sonnet-4-6/);
  assert.match(md, /Aggregator.*min/);
});

test("renderReportMarkdown shows 'no baseline' when regressions undefined", () => {
  const md = renderReportMarkdown(makeReport());
  assert.match(md, /Regressions.*0.*no baseline/);
});

test("renderReportMarkdown shows 'vs baseline' when regressions defined", () => {
  const r = makeReport({
    summary: {
      ...makeReport().summary,
      regressions: [],
    },
  });
  const md = renderReportMarkdown(r);
  assert.match(md, /Regressions.*0.*vs baseline/);
});

test("renderReportMarkdown includes fixture table with tags", () => {
  const md = renderReportMarkdown(makeReport());
  assert.match(md, /## Fixtures/);
  assert.match(md, /\| happy \| happy-path \| 1\.00 \| ✓ \|/);
});

test("renderReportMarkdown includes judge-votes <details> block", () => {
  const r = makeReport({
    results: [
      {
        ...makeReport().results[0],
        scores: [
          {
            criterionId: "is-correct",
            score: 0.5,
            reasoning: "split.",
            judgeVotes: [
              {
                model: "claude-haiku-4-5",
                score: 1.0,
                reasoning: "good.",
              },
              {
                model: "claude-sonnet-4-6",
                score: 0.0,
                reasoning: "bad.",
              },
            ],
          },
        ],
      },
    ],
  });
  const md = renderReportMarkdown(r);
  assert.match(md, /<details>/);
  assert.match(md, /<summary>Judge votes<\/summary>/);
  assert.match(md, /\*\*claude-haiku-4-5\*\* \(1\.00\): good\./);
  assert.match(md, /\*\*claude-sonnet-4-6\*\* \(0\.00\): bad\./);
});

test("renderReportMarkdown renders errored fixtures distinctly", () => {
  const r = makeReport({
    results: [
      {
        fixtureId: "boom",
        output: null,
        scores: [],
        weightedScore: 0,
        passed: false,
        error: "module not found",
      },
    ],
    summary: {
      totalFixtures: 1,
      passed: 0,
      failed: 0,
      errored: 1,
      weightedScore: 0,
    },
  });
  const md = renderReportMarkdown(r);
  assert.match(md, /### boom — ⚠ errored/);
  assert.match(md, /Error: `module not found`/);
});

test("renderReportMarkdown includes Regressions section when delta present", () => {
  const r = makeReport({
    summary: {
      ...makeReport().summary,
      regressions: [
        {
          fixtureId: "happy",
          baselineScore: 1.0,
          currentScore: 0.5,
          delta: -0.5,
        },
      ],
    },
  });
  const md = renderReportMarkdown(r);
  assert.match(md, /## Regressions/);
  assert.match(md, /\| happy \| 1\.00 \| 0\.50 \| -0\.50 \|/);
});

test("renderReportMarkdown shows judge-errored votes with hint", () => {
  const r = makeReport({
    results: [
      {
        ...makeReport().results[0],
        scores: [
          {
            criterionId: "is-correct",
            score: 0,
            reasoning: "judge errored",
            judgeVotes: [
              {
                model: "claude-haiku-4-5",
                score: 0,
                reasoning: "judge errored",
                error: "API timeout",
              },
            ],
          },
        ],
      },
    ],
  });
  const md = renderReportMarkdown(r);
  assert.match(md, /judge errored: API timeout/);
});

test("renderReportMarkdown escapes pipes in fixture IDs and tags", () => {
  const r = makeReport({
    results: [
      {
        ...makeReport().results[0],
        fixtureId: "weird|id",
        tags: ["tag|with|pipes", "normal"],
      },
    ],
  });
  const md = renderReportMarkdown(r);
  assert.match(md, /weird\\\|id/);
  assert.match(md, /tag\\\|with\\\|pipes/);
});

test("renderReportMarkdown collapses newlines in table cells", () => {
  const r = makeReport({
    results: [
      {
        ...makeReport().results[0],
        fixtureId: "line\none\ntwo",
      },
    ],
  });
  const md = renderReportMarkdown(r);
  const fixtureRow = md
    .split("\n")
    .find((line) => line.startsWith("| line"));
  assert.ok(fixtureRow, "expected a fixture row starting with | line");
  // The collapsed cell should contain all three tokens on one line
  assert.match(fixtureRow!, /line one two/);
});

test("renderReportMarkdown swaps to double-backtick fence when error contains a backtick", () => {
  const r = makeReport({
    results: [
      {
        fixtureId: "boom",
        output: null,
        scores: [],
        weightedScore: 0,
        passed: false,
        error: "saw `mod` not found",
      },
    ],
    summary: {
      totalFixtures: 1,
      passed: 0,
      failed: 0,
      errored: 1,
      weightedScore: 0,
    },
  });
  const md = renderReportMarkdown(r);
  assert.match(md, /Error: `` /);
});

test("renderReportMarkdown defangs </details> in judge reasoning", () => {
  const r = makeReport({
    results: [
      {
        ...makeReport().results[0],
        scores: [
          {
            criterionId: "is-correct",
            score: 1.0,
            reasoning: "fine",
            judgeVotes: [
              {
                model: "claude-haiku-4-5",
                score: 1.0,
                reasoning: "ok then </details> trailing",
              },
            ],
          },
        ],
      },
    ],
  });
  const md = renderReportMarkdown(r);
  const reasoningLine = md
    .split("\n")
    .find((l) => l.includes("ok then"));
  assert.ok(reasoningLine);
  // The verbatim </details> tag must not appear in this line — defanged.
  assert.ok(!/<\/details>/.test(reasoningLine!));
});
