---
description: Run a Hammurabi eval bundle (spec + rubric + fixtures) and summarize
argument-hint: "<spec-path> [--judges model,model] [--aggregator mean|median|min|max] [--baseline path]"
---

Drive Hammurabi's runner end-to-end against a spec bundle and summarize the result in chat.

**Target:** $ARGUMENTS

## Step 1: Validate input

If `$ARGUMENTS` is empty, ask the user for a spec path (or offer to scaffold one via `/hammurabi`).

If the path doesn't end in `.md`, warn and confirm before continuing — the bundle convention expects `*.spec.md` or `*.md` with sibling `.rubric.json` and `.fixtures.jsonl`.

## Step 2: Invoke the CLI

Try in this order:

1. `hammurabi-run $ARGUMENTS`
2. If "command not found": `npx hammurabi-run $ARGUMENTS`
3. If still failing: `node ./node_modules/hammurabi/dist/cli/run.js $ARGUMENTS`

Capture stdout, stderr, and exit code.

## Step 3: Handle exit codes

- **Exit 0**: success. Proceed to Step 4.
- **Exit 1**: ran successfully, but had failures or regressions. Proceed to Step 4 (report still exists).
- **Exit 2**: could not run (bad args, malformed bundle, runner error). Surface stderr to the user verbatim and stop. Do **not** attempt to read a report — it won't exist.

## Step 4: Read and summarize

The CLI writes `<spec-base>.report.json` and `<spec-base>.report.md` alongside the spec (or in `--out` if the user passed it). Use the JSON file for structured access.

Give the user:

- **Overall**: `<passed>/<total> passed, weighted <score>`
- **Failures** (if any): list each fixture with `passed: false`, its weighted score, and its worst-scoring criterion (lowest aggregated score from `scores[]`).
- **Errored fixtures** (if any): list each with the error message.
- **Regressions** (if any): list each as `<fixtureId>: <baseline> → <current> (Δ <delta>)`.
- A path to the rendered markdown report.

If anything failed, errored, or regressed, ask the user whether to dig in. If yes, start by reading the `judgeVotes` array on the worst-scoring criterion of the most-impacted fixture — that's where the judge reasoning lives.

## Step 5: Surface the exit code

Make the CLI's exit code visible in chat. CI consumers check it; interactive users should see the same red flag.
