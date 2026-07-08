import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSpec, parseSpec } from "../src/loaders/spec.js";

const VALID = `---
name: foo
version: "1.0.0"
description: A foo
target:
  kind: free-form
  description: a free-form target
---

body content
`;

test("parseSpec accepts a valid spec", () => {
  const spec = parseSpec(VALID);
  assert.equal(spec.frontmatter.name, "foo");
  assert.equal(spec.frontmatter.version, "1.0.0");
  assert.equal(spec.frontmatter.target.kind, "free-form");
  assert.equal(spec.body, "body content");
});

test("parseSpec rejects missing name", () => {
  const content = `---
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
---
`;
  assert.throws(() => parseSpec(content), /name/);
});

test("parseSpec rejects missing target", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
---
`;
  assert.throws(() => parseSpec(content), /target/);
});

test("parseSpec rejects YAML-parsed numeric version with quoting hint", () => {
  const content = `---
name: foo
version: 1.0
description: x
target:
  kind: free-form
  description: x
---
`;
  // YAML/gray-matter parses `1.0` as the integer 1 (drops the trailing .0).
  // The error should call out the type and suggest quoting; it can't
  // recover the author's original literal.
  assert.throws(
    () => parseSpec(content, "foo.spec.md"),
    /must be a quoted string/,
  );
  assert.throws(() => parseSpec(content, "foo.spec.md"), /number/);
});

test("parseSpec rejects YAML-parsed numeric name with quoting hint", () => {
  const content = `---
name: 42
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
---
`;
  assert.throws(() => parseSpec(content), /must be a quoted string/);
});

test("parseSpec rejects unknown frontmatter fields (strict mode)", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
extraField: nope
target:
  kind: free-form
  description: x
---
`;
  assert.throws(() => parseSpec(content), /extraField/);
});

test("loadSpec resolves './impl.ts' relative to spec dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hammurabi-spec-"));
  const specPath = join(dir, "foo.spec.md");
  await writeFile(
    specPath,
    `---
name: foo
version: "1.0.0"
description: x
target:
  kind: function
  module: ./impl.ts
  export: run
---
`,
  );
  const spec = await loadSpec(specPath);
  assert.equal(spec.frontmatter.target.kind, "function");
  if (spec.frontmatter.target.kind === "function") {
    assert.equal(
      spec.frontmatter.target.module,
      pathToFileURL(join(dir, "impl.ts")).href,
    );
  }
});

test("loadSpec resolves bare-relative 'impl.ts' (no leading './')", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hammurabi-spec-"));
  const specPath = join(dir, "foo.spec.md");
  await writeFile(
    specPath,
    `---
name: foo
version: "1.0.0"
description: x
target:
  kind: function
  module: impl.ts
  export: run
---
`,
  );
  const spec = await loadSpec(specPath);
  if (spec.frontmatter.target.kind === "function") {
    assert.equal(
      spec.frontmatter.target.module,
      pathToFileURL(join(dir, "impl.ts")).href,
    );
  } else {
    assert.fail("expected function target");
  }
});

test("loadSpec resolves subdir relative 'targets/impl.ts'", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hammurabi-spec-"));
  const specPath = join(dir, "foo.spec.md");
  await writeFile(
    specPath,
    `---
name: foo
version: "1.0.0"
description: x
target:
  kind: function
  module: targets/impl.ts
  export: run
---
`,
  );
  const spec = await loadSpec(specPath);
  if (spec.frontmatter.target.kind === "function") {
    assert.equal(
      spec.frontmatter.target.module,
      pathToFileURL(join(dir, "targets/impl.ts")).href,
    );
  } else {
    assert.fail("expected function target");
  }
});

test("loadSpec leaves bare npm specifier 'lodash' alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hammurabi-spec-"));
  const specPath = join(dir, "foo.spec.md");
  await writeFile(
    specPath,
    `---
name: foo
version: "1.0.0"
description: x
target:
  kind: function
  module: lodash
  export: identity
---
`,
  );
  const spec = await loadSpec(specPath);
  if (spec.frontmatter.target.kind === "function") {
    assert.equal(spec.frontmatter.target.module, "lodash");
  } else {
    assert.fail("expected function target");
  }
});

test("loadSpec leaves URL-scheme 'file://' alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hammurabi-spec-"));
  const specPath = join(dir, "foo.spec.md");
  const url = "file:///some/abs/impl.ts";
  await writeFile(
    specPath,
    `---
name: foo
version: "1.0.0"
description: x
target:
  kind: function
  module: ${url}
  export: run
---
`,
  );
  const spec = await loadSpec(specPath);
  if (spec.frontmatter.target.kind === "function") {
    assert.equal(spec.frontmatter.target.module, url);
  } else {
    assert.fail("expected function target");
  }
});

