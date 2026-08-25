import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/runner/index.js";
import { warnExcludedJudges } from "../src/runner/excluded-judges.js";
import { unsetJudgeApiKeyEnv } from "../src/runner/providers.js";
import type { Spec } from "../src/schema/spec.js";
import type { Criterion, Rubric } from "../src/schema/rubric.js";
import type { FixtureSet } from "../src/schema/fixture.js";
import type { JudgeCallRequest } from "../src/runner/providers.js";

const spec: Spec = {
  frontmatter: {
    name: "panel",
    version: "1.0.0",
    description: "panel degradation tests",
    target: { kind: "free-form", description: "x" },
  },
  body: "body",
} as Spec;

const llmCriterion: Criterion = {
  id: "a",
  name: "A",
  description: "",
  weight: 1,
  scale: { kind: "pass-fail" },
};

const llmRubric: Rubric = {
  specName: "panel",
  specVersion: "1.0.0",
  passThreshold: 0.5,
  criteria: [llmCriterion],
};

const targetUrl = new URL("./_exec-target.ts", import.meta.url).href;

const codeCriterion: Criterion = {
  id: "shape",
  name: "shape",
  description: "",
  weight: 1,
  scale: { kind: "ordinal", min: 0, max: 1 },
  evaluator: { kind: "code", module: targetUrl, export: "scoreHalf" },
};

const codeRubric: Rubric = {
  specName: "panel",
  specVersion: "1.0.0",
  passThreshold: 0.4,
  criteria: [codeCriterion],
};

function fixtures(ids: string[]): FixtureSet {
  return {
    specName: "panel",
    specVersion: "1.0.0",
    fixtures: ids.map((id) => ({ id, input: { op: "parse" } })),
  };
}

async function withEnvAsync<T>(
  name: string,
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function captureWarns(): { warnings: string[]; restore: () => void } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(String(args[0]));
  return { warnings, restore: () => void (console.warn = original) };
}

const healthyCall = async (req: JudgeCallRequest) => ({
  scores: [
    {
      criterionId: "a",
      score: 1,
      reasoning: `ok from ${req.model}`,
    },
  ],
});

test("unsetJudgeApiKeyEnv names FIREWORKS_API_KEY when it is missing", () => {
  const previous = process.env.FIREWORKS_API_KEY;
  delete process.env.FIREWORKS_API_KEY;
  try {
    assert.equal(
      unsetJudgeApiKeyEnv({
        provider: "fireworks",
      }),
      "FIREWORKS_API_KEY",
    );
  } finally {
    if (previous === undefined) delete process.env.FIREWORKS_API_KEY;
    else process.env.FIREWORKS_API_KEY = previous;
  }
});

