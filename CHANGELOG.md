# Changelog

## 0.2.2

### Fixed

- DeepSeek judge on non-native hosts: schema-constrained decoding — response_format now carries the judge JSON schema (follow-up to #17/#18; v0.2.1's reasoning_effort none reduced wrong-shape votes 12/36 → 7/36 on hook.'s LP panels; a captured 123k-char failing request replayed 5/5 valid with the schema attached, 2026-07-08).

## 0.2.1

A targeted DeepSeek compatibility patch for OpenAI-compatible hosts that serve
thinking-by-default models.

### Fixed

- DeepSeek judges now send `reasoning_effort: "none"` for non-reasoning calls
  only when `DEEPSEEK_BASE_URL` points at a non-native host, keeping native
  DeepSeek API requests unchanged while disabling default thinking on Fireworks.
  Fixes #17.

## 0.2.0

A minor release adding a fourth judge provider. No schema break — existing
specs and baselines are a drop-in upgrade from 0.1.1.

### Added

- **DeepSeek as a judge provider** (`provider: deepseek`). DeepSeek's API is
  OpenAI-compatible, so the judge handler reuses the existing `openai` SDK
  pointed at DeepSeek's endpoint — no new dependency. Configure with
  `DEEPSEEK_API_KEY` (and optional `DEEPSEEK_BASE_URL`). Reasoning is honored
  both via the intrinsically-reasoning `deepseek-reasoner` alias and via a
  configured `reasoning` effort on hybrid models (mapped to OpenAI-style
  `reasoning_effort`). DeepSeek is **opt-in** — add it as an explicit `judges`
  entry; the `riskTier` presets are unchanged. (#15)

### Docs

- Clarified that base-URL overrides are per provider and each only redirects
  its own provider's traffic (`AI_GATEWAY_URL` → Anthropic, `OPENAI_BASE_URL`
  → OpenAI, `DEEPSEEK_BASE_URL` → DeepSeek).

## 0.1.1

A patch driven by signal from the first wave of bundle authors. No schema
change, no API break — drop-in upgrade from 0.1.0.

### Changed (policy)

- **`hammurabi-run` and `hammurabi-check` exit codes are now baseline-aware.**
  Exit 1 fires on **new failures** (fixture passed in baseline, fails now) and
  regressions — not on baselined-still-failing fixtures. A bundle whose
  honest baseline contains legitimate red fixtures can now sit in a CI gate.
  The previous behavior ("exit 1 if any fixture currently fails") forced
  teams to either quarantine fixtures or scope the gate to changed bundles
  only; both are anti-patterns Hammurabi exists to prevent. Baselined-failing
  fixtures surface as `known-fail (baselined)` warnings. A baselined fixture
  that now passes surfaces as an `improvement` prompt to re-bless with
  `--update-baseline`. (#12 — continuum F-326, `mood-board-search`)

### Added

- **Import-resolution preflight.** Both CLI bins dry-import every dynamic
  module the bundle loads — the function-target's module and every
  code-evaluator criterion's module — BEFORE scoring. Unresolved deps exit 2
  with a precise message naming the criterion or target and the failing
  module. Catches the silent-mid-scoring-failure trap from continuum#248
  round 4 (a bundle whose `ajv` import resolved only via incidental hoist to
  the wrong major). Skip with `--no-preflight`. (#8)
- **Combined `check-report.json`** entries gain `newFailures`, `knownFailures`,
  and `improvements` counts per bundle.
- **`--no-preflight`** flag on `hammurabi-run` and `hammurabi-check`.
- **`docs/authoring-guide.md`** — long-form walkthrough of the three
  authoring footguns from the continuum#248 adversarial review. Packaged in
  the npm tarball. (#11)
- **`/hammurabi` Step 1.5** — bundle hygiene checklist runs before rubric
  authoring on every new bundle. (#11)

### Docs

- README gains a top-level "Authoring guidance" section. (#11)
- README's CLI section documents the new baseline-aware exit codes and the
  preflight behavior.

## 0.1.0

The SDLC release: judge panels are now authored, multi-provider, and
deterministic where they can be — and a whole repo of bundles runs in one CI
command.

### Added

- **Judge-panel config in the spec frontmatter** (`eval` block). Size and
  reasoning of the panel travel with the spec, version-controlled: `riskTier`
  shorthand, explicit `judges[]` (provider, model, role, reasoning budget,
  weight), `aggregator`, `regressionThreshold`, `generatorProvider`.
  `RISK_TIER_PRESETS` expand a tier into a default cross-provider panel.
- **Multi-provider judges** — Anthropic, OpenAI, and Google. Per-judge
  reasoning effort maps to each provider's mechanism (Anthropic extended
  thinking, OpenAI `reasoning_effort`, Gemini thinking budget). A judge must
  not share the output's provider; the runner warns when one does.
- **Deterministic (code-scored) criteria** — `criterion.evaluator: { kind:
  "code", module, export }` scores a criterion by importing a function instead
  of calling a judge. Perfectly reproducible; reserve the panel for judgment
  calls.
- **`hammurabi-check <dir>`** — discovers every `*.spec.md` under a directory,
  runs each bundle against its committed baseline, aggregates into one report
  and CI exit code.
- **Baseline convention** — `<base>.baseline.report.json` next to the spec is
  auto-discovered for regression detection; `--update-baseline` blesses a new
  one.
- `hammurabi-run` flags: `--filter <ids>`, `--limit <n>`, `--no-baseline`,
  `--update-baseline`.
- `templates/eval-gate.yml` — drop-in GitHub Action that gates PRs on
  `hammurabi-check`.

### Changed

- **Errored or omitted judge votes are excluded from aggregation** (kept in the
  audit trail). A transient judge failure can no longer fabricate a low score
  and a false regression. A criterion no judge could score errors the fixture
  (⚠), it does not fail it (✗).
- `Criterion.judgePrompt` is now actually sent to the judge, and each
  criterion's scale is stated explicitly in the prompt.
- Judge calls run at `temperature: 0` with SDK retries.
- Report `judges[]` records `provider` and `role` alongside `model`.

## 0.0.4

- Migrate to `zod/v4`; fix judge truncation; tighten dependency ranges.

## 0.0.3

- `hammurabi-run` CLI + `/hammurabi-run` slash command.

## 0.0.2

- On-disk spec / rubric / fixtures loaders with strict Zod validation.