test("parseSpec accepts an eval block with an explicit judge panel", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  riskTier: high
  aggregator: min
  regressionThreshold: 0.03
  generatorProvider: openai
  judges:
    - provider: anthropic
      model: claude-sonnet-4-6
      role: primary
      reasoning: medium
    - provider: google
      model: gemini-2.5-flash
      role: secondary
      reasoning: 2048
      weight: 0.5
---
`;
  const spec = parseSpec(content);
  assert.equal(spec.frontmatter.eval?.riskTier, "high");
  assert.equal(spec.frontmatter.eval?.aggregator, "min");
  assert.equal(spec.frontmatter.eval?.judges?.length, 2);
  assert.equal(spec.frontmatter.eval?.judges?.[1].reasoning, 2048);
});

test("parseSpec accepts an eval block that is just a risk tier", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  riskTier: low
---
`;
  const spec = parseSpec(content);
  assert.equal(spec.frontmatter.eval?.riskTier, "low");
  assert.equal(spec.frontmatter.eval?.judges, undefined);
});

test("parseSpec accepts a deepseek judge", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  judges:
    - provider: deepseek
      model: deepseek-chat
      role: primary
---
`;
  const spec = parseSpec(content);
  assert.equal(spec.frontmatter.eval?.judges?.[0].provider, "deepseek");
});

test("parseSpec accepts a fireworks judge with the model string kept verbatim", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  judges:
    - provider: fireworks
      model: accounts/fireworks/models/deepseek-v3p1
      role: primary
---
`;
  const spec = parseSpec(content);
  assert.equal(spec.frontmatter.eval?.judges?.[0].provider, "fireworks");
  assert.strictEqual(
    spec.frontmatter.eval?.judges?.[0].model,
    "accounts/fireworks/models/deepseek-v3p1",
  );
});

test("parseSpec accepts an openai_compatible judge with base_url and api_key_env", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  judges:
    - provider: openai_compatible
      model: kimi-k2-instruct
      base_url: https://llm.example.com/v1
      api_key_env: EXAMPLE_LLM_KEY
---
`;
  const spec = parseSpec(content);
  const judge = spec.frontmatter.eval?.judges?.[0];
  assert.equal(judge?.provider, "openai_compatible");
  assert.equal(judge?.base_url, "https://llm.example.com/v1");
  assert.equal(judge?.api_key_env, "EXAMPLE_LLM_KEY");
});

test("parseSpec rejects openai_compatible missing base_url", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  judges:
    - provider: openai_compatible
      model: kimi-k2-instruct
      api_key_env: EXAMPLE_LLM_KEY
---
`;
  assert.throws(() => parseSpec(content), /base_url is required/);
});

test("parseSpec rejects openai_compatible missing api_key_env", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  judges:
    - provider: openai_compatible
      model: kimi-k2-instruct
      base_url: https://llm.example.com/v1
---
`;
  assert.throws(() => parseSpec(content), /api_key_env is required/);
});

test("parseSpec rejects base_url/api_key_env on a fireworks judge", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  judges:
    - provider: fireworks
      model: accounts/fireworks/models/deepseek-v3p1
      base_url: https://llm.example.com/v1
      api_key_env: EXAMPLE_LLM_KEY
---
`;
  assert.throws(
    () => parseSpec(content),
    /only allowed when provider is "openai_compatible"/,
  );
});

test("parseSpec rejects base_url/api_key_env on a deepseek judge", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  judges:
    - provider: deepseek
      model: deepseek-chat
      base_url: https://llm.example.com/v1
---
`;
  assert.throws(
    () => parseSpec(content),
    /only allowed when provider is "openai_compatible"/,
  );
});

test("parseSpec rejects an unknown judge provider", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  judges:
    - provider: cohere
      model: command-r
---
`;
  assert.throws(() => parseSpec(content), /provider/);
});

test("parseSpec rejects unknown fields inside the eval block (strict)", () => {
  const content = `---
name: foo
version: "1.0.0"
description: x
target:
  kind: free-form
  description: x
eval:
  riskTier: low
  bogus: nope
---
`;
  assert.throws(() => parseSpec(content), /bogus/);
});

test("loadSpec converts absolute POSIX path to file:// URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hammurabi-spec-"));
  const specPath = join(dir, "foo.spec.md");
  await writeFile(
    specPath,
    `---
name: foo
version: "1.0.0"
description: x
target:
  kind: function
  module: /abs/path/impl.ts
  export: run
---
`,
  );
  const spec = await loadSpec(specPath);
  if (spec.frontmatter.target.kind === "function") {
    assert.equal(
      spec.frontmatter.target.module,
      pathToFileURL("/abs/path/impl.ts").href,
    );
  } else {
    assert.fail("expected function target");
  }
});
