# Knack ↔ Hammurabi Integration — Implementation Plan

## Context

Hammurabi exists to be consumed. The first consumer is Knack — the validated wedge product from 2026-06-01's eight discovery conversations. Knack already has its own eval engine (`knack/src/eval/runner.ts`) with a single pass/fail judge per fixture. Hammurabi offers configurable judge panels, weighted multi-criterion scoring, and a canonical Report shape that supports baseline comparison and regression detection. Once integrated, Knack's "is my skill getting better?" question gets a load-bearing answer with audit trails — which is the moat substrate.

This plan covers **medium-depth integration**: Knack imports Hammurabi as a package, adds a parallel `knack eval --hammurabi` code path that uses Hammurabi's `run()`, and keeps the existing `eval/runner.ts` untouched. The old path gets removed in a v0.0.4-or-later follow-up once the Hammurabi path proves out. Auto-generating Hammurabi rubrics from Knack's exemplar named-tags (the "moat loop") is **deferred** to a separate plan.

Critically: **Hammurabi itself requires no code changes** for this integration. The free-form target type, the `execute` callback in `RunOptions`, the loaders, and the Report shape all exist. The work is entirely Knack-side. This plan still lives in `hammurabi/plans/` because it documents the contract Hammurabi guarantees and the Knack-side wiring.

## Output target

After approval, copy this plan to `/Users/mustermania/collabb/hammurabi/plans/knack-integration-implementation.md` on the `feat/next-plans` branch.

## Architecture

```
knack/
├── src/
│   ├── eval/
│   │   ├── runner.ts            # EXISTING — untouched in v0.0.3
│   │   ├── diff.ts              # EXISTING — untouched (Hammurabi has no pairwise port yet)
│   │   └── hammurabi-runner.ts  # NEW — Hammurabi-backed eval path
│   ├── cli.ts                   # MODIFIED — adds --hammurabi flag to eval command
│   └── llm/client.ts            # UNCHANGED — reused as the execute callback source
└── package.json                 # MODIFIED — adds hammurabi as a dep
```

## Decisions (committed in this plan)

