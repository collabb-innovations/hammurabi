# hammurabi

Spec → rubric → fixtures → runner. A small, opinionated framework for authoring evaluations you'll actually trust.

**Status:** alpha. v0.0.1 runner implemented, no on-disk loaders yet (callers construct Spec/Rubric/FixtureSet objects in code).

## Why

Teams ship faster when they can trust outputs without re-reading every diff. Hammurabi is the connective tissue: a single schema for specs, rubrics, and fixtures that any runner (or downstream tool like [Knack](../knack/)) can consume.

## Install

Git-installed for now (no npm registry yet):

```sh
npm install github:mustermania/collabb#hammurabi-v0.0.1 --workspace=hammurabi
```

Once stable, this will publish to npm.

## Authoring commands

Copy the slash commands into any project's `.claude/commands/`:

```sh
cp node_modules/hammurabi/commands/*.md .claude/commands/
```

Then run `/hammurabi <path-to-spec.md>` to drive the 4-step authoring flow.

## Schema

Three artifact types, all language-neutral on disk:

| Artifact | Format | TS type |
|----------|--------|---------|
| Spec | `*.spec.md` (frontmatter + body) | `Spec` |
| Rubric | `*.rubric.json` | `Rubric` |
| Fixtures | `*.fixtures.jsonl` | `FixtureSet` |

Reports are JSON: `Report` type.

```ts
import type { Spec, Rubric, FixtureSet, Report } from "hammurabi/schema";
import { run } from "hammurabi/runner";
```

## Runner

```ts
import { run } from "hammurabi";

const report = await run({
  spec,
  rubric,
  fixtures,
  judges: [{ model: "claude-haiku-4-5" }, { model: "claude-sonnet-4-6" }],
  aggregator: "min",
  baseline: previousReport,
});
```

### Judge panel

The runner judges each fixture's output with a **configurable panel of LLMs**. Default is a single Haiku 4.5 judge. Teams running risk-sensitive workloads (trading strategies, backtests, anything touching real money) should grow the panel and mix model families to match their risk tolerance.

| Option | Default | Notes |
|---|---|---|
| `judges` | `[{ model: "claude-haiku-4-5" }]` | Array of judge configs. Panel calls run in parallel per fixture. |
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

If a judge errors, its synthetic vote (`score: 0`, `reasoning: "judge errored: ..."`) still lands in `judgeVotes` so the run continues and the cause is auditable.

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
│   ├── runner/
│   │   ├── client.ts # Anthropic singleton + MODELS + system prompt
│   │   ├── execute.ts# Per-target-kind fixture execution
│   │   ├── judge.ts  # Panel orchestration + aggregation
│   │   ├── score.ts  # Weighted score, pass/fail, regressions
│   │   ├── schema.ts # Zod schema for judge structured output
│   │   ├── types.ts  # RunOptions, JudgeConfig, Aggregator
│   │   └── index.ts  # run() entrypoint
│   └── index.ts
├── commands/         # Slash commands to copy into .claude/commands/
├── examples/smoke/   # End-to-end smoke test
└── plans/            # Approved implementation plans
```
