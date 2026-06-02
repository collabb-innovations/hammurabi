# `/hammurabi-run` Slash Command + `hammurabi-run` CLI — Implementation Plan

## Context

Once loaders (plan #1) land, the natural next step is making the runner reachable from a Claude Code session and from CI without bespoke glue. This plan adds a thin Node CLI (`hammurabi-run`) plus a slash command (`/hammurabi-run`) that together let any caller — interactive user, CI step, agent — point at a `*.spec.md` and get back a scored report + a markdown summary in one shot.

This is the bridge that makes Hammurabi useful day-to-day: edit specs in your editor → `/hammurabi-run foo.spec.md` → trust the output (or see exactly why you shouldn't).

## Output target

After approval, copy this plan to `/Users/mustermania/collabb/hammurabi/plans/run-command-implementation.md` on the `feat/next-plans` branch.

## Architecture

```
src/cli/
├── run.ts          # `hammurabi-run` CLI entrypoint. Compiles to dist/cli/run.js (with shebang).
└── report-md.ts    # Pure function: Report → markdown string.

commands/
└── hammurabi-run.md  # Slash command. Invokes the CLI, then summarizes in chat.
```

`package.json` gains a `bin` entry:
```json
"bin": {
  "hammurabi-run": "./dist/cli/run.js"
}
```

## Decisions (committed in this plan)

1. **Arg parsing via `node:util.parseArgs`** — zero new deps. Hammurabi has no CLI today; adding commander to match Knack would be unjustified expansion for one command with ~6 flags.
2. **Compiled CLI bin with shebang**, not script invocation. After `npm install`, consumers get a `hammurabi-run` binary via standard npm bin resolution. Slash command invokes it directly.
3. **Reports overwrite by default; baseline is user-managed.** Match Knack's pattern (commit `baseline-report.md`). The CLI writes `<spec-base>.report.json` and `<spec-base>.report.md`, overwriting on re-run. To use a baseline for regression checks, the user explicitly passes `--baseline path/to/baseline.report.json`. No auto-rotation, no archive directory.
4. **Both JSON and Markdown written by default** (`--format both`); user can opt out with `--format json` or `--format md`. JSON is the canonical machine-readable artifact; markdown is the human-readable summary that's pleasant to commit and review in PRs.
5. **CLI exit code is meaningful for CI**: `0` if all fixtures passed AND no regressions; `1` if any fixture failed or any regression surfaced. `2` reserved for "couldn't run at all" (bad path, malformed bundle, judge call exploded).
6. **Slash command is thin** — it invokes the CLI, reads back the JSON report, and writes a tight chat summary. It doesn't reimplement scoring or do anything the CLI can't do alone. Same logic should work from CI.
7. **No cost estimation surfaced** in v0.0.3. Cost is observable post-hoc from API usage; pre-flight estimation is hard to do accurately. Add in v0.0.4 if a user asks.
8. **Output files land alongside the spec by default** (same dir as `<spec-base>.report.json`). `--out <dir>` overrides for CI scenarios.

## Implementation

### `src/cli/run.ts`

```ts
#!/usr/bin/env node
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadBundle } from "../loaders/index.js";
import { run } from "../runner/index.js";
import type { Aggregator, JudgeConfig } from "../runner/types.js";
import type { Report } from "../schema/report.js";
import { renderReportMarkdown } from "./report-md.js";
import { readFile } from "node:fs/promises";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    judges: { type: "string" },               // comma-separated model strings
    aggregator: { type: "string" },           // mean | median | min | max
    baseline: { type: "string" },             // path to prior report.json
    "regression-threshold": { type: "string" },
    out: { type: "string" },                  // output directory
    format: { type: "string", default: "both" }, // json | md | both
    quiet: { type: "boolean", default: false },
  },
});

if (positionals.length !== 1) { /* usage + exit 2 */ }
const specPath = resolve(positionals[0]);

// Parse judges / aggregator / baseline / regression-threshold
const judges: JudgeConfig[] | undefined = values.judges
  ? values.judges.split(",").map((m) => ({ model: m.trim() }))
  : undefined;
const aggregator = (values.aggregator as Aggregator | undefined);
const regressionThreshold = values["regression-threshold"]
  ? Number(values["regression-threshold"])
  : undefined;
const baseline: Report | undefined = values.baseline
  ? JSON.parse(await readFile(resolve(values.baseline), "utf8")) as Report
  : undefined;

// Load + run
const bundle = await loadBundle(specPath);
const report = await run({ ...bundle, judges, aggregator, baseline, regressionThreshold });

// Resolve output dir + write
const outDir = values.out ? resolve(values.out) : dirname(specPath);
const base = specPath
  .replace(/\.spec\.md$/i, "")
  .replace(/\.md$/i, "")
  .split("/").pop()!;
const jsonPath = `${outDir}/${base}.report.json`;
const mdPath = `${outDir}/${base}.report.md`;

if (values.format !== "md")  await writeFile(jsonPath, JSON.stringify(report, null, 2));
if (values.format !== "json") await writeFile(mdPath, renderReportMarkdown(report));

if (!values.quiet) {
  console.log(formatCliSummary(report, { jsonPath, mdPath }));
}

// Exit code
const hasFailure = report.summary.failed > 0 || report.summary.errored > 0;
const hasRegression = (report.summary.regressions?.length ?? 0) > 0;
process.exit(hasFailure || hasRegression ? 1 : 0);
```

`formatCliSummary` is a small local helper that prints a 4-line summary (overall pass/fail, weighted score, regression count, output paths).

### `src/cli/report-md.ts`

Pure function `renderReportMarkdown(report: Report): string`. Output shape:

```md
# Eval Report — <specName> v<specVersion>

- **Run ID**: <runId>
- **Started**: <startedAt>
- **Judges**: <model1>, <model2>
- **Aggregator**: <aggregator>
- **Overall**: <passed>/<total> passed (weighted **<score>**)
- **Regressions**: <count> (vs baseline)

## Fixtures

| ID | Tags | Score | Status |
|---|---|---:|:---:|
| <id> | <tag, tag> | 0.95 | ✓ |

## Per-fixture detail

### <fixtureId> — <status>

| Criterion | Weight | Score | Notes |
|---|---:|---:|---|
| <criterionId> | 0.50 | 1.00 | judge consensus |

<details>
<summary>Judge votes</summary>

- **claude-haiku-4-5** (1.00): reasoning…
- **claude-sonnet-4-6** (1.00): reasoning…

</details>

## Regressions

| Fixture | Baseline | Current | Δ |
|---|---:|---:|---:|
| <id> | 0.95 | 0.65 | -0.30 |
```

Notes:
- Status icon: ✓ (passed), ✗ (failed), ⚠ (errored)
- Per-fixture section uses `<details>`/`<summary>` so the markdown stays scannable when committed but still surfaces full reasoning on click
- If `report.summary.regressions` is empty/undefined, omit the Regressions section entirely
- Reasoning is rendered as a sub-list per judge — preserves the audit trail visible in the report

### `commands/hammurabi-run.md`

```md
---
description: Run a Hammurabi eval bundle (spec + rubric + fixtures) and summarize
argument-hint: "<path-to-spec.md> [--judges model,model] [--aggregator min|median|mean|max] [--baseline path]"
---

Drive the Hammurabi runner end-to-end against a spec bundle.

**Target spec:** $ARGUMENTS

## Step 1: Validate

If no argument was provided, ask the user for a spec path (or offer to scaffold via `/hammurabi`).
If the path doesn't end in `.md`, warn and confirm before continuing.

## Step 2: Invoke the CLI

Run:
\`\`\`
hammurabi-run $ARGUMENTS
\`\`\`

(If `hammurabi-run` isn't on PATH, fall back to `npx hammurabi-run` or `node ./node_modules/hammurabi/dist/cli/run.js`. Detect once by checking `which hammurabi-run`.)

## Step 3: Read the report

The CLI writes `<spec-base>.report.json` and `<spec-base>.report.md` alongside the spec (or to `--out` if specified). Read the JSON file.

## Step 4: Summarize

In the chat, give the user:
- Overall pass/fail and weighted score
- Any regressions (list them — fixture ID, baseline → current, delta)
- Any errored fixtures (with the error message)
- A clickable link to the markdown report path
- If anything failed or regressed: ask whether to investigate. If they say yes, start by reading the worst-scoring fixture's `judgeVotes` and the relevant criterion.

## Step 5: Surface exit code

If the CLI exited non-zero, make that visible in the chat. CI users will check exit code; interactive users should see the same red flag.
```

### `package.json`

Add:
```json
"bin": {
  "hammurabi-run": "./dist/cli/run.js"
}
```

Add subpath export for the CLI (optional, mostly for advanced consumers):
```json
"./cli": {
  "types": "./dist/cli/run.d.ts",
  "import": "./dist/cli/run.js"
}
```

Add script:
```json
"scripts": {
  "run-cli": "tsx src/cli/run.ts"
}
```

### TypeScript build config

`tsconfig.json` already emits `dist/`. The shebang in `src/cli/run.ts` is preserved by tsc as long as it's the first line. The compiled `dist/cli/run.js` must be `chmod +x` for npm to make it executable as a bin. Add a `postbuild` script:
```json
"postbuild": "chmod +x dist/cli/run.js"
```

## Verification

1. `npm install && npm run build` clean. `dist/cli/run.js` is executable and has shebang.
2. `npx hammurabi-run examples/smoke/disk/uppercase.spec.md` — runs against the loaders smoke (from plan #1). Writes `uppercase.report.json` + `uppercase.report.md` alongside the spec. Exit code 0 if all passed.
3. **Failure exit code**: temporarily break `examples/smoke/impl.ts` (return lowercase), re-run, confirm exit code 1.
4. **Regression**: capture a baseline (`cp uppercase.report.json baseline.json`), break impl, re-run with `--baseline baseline.json`, confirm regression appears in report and CLI exits 1.
5. **Markdown rendering**: open `uppercase.report.md` — table renders cleanly, judge-votes `<details>` block expands.
6. **CI shape**: `--quiet --format json --out ./artifacts` writes a single JSON file with no stdout noise. Exit code propagates.
7. **Slash command**: in a Claude Code session, `/hammurabi-run examples/smoke/disk/uppercase.spec.md` — assistant runs CLI, reads report, summarizes in chat. Verify error path: pass a missing file, confirm assistant catches the CLI's exit-2 and presents the error sensibly.

## Out of scope (deferred)

- Cost estimation pre-flight
- Auto-rotating reports / archive directory
- Pairwise diff command (`/hammurabi-diff` — would compare two reports head-to-head, useful for skill iteration; punt until requested)
- Streaming progress for long runs (currently the CLI is silent until the report is done)
- Watch mode (`--watch` reruns on spec changes)
- A separate `/hammurabi-baseline` slash command for promoting a report to baseline (one-liner cp is fine for now)
