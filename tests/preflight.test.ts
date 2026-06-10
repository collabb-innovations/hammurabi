import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  formatPreflightFailures,
  preflightImports,
} from "../src/runner/preflight.js";
import type { Spec } from "../src/schema/spec.js";
import type { Rubric } from "../src/schema/rubric.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOLVABLE = resolve(__dirname, "./_exec-target.ts");
const UNRESOLVABLE = resolve(__dirname, "./_does-not-exist-12fe.ts");

function specWithTarget(target: Spec["frontmatter"]["target"]): Spec {
  return {
    frontmatter: {
      name: "t",
      version: "1.0.0",
      description: "test",
      target,
    },
    body: "",
  };
}

function rubric(criteria: Rubric["criteria"]): Rubric {
  return {
    specName: "t",
    specVersion: "1.0.0",
    criteria,
    passThreshold: 0.5,
  };
}

test("free-form target → no module to resolve, 0 failures", async () => {
  const spec = specWithTarget({ kind: "free-form", description: "x" });
  const failures = await preflightImports(spec, rubric([]), "fake.spec.md");
  assert.equal(failures.length, 0);
});

test("function target with resolvable module → 0 failures", async () => {
  const spec = specWithTarget({
    kind: "function",
    module: RESOLVABLE,
    export: "echo",
  });
  const failures = await preflightImports(spec, rubric([]), "fake.spec.md");
  assert.equal(failures.length, 0);
});

test("function target with unresolvable module → 1 failure pointing at spec.target.module", async () => {
  const spec = specWithTarget({
    kind: "function",
    module: UNRESOLVABLE,
    export: "x",
  });
  const failures = await preflightImports(spec, rubric([]), "fake.spec.md");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].source, "spec.target.module");
  assert.equal(failures[0].module, UNRESOLVABLE);
  assert.equal(failures[0].bundlePath, "fake.spec.md");
});

test("code-evaluator criterion with resolvable module → 0 failures", async () => {
  const spec = specWithTarget({ kind: "free-form", description: "x" });
  const r = rubric([
    {
      id: "good",
      name: "Good",
      description: "d",
      weight: 1,
      scale: { kind: "pass-fail" },
      evaluator: { kind: "code", module: RESOLVABLE, export: "echo" },
    },
  ]);
  const failures = await preflightImports(spec, r, "fake.spec.md");
  assert.equal(failures.length, 0);
});

test("code-evaluator criterion with unresolvable module → failure source includes criterion id", async () => {
  const spec = specWithTarget({ kind: "free-form", description: "x" });
  const r = rubric([
    {
      id: "semantic-recall",
      name: "Semantic recall",
      description: "d",
      weight: 1,
      scale: { kind: "ordinal", min: 0, max: 1 },
      evaluator: { kind: "code", module: UNRESOLVABLE, export: "x" },
    },
  ]);
  const failures = await preflightImports(spec, r, "fake.spec.md");
  assert.equal(failures.length, 1);
  assert.match(failures[0].source, /rubric\.criteria\[0\] \(semantic-recall\)\.evaluator\.module/);
});

test("combined: bad target + bad criterion → 2 failures with distinct sources", async () => {
  const spec = specWithTarget({
    kind: "function",
    module: UNRESOLVABLE,
    export: "x",
  });
  const r = rubric([
    {
      id: "good",
      name: "Good",
      description: "d",
      weight: 0.5,
      scale: { kind: "pass-fail" },
      evaluator: { kind: "code", module: RESOLVABLE, export: "echo" },
    },
    {
      id: "bad",
      name: "Bad",
      description: "d",
      weight: 0.5,
      scale: { kind: "pass-fail" },
      evaluator: { kind: "code", module: UNRESOLVABLE, export: "x" },
    },
  ]);
  const failures = await preflightImports(spec, r, "fake.spec.md");
  assert.equal(failures.length, 2);
  const sources = failures.map((f) => f.source);
  assert.ok(sources.includes("spec.target.module"));
  assert.ok(sources.some((s) => s.includes("(bad).evaluator.module")));
});

test("formatPreflightFailures produces a multi-line, indented summary", () => {
  const text = formatPreflightFailures([
    {
      bundlePath: "evals/foo.spec.md",
      source: "spec.target.module",
      module: "./impl.ts",
      error: "Cannot find module './impl.ts'",
    },
  ]);
  assert.match(text, /evals\/foo\.spec\.md/);
  assert.match(text, /spec\.target\.module: cannot resolve '\.\/impl\.ts'/);
  assert.match(text, /Cannot find module/);
});

test("formatPreflightFailures returns empty string when there are no failures", () => {
  assert.equal(formatPreflightFailures([]), "");
});

test("llm-evaluator criteria are NOT preflighted (they make no dynamic import)", async () => {
  const spec = specWithTarget({ kind: "free-form", description: "x" });
  const r = rubric([
    {
      id: "judged",
      name: "Judged",
      description: "d",
      weight: 1,
      scale: { kind: "pass-fail" },
      // No evaluator field at all → defaults to LLM, no module to resolve
    },
  ]);
  const failures = await preflightImports(spec, r, "fake.spec.md");
  assert.equal(failures.length, 0);
});

test("cli + http targets are NOT preflighted (no dynamic module import)", async () => {
  const cli = specWithTarget({ kind: "cli", command: "echo {}" });
  const http = specWithTarget({ kind: "http", url: "https://example.test" });
  assert.equal((await preflightImports(cli, rubric([]), "x")).length, 0);
  assert.equal((await preflightImports(http, rubric([]), "x")).length, 0);
});
