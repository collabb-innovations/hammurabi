import { test } from "node:test";
import assert from "node:assert/strict";
import { executeFixture } from "../src/runner/execute.js";
import type { SpecTarget } from "../src/schema/spec.js";

// Absolute file:// URL so dynamic import() resolves the same regardless of
// which module issues it (mirrors what the spec loader produces).
const targetUrl = new URL("./_exec-target.ts", import.meta.url).href;

test("function target calls the named export and returns its output", async () => {
  const target: SpecTarget = {
    kind: "function",
    module: targetUrl,
    export: "echo",
  };
  const { output, error } = await executeFixture(target, "abc");
  assert.equal(error, undefined);
  assert.equal(output, "abc");
});

test("function target errors when the export is not a function", async () => {
  const target: SpecTarget = {
    kind: "function",
    module: targetUrl,
    export: "notAFunction",
  };
  const { error } = await executeFixture(target, "abc");
  assert.match(error ?? "", /not a function/);
});

test("function target surfaces a throw from the target as an error", async () => {
  const target: SpecTarget = {
    kind: "function",
    module: targetUrl,
    export: "boom",
  };
  const { error } = await executeFixture(target, null);
  assert.match(error ?? "", /boom/);
});

test("free-form target requires an execute callback", async () => {
  const target: SpecTarget = { kind: "free-form", description: "do a thing" };
  const { output, error } = await executeFixture(target, "x");
  assert.equal(output, null);
  assert.match(error ?? "", /free-form/);
});

test("free-form target runs the provided callback", async () => {
  const target: SpecTarget = { kind: "free-form", description: "do a thing" };
  const { output, error } = await executeFixture(
    target,
    { n: 2 },
    async (input) => ({ doubled: (input as { n: number }).n * 2 }),
  );
  assert.equal(error, undefined);
  assert.deepEqual(output, { doubled: 4 });
});

test("free-form callback errors are caught", async () => {
  const target: SpecTarget = { kind: "free-form", description: "do a thing" };
  const { error } = await executeFixture(target, "x", async () => {
    throw new Error("callback failed");
  });
  assert.match(error ?? "", /callback failed/);
});

test("http target posts JSON and parses the response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const target: SpecTarget = { kind: "http", url: "https://example.test/x" };
    const { output, error } = await executeFixture(target, { a: 1 });
    assert.equal(error, undefined);
    assert.deepEqual(output, { ok: true });
  } finally {
    globalThis.fetch = original;
  }
});

test("http target surfaces a non-2xx response as an error", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("nope", { status: 500, statusText: "Server Error" })) as typeof fetch;
  try {
    const target: SpecTarget = { kind: "http", url: "https://example.test/x" };
    const { error } = await executeFixture(target, {});
    assert.match(error ?? "", /HTTP 500/);
  } finally {
    globalThis.fetch = original;
  }
});

test("cli target pipes input to stdin and parses stdout", async () => {
  // `cat` echoes stdin (the JSON-encoded input) back to stdout.
  const target: SpecTarget = { kind: "cli", command: "cat" };
  const { output, error } = await executeFixture(target, "abc");
  assert.equal(error, undefined);
  assert.equal(output, "abc");
});

test("cli target reports a non-zero exit code as an error", async () => {
  const target: SpecTarget = { kind: "cli", command: "exit 7" };
  const { error } = await executeFixture(target, "x");
  assert.match(error ?? "", /cli exited 7/);
});

/**
 * A target that exits without draining stdin leaves the runner writing to a
 * dead pipe. The one-byte case ("x" above) is a race the write usually wins,
 * which is why it only failed intermittently (#25). An input larger than the
 * OS pipe buffer cannot be absorbed by a departed reader, so this pins the
 * failure deterministically: without an `error` handler on stdin, the EPIPE is
 * unhandled, throws, and escapes executeCli's promise entirely.
 */
test("cli target that exits without reading stdin still reports its exit code", async () => {
  const target: SpecTarget = { kind: "cli", command: "exit 7" };
  // Comfortably past the 64KiB pipe buffer.
  const bigInput = "y".repeat(1_000_000);
  const { error } = await executeFixture(target, bigInput);
  assert.match(error ?? "", /cli exited 7/);
});

test("cli target that ignores stdin but succeeds still returns its output", async () => {
  const target: SpecTarget = { kind: "cli", command: "echo '\"done\"'" };
  const { output, error } = await executeFixture(target, "z".repeat(1_000_000));
  assert.equal(error, undefined);
  assert.equal(output, "done");
});
