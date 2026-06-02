import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { formatZodIssues } from "../src/loaders/errors.js";

test("formatZodIssues joins multiple issues with semicolons", () => {
  const Schema = z.object({ a: z.string(), b: z.number() }).strict();
  const result = Schema.safeParse({ a: 1, b: "two" });
  assert.equal(result.success, false);
  if (!result.success) {
    const msg = formatZodIssues(result.error.issues);
    assert.ok(msg.includes("a:"));
    assert.ok(msg.includes("b:"));
    assert.ok(msg.includes(";"));
  }
});

test("formatZodIssues labels root-level issues as <root>", () => {
  const Schema = z.string();
  const result = Schema.safeParse(42);
  assert.equal(result.success, false);
  if (!result.success) {
    const msg = formatZodIssues(result.error.issues);
    assert.ok(msg.startsWith("<root>:"));
  }
});