test("unsetJudgeApiKeyEnv accepts either Google key", () => {
  const gem = process.env.GEMINI_API_KEY;
  const goog = process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    assert.equal(
      unsetJudgeApiKeyEnv({ provider: "google" }),
      "GEMINI_API_KEY",
    );
    process.env.GOOGLE_API_KEY = "x";
    assert.equal(
      unsetJudgeApiKeyEnv({ provider: "google" }),
      undefined,
    );
  } finally {
    if (gem === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = gem;
    if (goog === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = goog;
  }
});

test("unsetJudgeApiKeyEnv refuses a blank GEMINI_API_KEY even when GOOGLE_API_KEY is set", () => {
  const gem = process.env.GEMINI_API_KEY;
  const goog = process.env.GOOGLE_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "";
    process.env.GOOGLE_API_KEY = "x";
    assert.equal(
      unsetJudgeApiKeyEnv({ provider: "google" }),
      "GEMINI_API_KEY",
    );
  } finally {
    if (gem === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = gem;
    if (goog === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = goog;
  }
});

test("a mixed panel stays green and warns once that the down judge was excluded from the aggregate", async () => {
  const { warnings, restore } = captureWarns();
  try {
    await withEnvAsync("OPENAI_API_KEY", "test-key", async () => {
      const report = await run({
        spec,
        rubric: llmRubric,
        fixtures: fixtures(["f1"]),
        judges: [
          { provider: "openai", model: "up" },
          { provider: "openai", model: "down" },
        ],
        execute: async (input) => input,
        judgeCall: async (req) => {
          if (req.model === "down") throw new Error("529 overloaded");
          return healthyCall(req);
        },
      });
      assert.equal(report.results[0].passed, true);
      assert.equal(report.results[0].scores[0].score, 1);
      const excluded = warnings.filter((w) =>
        w.includes("excluded from the aggregate"),
      );
      assert.equal(excluded.length, 1);
      assert.match(excluded[0], /down/);
      assert.match(excluded[0], /529 overloaded/);
    });
  } finally {
    restore();
  }
});

test("a healthy two-judge panel emits no excluded-from-the-aggregate warning", async () => {
  const { warnings, restore } = captureWarns();
  try {
    await withEnvAsync("OPENAI_API_KEY", "test-key", async () => {
      const report = await run({
        spec,
        rubric: llmRubric,
        fixtures: fixtures(["f1"]),
        judges: [
          { provider: "openai", model: "up" },
          { provider: "openai", model: "also-up" },
        ],
        execute: async (input) => input,
        judgeCall: healthyCall,
      });
      assert.equal(report.results[0].passed, true);
      assert.equal(
        warnings.filter((w) => w.includes("excluded from the aggregate"))
          .length,
        0,
      );
    });
  } finally {
    restore();
  }
});

test("two fixtures with the same (model, error) warn once", async () => {
  const { warnings, restore } = captureWarns();
  try {
    await withEnvAsync("OPENAI_API_KEY", "test-key", async () => {
      await run({
        spec,
        rubric: llmRubric,
        fixtures: fixtures(["f1", "f2"]),
        judges: [
          { provider: "openai", model: "up" },
          { provider: "openai", model: "down" },
        ],
        execute: async (input) => input,
        judgeCall: async (req) => {
          if (req.model === "down") throw new Error("529 overloaded");
          return healthyCall(req);
        },
      });
      assert.equal(
        warnings.filter((w) => w.includes("excluded from the aggregate"))
          .length,
        1,
      );
    });
  } finally {
    restore();
  }
});

test("when every judge errors the fixture is errored and the warning still fires", async () => {
  const { warnings, restore } = captureWarns();
  try {
    await withEnvAsync("OPENAI_API_KEY", "test-key", async () => {
      const report = await run({
        spec,
        rubric: llmRubric,
        fixtures: fixtures(["f1"]),
        judges: [
          { provider: "openai", model: "j1" },
          { provider: "openai", model: "j2" },
        ],
        execute: async (input) => input,
        judgeCall: async () => {
          throw new Error("timeout");
        },
      });
      assert.equal(report.results[0].passed, false);
      assert.match(report.results[0].error ?? "", /could not score/);
      assert.ok(
        warnings.some((w) => w.includes("excluded from the aggregate")),
      );
    });
  } finally {
    restore();
  }
});

test("run() refuses a fireworks judge when FIREWORKS_API_KEY is unset, before execute", async () => {
  let executed = false;
  await withEnvAsync("FIREWORKS_API_KEY", undefined, async () => {
    await assert.rejects(
      () =>
        run({
          spec,
          rubric: codeRubric,
          fixtures: fixtures(["f1"]),
          judges: [
            {
              provider: "fireworks",
              model: "accounts/fireworks/models/x",
            },
          ],
          execute: async (input) => {
            executed = true;
            return input;
          },
        }),
      /FIREWORKS_API_KEY/,
    );
  });
  assert.equal(executed, false);
});

test("an Anthropic-only panel does not require FIREWORKS_API_KEY", async () => {
  await withEnvAsync("FIREWORKS_API_KEY", undefined, async () => {
    await withEnvAsync("ANTHROPIC_API_KEY", "test-key", async () => {
      const report = await run({
        spec,
        rubric: llmRubric,
        fixtures: fixtures(["f1"]),
        judges: [{ provider: "anthropic", model: "claude-haiku-4-5" }],
        execute: async (input) => input,
        judgeCall: healthyCall,
      });
      assert.equal(report.results[0].passed, true);
    });
  });
});

test("warnExcludedJudges itself dedupes identical (model, error) pairs", () => {
  const { warnings, restore } = captureWarns();
  try {
    warnExcludedJudges([
      { model: "down", error: "529 overloaded" },
      { model: "down", error: "529 overloaded" },
      { model: "other", error: "timeout" },
    ]);
    const excluded = warnings.filter((w) =>
      w.includes("excluded from the aggregate"),
    );
    assert.equal(excluded.length, 2);
  } finally {
    restore();
  }
});
