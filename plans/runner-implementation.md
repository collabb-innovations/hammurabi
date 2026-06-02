# Hammurabi Runner — Implementation Plan

## Context

The Hammurabi scaffold (v0.0.1, 2026-06-02) ships a schema + authoring slash command + a runner *stub* that throws "not implemented yet." This plan implements the runner so that any caller — Knack, a CI step, a slash command — can take `{ spec, rubric, fixtures }` and get back a scored `Report`.

The runner is the part that makes specs and rubrics matter. Without it, Hammurabi is a doc generator. With it, the user can trust outputs without re-reading every diff, which is the validated wedge for both Knack and the user's own BD time.

Style constraint: the runner must be indistinguishable from Knack's existing `eval`/`diff` code (`/Users/mustermania/collabb/knack/src/eval/runner.ts`, `/Users/mustermania/collabb/knack/src/eval/diff.ts`, `/Users/mustermania/collabb/knack/src/llm/client.ts`). Same import style, same model IDs, same `messages.parse()` + `zodOutputFormat()` pattern, same `AI_GATEWAY_URL` fallback, same singleton client.

## Output target

The plan will be copied to `/Users/mustermania/collabb/hammurabi/plans/runner-implementation.md` after approval (user requested it land in `hammurabi/plans/`). The harness plan file is the working copy during planning only.

## Architecture

```
src/runner/
├── index.ts        # Entry: run(options) → Report. Orchestrates execute → judge → score per fixture.
├── client.ts       # Anthropic singleton + model constants. Mirror of knack/src/llm/client.ts.
├── execute.ts      # Execute fixture input against target → output. Per target.kind.
├── judge.ts        # LLM-as-judge call. One batched call per fixture, scores all criteria.
├── score.ts        # Aggregate weighted score, pass/fail, baseline regressions.
└── schema.ts       # Zod schema for the judge's structured output (criterion scores).
```

Two new runtime dependencies: `@anthropic-ai/sdk` and `zod`. Both are bedrock of the user's stack (also used by Knack). No supply-chain expansion beyond the already-trusted set.

## Decisions (committed in this plan)

1. **One judge call per fixture, batched scores for all criteria.** Per judge in the panel. Matches Knack's "single pass/fail + reasoning per fixture" style. Cheaper than per-criterion calls and avoids cross-call drift.
2. **Configurable judge panel.** `RunOptions.judges: JudgeConfig[]` where each entry specifies a model (and optionally per-judge overrides like system prompt or temperature later). Default panel = `[{ model: "claude-haiku-4-5" }]` for parity with Knack and cheap default. Teams running risk-sensitive workloads (trading strategies, backtests, anything touching real money) can grow the panel and mix model families to match their risk tolerance. Cost scales linearly with panel size — surface this in the README, don't try to hide it.
3. **Panel calls run in parallel per fixture** via `Promise.all`. Panel size is multiplicative on cost but stays constant on wall-clock latency.
4. **Configurable score aggregation across the panel.** `RunOptions.aggregator: "mean" | "median" | "min" | "max" | ((scores: number[]) => number)`. Default = `"mean"`. Risk-sensitive callers will set `"min"` (most conservative judge wins) or pass a custom function (e.g. trimmed mean, quorum threshold). Aggregation runs per criterion: each criterion gets one aggregated score per fixture, with individual judge votes preserved in the report for audit.
5. **Sequential fixture execution.** Knack runs sequentially in `eval/runner.ts`; matches. Panel parallelism (within a fixture) plus sequential fixtures is the right shape for v0.1. Add a `fixtureConcurrency` option later when a real need surfaces.
6. **`free-form` target requires an `execute` callback in `RunOptions`.** Clean contract, no magic. Callers who want Claude-as-executor pass an `execute` that calls Anthropic.
7. **Library returns `Report`; does not write files.** Keeps the library pure. The companion slash command (Phase 2, not in this plan) writes the report to disk.
8. **Baseline regression threshold defaults to 0.05 (5pp), overridable** via `RunOptions.regressionThreshold`.
9. **Prompt caching: cache the criteria block** (rubric is identical across all fixtures in a run). Use `cache_control: { type: "ephemeral" }` per Knack's pattern (`client.ts:69`). Caching is per-model — mixed-model panels just won't share cache across models, which is fine.
10. **No retries.** Anthropic SDK handles rate-limit retries internally. Match Knack — no custom retry layer.