1. **Knack consumes Hammurabi via git URL** in `package.json`: `"hammurabi": "github:collabb-innovations/hammurabi#v0.0.3"` (or whatever tag the loaders + run-command land under). During Knack development, the user may temporarily symlink via `"file:../hammurabi"` for fast iteration — note this in the Knack README but don't commit the symlink.
2. **Knack synthesizes the Hammurabi `Spec` in memory** rather than maintaining a `*.spec.md` per skill. Knack already has the skill body, name, and version in its own model — wrapping it as a Hammurabi `Spec` at eval-time is one function. Avoids forcing Knack users to author a duplicate file.
3. **Target kind is `free-form`**; Knack passes `RunOptions.execute = async (input) => await generateSkillOutput(skillBody, input)` (where `generateSkillOutput` is the existing function at `knack/src/llm/client.ts:57`). This routes skill execution through Knack's own LLM client — Hammurabi never knows it's running a Knack skill.
4. **Fixture adapter** translates Knack's fixture frontmatter (`id`, `description`, `expected_behavior`, body-as-input) into Hammurabi's `Fixture` shape: id → id, body → input, `description + " — " + expected_behavior` → notes. `expected` left undefined (Knack judges behavior, not exact match).
5. **Rubric is hand-written per skill** in v0.0.3. Knack expects `skills/<name>/eval/rubric.json` in Hammurabi's `Rubric` shape. If missing, `knack eval --hammurabi <name>` errors with a clear message pointing at `/hammurabi` for authoring help. Auto-generation deferred.
6. **Eval output lands in Knack's existing eval directory layout**: `skills/<name>/eval/hammurabi/<timestamp>.report.json` + `.report.md`. Don't conflict with Knack's existing `eval/<timestamp>.json` outputs from the old runner.
7. **Both paths coexist** until parity is proven. No deprecation warnings on the old path in v0.0.3 — that's noise. Remove old path in a follow-up plan, not this one.
8. **Pairwise (Knack's `judgePairwise` / `knack diff`) stays Knack-only.** Hammurabi has no pairwise port; ports come if/when a Hammurabi consumer needs one.

## Implementation

### `knack/package.json`

Add to dependencies:
```json
"hammurabi": "github:collabb-innovations/hammurabi#v0.0.3"
```

(`v0.0.3` assumes loaders + run-command both land under that version. Adjust at integration time.)

### `knack/src/eval/hammurabi-runner.ts` (new)

```ts
import { run } from "hammurabi";
import type { Spec, Rubric, FixtureSet, Report, JudgeConfig, Aggregator } from "hammurabi";
import { loadRubric, loadFixtures } from "hammurabi/loaders";
import { generateSkillOutput } from "../llm/client.js";
import { loadSkill, loadKnackFixtures } from "./loaders.js"; // existing Knack loaders
import { writeFile, mkdir } from "node:fs/promises";

export interface HammurabiEvalOptions {
  skillName: string;
  judges?: JudgeConfig[];
  aggregator?: Aggregator;
  baseline?: string;          // path to a prior report.json
  regressionThreshold?: number;
}

export async function evalWithHammurabi(opts: HammurabiEvalOptions): Promise<Report> {
  const skill = await loadSkill(opts.skillName);
  const spec = synthesizeSpec(skill);
  const rubric = await loadRubric(`skills/${opts.skillName}/eval/rubric.json`);
  const fixtures = await loadKnackFixturesAsHammurabi(opts.skillName);
  const baseline = opts.baseline
    ? JSON.parse(await readFile(opts.baseline, "utf8")) as Report
    : undefined;

  const report = await run({
    spec,
    rubric,
    fixtures,
    judges: opts.judges,
    aggregator: opts.aggregator,
    baseline,
    regressionThreshold: opts.regressionThreshold,
    execute: async (input) => {
      const inputStr = typeof input === "string" ? input : JSON.stringify(input);
      return await generateSkillOutput(skill.body, inputStr);
    },
  });

  await writeReport(opts.skillName, report);
  return report;
}

function synthesizeSpec(skill: KnackSkill): Spec {
  return {
    frontmatter: {
      name: skill.name,
      version: skill.version ?? "0.0.0",
      description: skill.description ?? `Knack-materialized skill: ${skill.name}`,
      target: { kind: "free-form", description: `Knack skill ${skill.name}` },
    },
    body: skill.body,
  };
}

async function loadKnackFixturesAsHammurabi(skillName: string): Promise<FixtureSet> {
  const knackFixtures = await loadKnackFixtures(skillName);
  return {
    specName: skillName,
    specVersion: "0.0.0", // synthesized — see synthesizeSpec
    fixtures: knackFixtures.map((kf) => ({
      id: kf.id,
      input: kf.input,
      notes: [kf.description, kf.expected_behavior].filter(Boolean).join(" — "),
    })),
  };
}

async function writeReport(skillName: string, report: Report): Promise<void> {
  const ts = report.runId.replace(/^run-/, "");
  const dir = `skills/${skillName}/eval/hammurabi`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/${ts}.report.json`, JSON.stringify(report, null, 2));
  // Markdown rendering can reuse hammurabi-run CLI's renderer if exported:
  // import { renderReportMarkdown } from "hammurabi/cli"; — adjust based on what plan #2 exports.
}
```

### `knack/src/cli.ts` modification

Add a `--hammurabi` flag (and optional pass-through flags) to the existing `eval` command:

```ts
.command("eval <skill>")
.description("Evaluate a skill against its fixtures")
.option("--hammurabi", "Use Hammurabi runner (multi-criterion, judge panel, audit trail)")
.option("--judges <models>", "Comma-separated judge models (Hammurabi path only)")
.option("--aggregator <mode>", "Score aggregator: mean|median|min|max (Hammurabi path only)")
.option("--baseline <path>", "Baseline report.json for regression detection (Hammurabi path only)")
.action(async (skillName, opts) => {
  if (opts.hammurabi) {
    const { evalWithHammurabi } = await import("./eval/hammurabi-runner.js");
    const judges = opts.judges
      ? opts.judges.split(",").map((m: string) => ({ model: m.trim() }))
      : undefined;
    const report = await evalWithHammurabi({
      skillName,
      judges,
      aggregator: opts.aggregator,
      baseline: opts.baseline,
    });
    // Print CLI-style summary
    printHammurabiSummary(report);
    process.exit(reportHasFailures(report) ? 1 : 0);
  } else {
    // existing eval path
    await runExistingEval(skillName);
  }
});
```

`printHammurabiSummary` is a small Knack-side helper (could later move to Hammurabi if generic enough). It prints overall pass count, weighted score, regression count, and the path to the written report.

### Documentation

- `knack/README.md` — add a section explaining the two eval paths, when to use `--hammurabi`, and where rubrics go (`skills/<name>/eval/rubric.json`).
- `hammurabi/README.md` — add a one-paragraph "Consumed by" section pointing at Knack as the reference consumer integration.

## Cross-validation considerations

Knack synthesizes a Spec at runtime with `version: skill.version ?? "0.0.0"`. The fixtures' `specVersion` field (also synthesized in the adapter) must match. The rubric's `specName + specVersion` (loaded from disk) must match the synthesized values. Two options:

- **Option A**: Make Hammurabi's bundle cross-validation tolerant when `specVersion` is the sentinel `"0.0.0"` (treat as "don't enforce version match"). Slightly magic, but invisible to Knack users.
- **Option B**: Require Knack users to set `specName` and `specVersion` in their hand-written rubric to match Knack's skill name and version exactly. Predictable but pushes friction onto users.

**Committed: Option B in v0.0.3.** Document the requirement clearly. Revisit if friction is real.

## Verification

1. **Build**: `cd knack && npm install` resolves `hammurabi` from git. `npm run typecheck` clean.
2. **Smoke**: choose a Knack skill that has fixtures (`lead-gen-lp-designer` per memory). Hand-write `skills/lead-gen-lp-designer/eval/rubric.json` with 2–3 criteria matching the skill's named-tag anti-patterns.
3. **First Hammurabi eval**: `npx knack eval lead-gen-lp-designer --hammurabi` — runs, writes report under `eval/hammurabi/`, exits 0 or 1 based on failures.
4. **Parity check**: run the existing `npx knack eval lead-gen-lp-designer` (old path) and the Hammurabi path side by side. Skim both reports. The Hammurabi report should be a strict superset of useful information (multi-criterion scores + audit trail).
5. **Baseline + regression**: capture a report as baseline (`cp eval/hammurabi/<ts>.report.json baseline.report.json`), tweak the skill body to introduce a known regression, re-run with `--baseline baseline.report.json`. Confirm the regression surfaces.
6. **Multi-judge panel**: `npx knack eval lead-gen-lp-designer --hammurabi --judges claude-haiku-4-5,claude-sonnet-4-6 --aggregator min` — confirm both judges' votes land in `judgeVotes` arrays and the aggregated score is the minimum.
7. **Missing rubric**: delete `eval/rubric.json`, re-run with `--hammurabi`, confirm the error message points at `/hammurabi` for authoring help.
8. **No regression in existing path**: `npx knack eval lead-gen-lp-designer` (no `--hammurabi`) behaves identically to before.

## Out of scope (deferred to later plans)

- **Auto-generated rubrics from Knack's exemplar named-tags** — the moat loop. Separate plan.
- **Removing the old `knack/src/eval/runner.ts`** — follow-up plan after Hammurabi path proves stable.
- **Pairwise (`knack diff`) → Hammurabi** — only port if a Hammurabi consumer needs it.
- **Spec/Fixture writers** in Knack (writing Knack skills back out as Hammurabi `*.spec.md` files) — not needed since synthesis happens at runtime.
- **CI integration** (running `knack eval --hammurabi` in GitHub Actions on every PR) — Knack-product roadmap question, not a Hammurabi-integration question.
- **Telemetry / cost tracking** across eval runs — separate concern.
