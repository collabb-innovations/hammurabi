import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod/v4";
import { zodOutputFormatV4 } from "../src/runner/zod-format.js";

test("zodOutputFormatV4 produces a json_schema output format", () => {
  const Schema = z.object({
    passed: z.boolean(),
    reasoning: z.string(),
  });
  const fmt = zodOutputFormatV4(Schema);
  assert.equal(fmt.type, "json_schema");
  assert.ok(fmt.schema && typeof fmt.schema === "object");
});

test("zodOutputFormatV4 strips number range keywords Anthropic rejects", () => {
  // The Anthropic structured-output endpoint rejects `minimum`/`maximum` on
  // number-typed fields with "For 'number' type, properties maximum, minimum
  // are not supported". The SDK's helper sanitizes these via an internal
  // transform; this test guards that we still inherit that behavior.
  const Schema = z.object({
    score: z.number().min(0).max(1),
  });
  const fmt = zodOutputFormatV4(Schema);
  const json = JSON.stringify(fmt.schema);
  assert.ok(!json.includes('"minimum"'), `unexpected 'minimum' in ${json}`);
  assert.ok(!json.includes('"maximum"'), `unexpected 'maximum' in ${json}`);
});

test("zodOutputFormatV4 parses valid output through the v4 schema", () => {
  const Schema = z.object({
    scores: z.array(
      z.object({
        criterionId: z.string(),
        score: z.number(),
        reasoning: z.string(),
      }),
    ),
  });
  const fmt = zodOutputFormatV4(Schema);
  const parsed = fmt.parse(
    JSON.stringify({
      scores: [{ criterionId: "c1", score: 2, reasoning: "ok" }],
    }),
  );
  assert.equal(parsed.scores.length, 1);
  assert.equal(parsed.scores[0].criterionId, "c1");
});

test("zodOutputFormatV4 rejects output that fails v4 validation", () => {
  const Schema = z.object({ passed: z.boolean() });
  const fmt = zodOutputFormatV4(Schema);
  assert.throws(() => fmt.parse(JSON.stringify({ passed: "not a bool" })));
});
