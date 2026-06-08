import { test } from "node:test";
import assert from "node:assert/strict";
import { baselinePathFor } from "../src/cli/baseline.js";

test("baselinePathFor derives the sibling baseline from a .spec.md path", () => {
  assert.equal(
    baselinePathFor("/x/y/foo.spec.md"),
    "/x/y/foo.baseline.report.json",
  );
});

test("baselinePathFor handles a plain .md spec", () => {
  assert.equal(baselinePathFor("/x/y/foo.md"), "/x/y/foo.baseline.report.json");
});

test("baselinePathFor keeps the bundle's own directory", () => {
  assert.equal(
    baselinePathFor("evals/search/search.spec.md"),
    "evals/search/search.baseline.report.json",
  );
});
