import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBundle, loadAll } from "../src/loaders/bundle.js";

const specBody = `---
name: foo
version: "1.0.0"
description: A foo
target:
  kind: free-form
  description: x
---

body
`;

const rubric = {
  specName: "foo",
  specVersion: "1.0.0",
  passThreshold: 0.5,
  criteria: [
    {
      id: "c1",
      name: "C1",
      description: "x",
      weight: 1.0,
      scale: { kind: "pass-fail" },
    },
  ],
};

const fixtures = `{"specName":"foo","specVersion":"1.0.0"}
{"id":"a","input":"x"}
`;

async function writeBundle(suffix: ".spec.md" | ".md", overrides: {
  rubricSpecName?: string;
  rubricSpecVersion?: string;
  fixturesSpecName?: string;
  fixturesSpecVersion?: string;
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hammurabi-bundle-"));
  const specPath = join(dir, `foo${suffix}`);
  await writeFile(specPath, specBody);
  const r = {
    ...rubric,
    specName: overrides.rubricSpecName ?? rubric.specName,
    specVersion: overrides.rubricSpecVersion ?? rubric.specVersion,
  };
  await writeFile(join(dir, "foo.rubric.json"), JSON.stringify(r));
  const fixturesContent =
    overrides.fixturesSpecName || overrides.fixturesSpecVersion
      ? `{"specName":"${overrides.fixturesSpecName ?? "foo"}","specVersion":"${overrides.fixturesSpecVersion ?? "1.0.0"}"}\n{"id":"a","input":"x"}\n`
      : fixtures;
  await writeFile(join(dir, "foo.fixtures.jsonl"), fixturesContent);
  return { dir, specPath };
}

test("loadBundle derives siblings for *.spec.md", async () => {
  const { specPath } = await writeBundle(".spec.md");
  const b = await loadBundle(specPath);
  assert.equal(b.spec.frontmatter.name, "foo");
  assert.equal(b.rubric.criteria.length, 1);
  assert.equal(b.fixtures.fixtures.length, 1);
});

test("loadBundle derives siblings for *.md (no .spec)", async () => {
  const { specPath } = await writeBundle(".md");
  const b = await loadBundle(specPath);
  assert.equal(b.spec.frontmatter.name, "foo");
});

test("loadBundle throws when rubric.specName mismatches spec.name", async () => {
  const { specPath } = await writeBundle(".spec.md", {
    rubricSpecName: "wrong",
  });
  await assert.rejects(loadBundle(specPath), /rubric\.specName/);
});

test("loadBundle throws when fixtures.specVersion mismatches spec.version", async () => {
  const { specPath } = await writeBundle(".spec.md", {
    fixturesSpecVersion: "9.9.9",
  });
  await assert.rejects(loadBundle(specPath), /fixtures\.specVersion/);
});

test("loadBundle reports multiple mismatches together", async () => {
  const { specPath } = await writeBundle(".spec.md", {
    rubricSpecName: "wrong",
    fixturesSpecName: "alsowrong",
  });
  await assert.rejects(
    loadBundle(specPath),
    (err: Error) =>
      err.message.includes("rubric.specName") &&
      err.message.includes("fixtures.specName"),
  );
});

test("loadAll accepts explicit paths", async () => {
  const { dir, specPath } = await writeBundle(".spec.md");
  const b = await loadAll(
    specPath,
    join(dir, "foo.rubric.json"),
    join(dir, "foo.fixtures.jsonl"),
  );
  assert.equal(b.spec.frontmatter.name, "foo");
});
