# Changelog

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
