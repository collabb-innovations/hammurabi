---
description: Refine a spec via Q&A, then generate a rubric, fixtures, and judge-panel config for review
argument-hint: "<path-to-spec.md>"
---

Drive a spec through Hammurabi's authoring flow. Each step gates on user approval before moving on.

**Target spec:** $ARGUMENTS

If no argument is provided, ask the user for a path to a markdown spec (or offer to scaffold a blank one at `./hammurabi/<name>.spec.md`).

## Step 1: Read the spec

Read the target file. Confirm it has frontmatter with at minimum `name`, `version`, `description`, `target`. If frontmatter is missing or malformed, propose a corrected version and confirm before continuing.

## Step 1.5: Bundle hygiene checklist

Before writing the rubric, confirm three things with the user (one batched `AskUserQuestion` round). These are the dominant authoring footguns — the patterns that produce a green gate over non-conformant output.

1. **Does the target produce output against a documented contract** (JSON schema, TS type, OpenAPI spec, function signature)? If yes, locate it. The code-scored criteria in Step 3 will **import** that contract directly — we do not re-encode it in the evaluator. A hand-copied key list drifts the first time the target changes and the gate silently rots.

2. **Will this eval mirror a production validator?** If yes, capture the library + major version + config used in production (e.g. `ajv 8`, `formats: true`, `strict: false`). The evaluator must match. An ajv 8 evaluator gated against ajv 6 production code is not the same gate.

3. **Will the rubric use external npm deps in code-scored criteria?** If yes, the bundle directory must contain a `package.json` with those deps declared. Relying on "the parent project happens to hoist it" breaks the documented `hammurabi-check evals/` use case the moment the bundle runs in a CI workspace or fresh checkout. Hammurabi's preflight (since 0.1.1) catches missing imports loudly, but the root cause is the missing `package.json`.

If any answer reveals a gap, fix it before continuing. See [`docs/authoring-guide.md`](../docs/authoring-guide.md) for the long-form walkthrough.

## Step 2: Push back via Q&A

Identify the weakest points in the spec — vague success criteria, missing edge cases, unclear target, scope ambiguity, conflicting requirements. Surface them as a single `AskUserQuestion` round (3–4 questions max, batched). Don't enumerate trivial nits; pick the gaps that would let bad output sneak past evaluation.

**Include a risk question** in this round: how costly is a bad output that ships undetected? The answer sets the risk tier in Step 5 (`low` / `medium` / `high` / `critical`). Anything touching money, auth, data integrity, or irreversible user-facing actions is `high`+.

Apply the user's answers as edits to the spec file. Show the diff. Confirm acceptance before continuing.

## Step 3: Generate rubric

From the refined spec, produce `<spec-name>.rubric.json` matching the `Rubric` type from `@collabb/hammurabi/schema`:

- 3–7 criteria. Each has: `id` (kebab-case), `name`, `description`, `weight` (sums to 1.0), `scale` (pass-fail or ordinal min/max), optional `judgePrompt` (per-criterion instructions the judge actually receives — use it to disambiguate tricky scoring).
- Set `passThreshold` based on the spec's tolerance for failure.
- **Every criterion must apply to every fixture it will be scored on.** If the target emits more than one output shape (a success and an error; several ops behind one entry point), a criterion written for one of them has nothing to say about the others — and a judge shown output it cannot evaluate grades it low rather than abstaining, no matter how the description is worded. Give such a criterion an `appliesTo: ["<tag>"]` and tag the fixtures to match (Step 4). If the criteria fall into disjoint groups over disjoint fixtures, prefer splitting into two bundles: that is usually two behaviours.

Show the rubric to the user. Ask: which criteria are missing? Which weights are wrong? Iterate until accepted.

## Step 4: Generate fixtures

From the refined spec + accepted rubric, produce `<spec-name>.fixtures.jsonl`:

- **JSONL header** on the first non-blank line: `{"specName": "<name>", "specVersion": "<version>"}` matching the spec's frontmatter exactly. This is required by Hammurabi's loader and is how bundle cross-validation works.
- Each subsequent non-blank line is one `Fixture` object matching the `Fixture` type.
- 6–12 fixtures covering: happy path, named edge cases from the spec, adversarial inputs that target the spec's stated risks, and at least one "this should refuse / fail gracefully" case if applicable.
- Tag fixtures by what they exercise (e.g., `["happy-path"]`, `["edge:empty-input"]`, `["adversarial:injection"]`).
- Include `notes` on fixtures where the judge needs context.

Show the fixtures to the user. Ask: what scenario is missing? Iterate until accepted.

## Step 5: Configure the judge panel (the `eval` block)

Write the panel config into the spec's **frontmatter `eval` block** — its size and reasoning travel with the spec so the eval's rigor is version-controlled and reviewable.

Start from the risk tier captured in Step 2. The simplest valid config is just:

```yaml
eval:
  riskTier: high   # expands to a default cross-provider panel + aggregator
```

For full control, author `judges` explicitly. Shape (`EvalConfig`):

```yaml
eval:
  riskTier: high
  aggregator: mean          # mean | median | min | max. Risk-sensitive ⇒ min.
  regressionThreshold: 0.05 # per-fixture delta below baseline that flags a regression
  generatorProvider: openai # advisory: warns if a judge shares this provider
  judges:
    - { provider: anthropic, model: claude-sonnet-4-6, role: primary,    reasoning: medium }
    - { provider: google,    model: gemini-2.5-flash,  role: secondary,  reasoning: low }
    - { provider: anthropic, model: claude-haiku-4-5,  role: tiebreaker, reasoning: none }
```

Apply these principles when proposing the panel:

- **Cross-provider bias mitigation.** No judge should share the output's provider (`generatorProvider`). A panel mixing Anthropic + Google + OpenAI catches failure modes a single family rates leniently.
- **Size scales with risk.** `low`/`medium` → a single judge. `high`/`critical` → 3 judges across ≥2 providers.
- **Reasoning scales with risk.** `none` for cheap pass/fail tiebreakers; `high` for nuanced or high-stakes scoring.
- **Aggregator scales with risk.** `mean` for typical panels; `min` when any single judge flagging a problem should fail the fixture (money, safety, irreversibility).

If you only set `riskTier`, the runner expands the matching `RISK_TIER_PRESETS` panel — show the user what that expands to so they can accept or override.

Show the proposed `eval` block, explain the cost (panel size × fixtures × judge calls), and confirm before writing it into the frontmatter.

## Step 6: Report

Final output — list the artifacts and their paths, and the resolved panel:

| Artifact | Path |
|----------|------|
| Spec (refined, with `eval` block) | path |
| Rubric | path |
| Fixtures | path |

Remind the user: run these against the target with `/hammurabi-run <spec-path>` (or `npx @collabb/hammurabi hammurabi-run <spec-path>`). The panel resolves from the spec's `eval` block; CLI flags (`--judges`, `--aggregator`) override it for one-off runs.
