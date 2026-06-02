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
