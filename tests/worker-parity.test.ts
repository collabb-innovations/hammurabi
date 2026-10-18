import { test } from "node:test";
import assert from "node:assert/strict";
import { run as nodeRun } from "../src/runner/index.js";
import { run as workerRun } from "../src/worker.js";
import { fetchJudge } from "../src/runner/fetch-judge.js";
import type { Spec } from "../src/schema/spec.js";
import type { Rubric } from "../src/schema/rubric.js";
import type { FixtureSet } from "../src/schema/fixture.js";
import type { Report } from "../src/schema/report.js";
import type { JudgeKeys } from "../src/runner/keys.js";

const spec: Spec = {
  frontmatter: {
    name: "parity",
    version: "1.0.0",
    description: "worker parity",
    target: { kind: "free-form", description: "echo the input" },
  },
  body: "The output should echo the input.",
};

const rubric: Rubric = {
  specName: "parity",
  specVersion: "1.0.0",
  passThreshold: 0.5,
  criteria: [
    {
      id: "quality",
      name: "Quality",
      description: "Output is useful",
      weight: 1,
      scale: { kind: "pass-fail" },
    },
  ],
};

const fixtures: FixtureSet = {
  specName: "parity",
  specVersion: "1.0.0",
  fixtures: [{ id: "f1", input: { text: "hello" } }],
};

const keys: JudgeKeys = { anthropic: "test-key" };

function mockFetch(): typeof fetch {
  const body = JSON.stringify({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          scores: [{ criterionId: "quality", score: 1, reasoning: "good" }],
        }),
      },
    ],
  });
  return async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

function comparable(report: Report): unknown {
  const { startedAt, finishedAt, runId, ...rest } = report;
  return rest;
}

test("node run and the worker entry return the same report for one llm fixture", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    const fetchImpl = mockFetch();
    const shared = {
      spec,
      rubric,
      fixtures,
      execute: async (input: unknown) => ({ echo: input }),
      judges: [
        {
          provider: "anthropic" as const,
          model: "claude-haiku-4-5",
          role: "primary",
        },
      ],
    };
    const nodeReport = await nodeRun({
      ...shared,
      judgeCall: (req) => fetchJudge(req, { keys, fetch: fetchImpl }),
    });
    const workerReport = await workerRun({
      ...shared,
      keys,
      fetch: fetchImpl,
    });
    assert.deepEqual(comparable(nodeReport), comparable(workerReport));
    assert.equal(workerReport.results[0]?.passed, true);
    assert.equal(workerReport.results[0]?.scores[0]?.score, 1);
    assert.equal(workerReport.summary.passed, 1);
    assert.equal(workerReport.summary.failed, 0);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});