## Implementation

### `src/runner/client.ts`

Direct port of Knack's singleton (`knack/src/llm/client.ts:1-25`) — same env var fallback, same `Anthropic` instantiation, same model constants:

```ts
export const MODELS = {
  judge: "claude-haiku-4-5",
  // generate is unused in hammurabi; spec'd for parity with knack
} as const;
```

### `src/runner/schema.ts`

Zod schema for the judge's structured output:

```ts
export const JudgeResponseSchema = z.object({
  scores: z.array(z.object({
    criterionId: z.string(),
    score: z.number(),
    reasoning: z.string(),
  })),
});
```

### `src/runner/execute.ts`

`executeFixture(target, input): Promise<{ output: unknown; error?: string }>`

Discriminated dispatch on `target.kind`:
- `cli`: `child_process.execFile`, JSON.stringify(input) as the single arg, capture stdout, parse JSON. Errors return `{ output: null, error }`.
- `function`: dynamic `import(target.module)`, await `module[target.export](input)`.
- `http`: `fetch(target.url, { method: target.method ?? "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" } })`, return parsed JSON.
- `free-form`: throw if `options.execute` not provided; otherwise call `options.execute(input)`.

All errors are caught and surfaced as `error` on the fixture result rather than bubbling — one bad fixture must not abort the whole run.

### `src/runner/judge.ts`

Two functions:

`judgeFixtureOne({ spec, rubric, fixture, output, judge }): Promise<JudgeVote[]>` — single judge in the panel.

Builds a prompt with:
1. **System**: "You are an evaluation judge. Score the output against each criterion. Return strict JSON matching the schema."
2. **User content blocks**:
   - Spec body (frontmatter + body) — cached (`cache_control: ephemeral`)
   - Rubric criteria as JSON — cached
   - Fixture input + notes
   - Output to judge

Calls `client().messages.parse({ model: judge.model, output_config: { format: zodOutputFormat(JudgeResponseSchema) }, ... })` — same shape as Knack's `judgeAgainstFixture()` (`client.ts:91-108`).

For each criterion, if the judge returned no score, fill with `score: 0` and `reasoning: "judge omitted"`. Don't fail the run.

`judgeFixturePanel({ spec, rubric, fixture, output, judges, aggregator }): Promise<CriterionScore[]>` — orchestrates the panel.

- Call `judgeFixtureOne` for each judge **in parallel** via `Promise.all`
- For each criterion, collect the array of per-judge scores, aggregate via the configured `aggregator`, concatenate reasonings (prefixed by judge model) into a single `reasoning` string
- Return one `CriterionScore` per criterion, each populated with `judgeVotes: JudgeVote[]` for audit transparency
- If any single judge call fails, record that judge's vote as a synthetic `{ score: 0, reasoning: "judge errored: <msg>" }` rather than aborting the panel — the aggregator still runs on the remaining judges

### `src/runner/score.ts`

`scoreFixture(scores: CriterionScore[], rubric: Rubric): { weightedScore: number; passed: boolean }`

