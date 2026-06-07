import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reasoningToTokens,
  reasoningToOpenAIEffort,
  isReasoningModel,
  parseJudgeJson,
} from "../src/runner/providers.js";

test("reasoningToTokens maps named tiers and passes numbers through", () => {
  assert.equal(reasoningToTokens("none"), 0);
  assert.equal(reasoningToTokens("low"), 1024);
  assert.equal(reasoningToTokens("medium"), 4096);
  assert.equal(reasoningToTokens("high"), 12000);
  assert.equal(reasoningToTokens(2048), 2048);
  assert.equal(reasoningToTokens(-5), 0); // clamped
});

test("reasoningToOpenAIEffort buckets numbers and drops 'none'", () => {
  assert.equal(reasoningToOpenAIEffort("none"), undefined);
  assert.equal(reasoningToOpenAIEffort("low"), "low");
  assert.equal(reasoningToOpenAIEffort("high"), "high");
  assert.equal(reasoningToOpenAIEffort(0), undefined);
  assert.equal(reasoningToOpenAIEffort(1000), "low");
  assert.equal(reasoningToOpenAIEffort(4000), "medium");
  assert.equal(reasoningToOpenAIEffort(9000), "high");
});

test("isReasoningModel recognizes o-series and gpt-5, not gpt-4o", () => {
  assert.equal(isReasoningModel("o1"), true);
  assert.equal(isReasoningModel("o3-mini"), true);
  assert.equal(isReasoningModel("gpt-5"), true);
  assert.equal(isReasoningModel("gpt-4o"), false);
  assert.equal(isReasoningModel("claude-sonnet-4-6"), false);
});

test("parseJudgeJson accepts valid JSON and strips code fences", () => {
  const raw = '```json\n{"scores":[{"criterionId":"a","score":1,"reasoning":"ok"}]}\n```';
  const out = parseJudgeJson(raw, "test");
  assert.equal(out.scores.length, 1);
  assert.equal(out.scores[0].criterionId, "a");
});

test("parseJudgeJson throws on empty output", () => {
  assert.throws(() => parseJudgeJson("   ", "test"), /empty output/);
});

test("parseJudgeJson throws on non-JSON", () => {
  assert.throws(() => parseJudgeJson("not json at all", "test"), /non-JSON/);
});

test("parseJudgeJson throws when the shape fails validation", () => {
  assert.throws(
    () => parseJudgeJson('{"scores":[{"criterionId":"a"}]}', "test"),
    /failed schema/,
  );
});
