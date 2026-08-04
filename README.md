# Hammurabi

> Spec → rubric → fixtures → runner. A small, opinionated framework for authoring LLM evaluations you'll actually trust.

[![npm](https://img.shields.io/npm/v/@collabb/hammurabi.svg)](https://www.npmjs.com/package/@collabb/hammurabi)

**Status:** alpha (v0.3.0). On-disk loaders, CLI runner, a **multi-provider** judge panel (Anthropic + OpenAI + Google + DeepSeek + Fireworks + any OpenAI-compatible host) **configured in the spec frontmatter**, **deterministic code-scored criteria**, **baseline-aware exit semantics** (known-fail tier), **import-resolution preflight**, baseline regression detection, and a repo-wide `hammurabi-check` CI command are all shipped. Schemas use Zod v4.

## Why

Teams ship faster when they can trust outputs without re-reading every diff. Hammurabi is the connective tissue: a single schema for specs, rubrics, and fixtures that any runner (or downstream tool like [Knack](../knack/)) can consume.

## Install

```sh
npm install @collabb/hammurabi
```

Or run the CLI directly without installing:

```sh
npx @collabb/hammurabi hammurabi-run path/to/foo.spec.md
```

## CLI

Hammurabi ships two bins (available after install via npm bin).

**`hammurabi-run`** — one bundle:

```sh
hammurabi-run path/to/foo.spec.md \
  --aggregator min \
  --filter foo-001,foo-007 \
  --update-baseline
```

The judge panel resolves from the spec's `eval` block (see below); CLI flags
override it. A sibling `foo.baseline.report.json` is auto-discovered for
regression detection (`--no-baseline` to skip, `--update-baseline` to bless a
new one). Writes `foo.report.json` and `foo.report.md` alongside the spec (or in
`--out <dir>`).

**`hammurabi-check`** — every bundle under a directory (the CI entry point):

```sh
hammurabi-check evals/
```

Discovers each `*.spec.md`, runs it against its committed baseline, and
aggregates into one `check-report.json` + a combined exit code.

Exit codes (both bins) are CI-meaningful and **baseline-aware** (since 0.1.1):

- `0` — no NEW failures (vs baseline) and no regressions
- `1` — any new failure (fixture passed in baseline, fails now) or regression
- `2` — could not run (bad args, malformed bundle, runner error, unresolved import)

A fixture failing identically in the committed baseline surfaces as a
`known-fail (baselined)` warning and does NOT break the gate — bundles with
an honest baseline that isn't 100% green can still sit in CI. A baselined
fixture that now passes surfaces as an `improvement` prompt to re-bless via
`--update-baseline`.

Before scoring, both bins **preflight every dynamic import** the bundle uses
(function-target modules + code-evaluator modules). Unresolvable deps exit 2
with a precise message naming the criterion or target. Skip with `--no-preflight`.

Run `hammurabi-run --help` / `hammurabi-check --help` for the full flag list. A
drop-in GitHub Action template lives at `templates/eval-gate.yml`.

## Slash commands

Copy them into any project's `.claude/commands/`:

```sh
cp node_modules/@collabb/hammurabi/commands/*.md .claude/commands/
```

- `/hammurabi <path-to-spec.md>` — 4-step authoring flow: refine spec via Q&A → generate rubric → generate fixtures
- `/hammurabi-run <path-to-spec.md>` — invoke the CLI, then summarize the report in chat (failures, regressions, errored fixtures, judge votes)

## Schema

Three artifact types, all language-neutral on disk:

| Artifact | Format | TS type |
|----------|--------|---------|
| Spec | `*.spec.md` (frontmatter + body) | `Spec` |
| Rubric | `*.rubric.json` | `Rubric` |
| Fixtures | `*.fixtures.jsonl` | `FixtureSet` |

Reports are JSON: `Report` type.

```ts
import type { Spec, Rubric, FixtureSet, Report } from "@collabb/hammurabi/schema";
import { run } from "@collabb/hammurabi/runner";
```

## Authoring guidance

Three patterns that consistently bite first-time bundle authors. Adopt them
before you author the rubric. See [`docs/authoring-guide.md`](./docs/authoring-guide.md)
for the long-form walkthrough.

### Import the contract — never re-encode it

If your target produces output conforming to a schema, JSON spec, or function
signature, **your evaluator should import the same definition the target uses**.
Hand-copying the key list, type shape, or validation rules into the evaluator
guarantees drift the first time the target changes. Common form of the bug:
a `requiredKeys` array drifts out of sync with the source `*.schema.json`, the
gate silently rots, and the rubric reports green for non-conformant output.

### Mirror your production validator's library and config

If the eval mirrors a production validator (`ajv`, `zod`, `joi`, …), pin the
**same major version** the production code uses and apply the **same config**
(`formats`, `coerceTypes`, `strict`, …). An ajv 8 evaluator gated against
ajv 6 production code is not the same gate.

### Bundles using external deps must be installed packages

A bundle directory that imports `npm` packages must contain a `package.json`
with the deps declared. Relying on "the parent project happens to hoist it"
breaks the documented `hammurabi-check evals/` use case the moment the bundle
runs in a CI workspace or fresh checkout. Since 0.1.1, both CLI bins preflight
every dynamic import before scoring and emit a precise error pointing at the
offending criterion or target — the root-cause fix is still a declared dep.

## The `eval` block — judge panel in the spec frontmatter

How rigorously a spec is judged — the **size and reasoning of the panel** —
lives in the spec's frontmatter `eval` block, so it's version-controlled and
reviewable rather than an ephemeral CLI flag:

```yaml
---
name: trade-sizer
version: "1.0.0"
description: ...
target: { kind: http, url: https://... }
eval:
  riskTier: critical          # shorthand → a default cross-provider panel
  aggregator: min             # any single judge flagging a problem fails it
  generatorProvider: anthropic # warns if a judge shares this provider
  judges:                     # ...or spell the panel out explicitly
    - { provider: anthropic, model: claude-opus-4-8,   role: primary,    reasoning: high }
    - { provider: openai,    model: gpt-4o,            role: secondary,  reasoning: none }
    - { provider: google,    model: gemini-2.5-pro,    role: tiebreaker, reasoning: medium }
---
```

- **`riskTier`** (`low` | `medium` | `high` | `critical`) expands to a default
  panel via `RISK_TIER_PRESETS` — higher tier means more judges, more providers,
  more reasoning, more conservative aggregation. Override any of it with explicit
  `judges` / `aggregator`. The presets use Anthropic/OpenAI/Google only;
  **DeepSeek, Fireworks and `openai_compatible` are opt-in** — add them via an
  explicit `judges` entry.
- **`reasoning`** (`none` | `low` | `medium` | `high` | a token budget) maps to
  each provider's mechanism: Anthropic extended thinking, OpenAI
  `reasoning_effort`, Gemini thinking budget, DeepSeek `deepseek-reasoner`.
- **Cross-provider bias mitigation** — no judge should share the output's
  provider (same-family models rate their own style leniently). Set
  `generatorProvider` and the runner warns when a judge collides with it.

Resolution precedence: CLI/`RunOptions` override **>** `eval.judges` **>**
`eval.riskTier` preset **>** a single default Haiku judge.

### Providers

| Provider | Key env var | Base URL | Notes |
| --- | --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | `AI_GATEWAY_URL` override | Native structured output + extended thinking. Default judge. |
| `openai` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` override | Strict `json_schema` mode; `reasoning_effort` on o-series/gpt-5. |
| `google` | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | — | JSON mime type + thinking budget. |
| `deepseek` | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` override | Native DeepSeek API (OpenAI wire format). |
| `fireworks` | `FIREWORKS_API_KEY` | `https://api.fireworks.ai/inference/v1` (override: `FIREWORKS_BASE_URL`) | First-class Fireworks serving. Model strings pass to the wire **verbatim** (`accounts/fireworks/models/...`). |
| `openai_compatible` | the judge entry's `api_key_env` | the judge entry's `base_url` (required) | Escape hatch for any OpenAI-compatible host (Together, vLLM, a gateway, …). |

`fireworks` needs nothing but the key; `openai_compatible` names its endpoint
and key env var **in the judge entry itself**, so one panel can mix several
hosts:

```yaml
eval:
  judges:
    - provider: fireworks
      model: accounts/fireworks/models/deepseek-v3p1
      role: primary
    - provider: openai_compatible
      model: kimi-k2-instruct
      base_url: https://llm.example.com/v1
      api_key_env: EXAMPLE_LLM_KEY
      role: secondary
```

`base_url`/`api_key_env` are required for `openai_compatible` and rejected on
every other provider (their endpoints are built in). A missing key env var
fails loud at call time, naming the variable. Both providers send the exact
request shape proven out on DeepSeek-via-Fireworks: non-reasoning calls pin
`reasoning_effort: "none"`, `temperature: 0` and schema-constrained JSON-object
mode; thinking calls omit temperature/response_format and pin the JSON shape
via the prompt.

Set the provider keys you use: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `FIREWORKS_API_KEY`. Base-URL overrides
are **per provider** and each only redirects its own provider's traffic:
`AI_GATEWAY_URL` (Anthropic), `OPENAI_BASE_URL` (OpenAI), `DEEPSEEK_BASE_URL`
(DeepSeek), `FIREWORKS_BASE_URL` (Fireworks). There is no single variable that
routes every provider through one gateway.

> **Deprecated: the `DEEPSEEK_*` env-remap pattern.** Pointing
> `DEEPSEEK_BASE_URL` at a non-native OpenAI-compatible host (e.g. Fireworks)
> still works — non-reasoning judges send `reasoning_effort: "none"` and
> schema-constrained JSON-object mode, while native DeepSeek calls (unset base
> URL or `https://api.deepseek.com`) keep their unchanged shape. But it remaps
> *every* deepseek judge at once through the environment, invisibly to the
> spec. Prefer `provider: fireworks` (or `provider: openai_compatible` for
> other hosts): same wire shape, declared in the spec frontmatter where it's
> version-controlled and reviewable. Closes
> [#16](https://github.com/collabb-innovations/hammurabi/issues/16).

## Deterministic (code-scored) criteria

Reserve the judge panel for judgment calls; let code check what code can check
exactly (recall, presence, format, latency). A criterion with a `code`
evaluator is scored by importing a function — no judge call, perfectly
reproducible:

```json
{
  "id": "semantic-recall",
  "name": "Semantic recall",
  "description": "Fraction of must-include elements present in the top-N.",
  "weight": 0.35,
  "scale": { "kind": "ordinal", "min": 0, "max": 1 },
  "evaluator": { "kind": "code", "module": "./evaluators.ts", "export": "semanticRecall" }
}
```

The export receives `{ input, expected, output, fixture }` and returns a number
or `{ score, reasoning }` in the criterion's scale. LLM and code criteria mix
freely in one rubric; a rubric with no LLM criteria makes zero API calls.

## Scoping a criterion to some fixtures — `appliesTo`

Some targets emit more than one shape: a success response and an error
response, or several ops behind one CLI. A criterion written for one of them
has nothing to say about the others, and there is no good way to express that
in prose. Ask a judge to abstain and it does so unreliably — judges
intermittently score 0 while their own reasoning says the rule calls for a
pass. Don't ask, and the criterion grades output it was never meant to see,
consistently low.

`appliesTo` says it in the rubric instead. A criterion listing tags applies
only to fixtures carrying at least one of them:

```json
{
  "id": "partition-integrity",
  "name": "Every parsed seed lands in exactly one bucket",
  "weight": 0.2,
  "scale": { "kind": "ordinal", "min": 0, "max": 1 },
  "appliesTo": ["collect"]
}
```

```jsonl
{"id": "parses-a-listing",  "input": {...}, "tags": ["parse"]}
{"id": "collects-a-page",   "input": {...}, "tags": ["collect"]}
```

Omit `appliesTo` and the criterion applies to every fixture — the default, and
what every existing rubric does.

An inapplicable criterion is dropped before scoring: **no judge call is made**,
and the fixture's weighted score is renormalised over the criteria that do
apply. That renormalisation is the point. Weights sum to 1.0 across the whole
rubric, so without it a fixture where 3 of 6 criteria apply is divided by
weight that was never in play, and a perfect answer caps at 0.5.

Two things it is deliberately not:

- **Not omission.** A judge declining to score is a malfunction — excluded from
  the aggregate, and a criterion no judge scored errors the fixture. That
  loudness is right for "cannot evaluate" and wrong for "does not apply".
  Inapplicable criteria are listed in each `FixtureResult.inapplicable` and
  rendered in the report, so sitting out is visible rather than merely absent.
- **Not a substitute for splitting a bundle.** If a rubric's criteria fall into
  disjoint groups over disjoint fixtures, that is usually two behaviours and
  two bundles. `appliesTo` is for the criteria that genuinely straddle one.

An `appliesTo` tag no fixture in the bundle carries is a load-time error — a
typo would otherwise disable the criterion everywhere while the run stays
green, which reads exactly like coverage.

## Runner

```ts
import { run } from "@collabb/hammurabi";

const report = await run({
  spec,      // panel comes from spec.frontmatter.eval unless overridden here
  rubric,
  fixtures,
  judges: [{ provider: "anthropic", model: "claude-haiku-4-5" }], // optional override
  aggregator: "min",
  baseline: previousReport,
});
```

### Judge panel

The runner judges each fixture's output with a **configurable panel of LLMs**, normally authored in the spec's [`eval` block](#the-eval-block--judge-panel-in-the-spec-frontmatter). These `RunOptions` override it for a one-off run. Default (no eval block, no override) is a single Haiku 4.5 judge.

| Option | Default | Notes |
|---|---|---|
| `judges` | from `eval` block, else `[{ provider: "anthropic", model: "claude-haiku-4-5" }]` | Array of judge configs (`provider`, `model`, `role`, `reasoning`, `weight`). Panel calls run in parallel per fixture. |
| `aggregator` | `"mean"` | `"mean" \| "median" \| "min" \| "max"` or a custom `(scores: number[]) => number`. Risk-sensitive callers should use `"min"`. |
| `regressionThreshold` | `0.05` | Per-fixture weighted-score delta below which a regression is flagged vs the baseline. |
| `execute` | — | Required for `target.kind === "free-form"`. Custom executor that returns the output for a given input. |

**Cost note**: panel size multiplies cost linearly. A 2-judge panel costs 2× a 1-judge panel. Wall-clock latency is roughly constant (panel calls run in parallel via `Promise.all`).

### Audit trail

Each `CriterionScore` in the report preserves the full panel's votes:

```ts
{
  criterionId: "is-uppercase",
  score: 0.5,                     // aggregated
  reasoning: "[claude-haiku-4-5] ...\n\n[claude-sonnet-4-6] ...",
  judgeVotes: [
    { model: "claude-haiku-4-5", score: 1, reasoning: "..." },
    { model: "claude-sonnet-4-6", score: 0, reasoning: "..." },
  ],
}
```

If a judge errors or omits a criterion, its vote still lands in `judgeVotes`
with an `error` field — but it is **excluded from the aggregate**, so a
transient failure can never fabricate a low score and a false regression. A
criterion that *no* judge could score marks the fixture errored (⚠), never
failed (✗), and still trips a non-zero CI exit so it can't pass silently.

## Target kinds

`Spec.frontmatter.target` is a tagged union:

| `kind` | Required fields | How the runner executes |
|---|---|---|
| `cli` | `command` | Shell-exec; fixture input is piped to stdin as JSON; stdout parsed as JSON (falls back to plain text). |
| `function` | `module`, `export` | Dynamic `import(module)`, calls `module[export](input)`. Module path should be importable from the caller's resolution context. |
| `http` | `url`, optional `method` (default `POST`) | `fetch` with `application/json` body. |
| `free-form` | `description` | Calls `options.execute(input)`. Required when `kind` is `free-form`. |

## Smoke test

```sh
npm install
npm run smoke
```

Requires `ANTHROPIC_API_KEY` (and optionally `AI_GATEWAY_URL` for Cloudflare AI Gateway routing).

Panel smoke:

```sh
HAMMURABI_SMOKE_JUDGES="claude-haiku-4-5,claude-sonnet-4-6" HAMMURABI_SMOKE_AGGREGATOR=min npm run smoke
```

Expected cost: ~$0.02 for a single-judge run, ~$0.10 for a 2-judge panel including Sonnet.

## Layout

```
hammurabi/
├── src/
│   ├── schema/       # Spec, Rubric, Fixture, Report types
│   ├── loaders/      # On-disk parsers (*.spec.md, *.rubric.json, *.fixtures.jsonl)
│   ├── runner/       # Execute fixtures + judge panel + score
│   ├── cli/          # hammurabi-run CLI + Report → markdown renderer
│   └── index.ts
├── commands/         # /hammurabi, /hammurabi-run
├── examples/smoke/   # End-to-end smoke (inline + disk variants)
├── tests/            # Unit tests (tsx --test)
└── plans/            # Approved implementation plans
```