- For each score: normalize to [0,1] based on criterion scale (`pass-fail` → 0|1; `ordinal` → `(score - min) / (max - min)`)
- `weightedScore = Σ(normalized_i × weight_i)` — assumes weights sum to 1.0; warn (don't fail) on drift
- `passed = weightedScore >= rubric.passThreshold`

`computeRegressions(current: Report, baseline: Report, threshold: number): RegressionDelta[]`

Per fixture ID present in both reports, emit `RegressionDelta` if `baseline.weightedScore - current.weightedScore > threshold`.

### `src/runner/index.ts` (replaces the stub)

```ts
const DEFAULT_JUDGES: JudgeConfig[] = [{ model: MODELS.judge }];
const DEFAULT_AGGREGATOR: Aggregator = "mean";

export async function run(options: RunOptions): Promise<Report> {
  const startedAt = new Date().toISOString();
  const runId = `run-${Date.now()}`;
  const judges = options.judges ?? DEFAULT_JUDGES;
  const aggregator = options.aggregator ?? DEFAULT_AGGREGATOR;
  const results: FixtureResult[] = [];

  for (const fixture of options.fixtures.fixtures) {
    const { output, error } = await executeFixture(options.spec.frontmatter.target, fixture.input, options);
    if (error) {
      results.push({ fixtureId: fixture.id, output, scores: [], weightedScore: 0, passed: false, error });
      continue;
    }
    const scores = await judgeFixturePanel({
      spec: options.spec,
      rubric: options.rubric,
      fixture,
      output,
      judges,
      aggregator,
    });
    const { weightedScore, passed } = scoreFixture(scores, options.rubric);
    results.push({ fixtureId: fixture.id, output, scores, weightedScore, passed });
  }

  const regressions = options.baseline
    ? computeRegressions({ results } as Report, options.baseline, options.regressionThreshold ?? 0.05)
    : undefined;

  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    specName: options.spec.frontmatter.name,
    specVersion: options.spec.frontmatter.version,
    judges,
    aggregator: typeof aggregator === "function" ? "custom" : aggregator,
    criteria: options.rubric.criteria,
    results,
    summary: summarize(results, regressions),
  };
}
```

`RunOptions` becomes:

```ts
export interface JudgeConfig {
  model: string;
  // future: temperature, custom system prompt, etc.
}

export type Aggregator =
  | "mean" | "median" | "min" | "max"
  | ((scores: number[]) => number);

export interface RunOptions {
  spec: Spec;
  rubric: Rubric;
  fixtures: FixtureSet;
  judges?: JudgeConfig[];                            // default: [{ model: "claude-haiku-4-5" }]
  aggregator?: Aggregator;                           // default: "mean"
  baseline?: Report;
  regressionThreshold?: number;                      // default: 0.05
  execute?: (input: unknown) => Promise<unknown>;    // required for free-form targets
}
```

Schema changes to `src/schema/report.ts`:

```ts
export interface JudgeVote {
  model: string;
  score: number;
  reasoning: string;
}

export interface CriterionScore {
  criterionId: string;
  score: number;          // aggregated across panel
  reasoning: string;      // concatenated, judge-prefixed
  judgeVotes: JudgeVote[]; // preserved for audit
}

export interface Report {
  // ... existing fields ...
  judges: JudgeConfig[];  // replaces `judgeModel: string`
  aggregator: string;     // human-readable label, e.g. "mean", "min", "custom"
  // ... rest unchanged ...
}
```

Schema-breaking change is acceptable: no consumers yet (v0.0.1).

### `package.json`

Add runtime deps:
```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.40.0",
  "zod": "^3.23.0"
}
```

(Exact versions to match Knack's pinned versions — read `knack/package.json` at implementation time to keep them aligned.)

## Verification

End-to-end smoke test (no test framework; one script file `examples/smoke/run.ts`):
1. Define a trivial spec (`name: "uppercase"`, `target: { kind: "function", module: "./impl", export: "upper" }`)
2. Define a rubric with one criterion (`is-uppercase`, weight 1.0, pass-fail)
3. Define 3 fixtures: happy ("hello" → "HELLO"), edge ("" → ""), adversarial ("HeLLo" → expected uppercase)
4. Implement the function correctly, then incorrectly, confirm the judge marks pass/fail correctly
5. Re-run with the previous report as `baseline`, confirm regressions surface for fixtures that drop

Manual checks before declaring done:
- `npm run build` clean
- `npm run typecheck` clean
- Smoke script runs end-to-end against live Anthropic API, prints the report
- Report JSON validates against the `Report` TS type (compile-time only — no runtime validator yet)
- Costs: a single 3-fixture smoke run with default 1-judge panel should be under $0.02 with Haiku 4.5 + prompt caching
- **Panel smoke**: re-run with `judges: [{ model: "claude-haiku-4-5" }, { model: "claude-sonnet-4-6" }]` and `aggregator: "min"`. Confirm: (a) panel calls run in parallel (wall-clock ~= longer of the two), (b) report has `judgeVotes` arrays populated per criterion, (c) aggregated score equals the minimum of the per-judge scores. Cost should be roughly 3-fixture-haiku + 3-fixture-sonnet (panel multiplies cost linearly — surface this in README).

## Out of scope (deferred to a later plan)

- Fixture-level concurrency (`concurrency: N` option)
- The `/hammurabi-run` slash command that writes report JSON to disk and prints a markdown summary
- Diff/pairwise comparison runner (Knack already has it; port if Hammurabi needs it standalone)
- Progress events / `onFixtureComplete` callback for long runs
- Retries beyond what the Anthropic SDK does internally
- Runtime validation of `Spec`/`Rubric`/`FixtureSet` parsed from disk — the runner takes already-parsed objects; loaders are a separate concern
