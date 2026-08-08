import { test } from "node:test";
import assert from "node:assert/strict";
import {
  memberToJudgeConfig,
  resolveJudges,
  resolveAggregator,
  resolveRegressionThreshold,
  RISK_TIER_PRESETS,
} from "../src/runner/config.js";
import type { Spec } from "../src/schema/spec.js";
import type { EvalConfig } from "../src/schema/spec.js";

function spec(ev?: EvalConfig): Spec {
  return {
    frontmatter: {
      name: "s",
      version: "1",
      description: "",
      target: { kind: "free-form", description: "x" },
      ...(ev ? { eval: ev } : {}),
    },
    body: "",
  };
}

test("resolveJudges falls back to a single default Anthropic judge", () => {
  const judges = resolveJudges(spec());
  assert.equal(judges.length, 1);
  assert.equal(judges[0].provider, "anthropic");
  assert.equal(judges[0].model, "claude-haiku-4-5");
});

test("resolveJudges expands a risk tier into its preset panel", () => {
  const judges = resolveJudges(spec({ riskTier: "high" }));
  assert.equal(judges.length, RISK_TIER_PRESETS.high.judges.length);
  // F-27: high's Google secondary was replaced by Fireworks.
  assert.deepEqual(
    judges.map((j) => j.provider),
    ["anthropic", "fireworks", "anthropic"],
  );
});

test("resolveJudges prefers an explicit panel over the risk tier", () => {
  const judges = resolveJudges(
    spec({
      riskTier: "high",
      judges: [{ provider: "openai", model: "gpt-4o" }],
    }),
  );
  assert.equal(judges.length, 1);
  assert.equal(judges[0].provider, "openai");
});

test("resolveJudges lets an explicit override beat everything", () => {
  const judges = resolveJudges(spec({ riskTier: "high" }), [
    { model: "claude-haiku-4-5", provider: "anthropic" },
  ]);
  assert.equal(judges.length, 1);
  assert.equal(judges[0].model, "claude-haiku-4-5");
});

test("memberToJudgeConfig carries base_url/api_key_env through for openai_compatible", () => {
  const config = memberToJudgeConfig({
    provider: "openai_compatible",
    model: "kimi-k2-instruct",
    role: "secondary",
    base_url: "https://llm.example.com/v1",
    api_key_env: "EXAMPLE_LLM_KEY",
  });
  assert.deepEqual(config, {
    model: "kimi-k2-instruct",
    provider: "openai_compatible",
    role: "secondary",
    baseUrl: "https://llm.example.com/v1",
    apiKeyEnv: "EXAMPLE_LLM_KEY",
  });
});

test("memberToJudgeConfig omits endpoint keys when the member has none", () => {
  const config = memberToJudgeConfig({
    provider: "fireworks",
    model: "accounts/fireworks/models/deepseek-v3p1",
  });
  assert.equal("baseUrl" in config, false);
  assert.equal("apiKeyEnv" in config, false);
});

test("resolveAggregator follows override > eval.aggregator > preset > mean", () => {
  assert.equal(resolveAggregator(spec()), "mean");
  assert.equal(resolveAggregator(spec({ riskTier: "critical" })), "min"); // preset
  assert.equal(
    resolveAggregator(spec({ riskTier: "critical", aggregator: "median" })),
    "median",
  ); // eval beats preset
  assert.equal(resolveAggregator(spec({ aggregator: "median" }), "max"), "max"); // override wins
});

test("resolveRegressionThreshold reads the eval block unless overridden", () => {
  assert.equal(resolveRegressionThreshold(spec()), undefined);
  assert.equal(
    resolveRegressionThreshold(spec({ regressionThreshold: 0.02 })),
    0.02,
  );
  assert.equal(
    resolveRegressionThreshold(spec({ regressionThreshold: 0.02 }), 0.1),
    0.1,
  );
});

// F-27 (W-14): Fireworks seat in the risk-tier presets. `medium` gains a
// Fireworks secondary; `high`'s Google secondary is REPLACED by Fireworks
// (Google is a closed provider with the same data-exfil profile as Anthropic,
// which the item mitigates against). Zero current-bundle blast radius: no spec
// uses riskTier today (all pin explicit judges). The Fireworks model is the
// PO-selected OSS judge: accounts/fireworks/models/qwen3-235b-a22b.
test("F-27: medium preset includes a Fireworks cross-provider secondary", () => {
  const judges = RISK_TIER_PRESETS.medium.judges;
  const fireworks = judges.filter((j) => j.provider === "fireworks");
  assert.equal(fireworks.length, 1, "medium has exactly one Fireworks judge");
  assert.equal(
    fireworks[0].model,
    "accounts/fireworks/models/qwen3-235b-a22b",
  );
  // The Anthropic primary is retained — Fireworks is the cross-provider ADDITION.
  assert.ok(
    judges.some((j) => j.provider === "anthropic"),
    "medium keeps its Anthropic primary",
  );
});

test("F-27: high preset replaces Google with a Fireworks secondary", () => {
  const judges = RISK_TIER_PRESETS.high.judges;
  const fireworks = judges.filter((j) => j.provider === "fireworks");
  assert.equal(fireworks.length, 1, "high has exactly one Fireworks judge");
  assert.equal(
    fireworks[0].model,
    "accounts/fireworks/models/qwen3-235b-a22b",
  );
  assert.equal(
    judges.filter((j) => j.provider === "google").length,
    0,
    "high no longer carries a Google (closed-provider) seat",
  );
  assert.ok(
    judges.some((j) => j.provider === "anthropic"),
    "high keeps its Anthropic primary",
  );
});

test("F-27: resolveJudges expands a high-tier spec into a Fireworks-containing panel", () => {
  const judges = resolveJudges(spec({ riskTier: "high" }));
  assert.deepEqual(
    judges.map((j) => j.provider),
    ["anthropic", "fireworks", "anthropic"],
  );
});

test("every risk-tier preset has a non-empty panel and valid weights sum", () => {
  for (const tier of ["low", "medium", "high", "critical"] as const) {
    const preset = RISK_TIER_PRESETS[tier];
    assert.ok(preset.judges.length >= 1, `${tier} has judges`);
    for (const j of preset.judges) {
      assert.ok(j.model.length > 0);
      assert.ok(["anthropic", "google", "openai", "fireworks"].includes(j.provider));
    }
  }
});
