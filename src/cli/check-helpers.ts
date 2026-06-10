import type { Report } from "../schema/report.js";
import type { BaselineDiff } from "./baseline-diff.js";

/**
 * Outcome of running one bundle inside `hammurabi-check`. Carried by the CLI
 * loop and consumed by `exitCode` + `formatSummary`. Kept here (not in
 * `check.ts` — which is a CLI bin) so the pure helpers stay unit-testable.
 */
export interface BundleOutcome {
  specPath: string;
  specName?: string;
  report?: Report;
  baseline?: Report;
  diff?: BaselineDiff;
  error?: string;
}

/**
 * Exit code derives from NEW failures (not in baseline) and regressions.
 * Baselined-still-failing fixtures surface as warnings but do NOT break the
 * gate — without this, any bundle whose honest baseline contains red fixtures
 * could never sit in CI. See issue #12.
 *
 *   0  no new failures, no regressions, no infrastructure errors
 *   1  any new failure or regression
 *   2  a bundle could not be loaded or run
 */
export function exitCode(outcomes: BundleOutcome[]): 0 | 1 | 2 {
  if (outcomes.some((o) => o.error)) return 2;
  const bad = outcomes.some((o) => {
    const s = o.report!.summary;
    const newFailures = o.diff?.newFailures.length ?? s.failed;
    return newFailures > 0 || s.errored > 0 || (s.regressions?.length ?? 0) > 0;
  });
  return bad ? 1 : 0;
}

export function formatSummary(
  outcomes: BundleOutcome[],
  updateBaseline: boolean,
): string {
  const lines: string[] = [];
  let totalFx = 0;
  let totalPass = 0;
  let anyImprovement = false;
  for (const o of outcomes) {
    if (o.error) {
      lines.push(`  ⚠ ERROR  ${o.specPath}\n           ${o.error}`);
      continue;
    }
    const s = o.report!.summary;
    totalFx += s.totalFixtures;
    totalPass += s.passed;
    const regs = s.regressions?.length ?? 0;
    const newFails = o.diff?.newFailures.length ?? s.failed;
    const knownFails = o.diff?.knownFailures.length ?? 0;
    const imps = o.diff?.improvements.length ?? 0;
    if (imps > 0) anyImprovement = true;
    const ok = newFails === 0 && s.errored === 0 && regs === 0;
    const annotations: string[] = [];
    if (regs > 0) annotations.push(`${regs} regression(s)`);
    if (newFails > 0) annotations.push(`${newFails} new failure(s)`);
    if (knownFails > 0) annotations.push(`${knownFails} known-fail (baselined)`);
    if (imps > 0) annotations.push(`${imps} improvement(s)`);
    lines.push(
      `  ${ok ? "✓ PASS " : "✗ FAIL "} ${o.specName ?? o.specPath}  ` +
        `${s.passed}/${s.totalFixtures} passed  weighted ${s.weightedScore.toFixed(3)}` +
        (annotations.length > 0 ? `  ${annotations.join(", ")}` : ""),
    );
  }
  const header = updateBaseline
    ? `Blessed ${outcomes.length} bundle baseline(s).`
    : `Checked ${outcomes.length} bundle(s) — ${totalPass}/${totalFx} fixtures passed.`;
  const footer = anyImprovement
    ? `\n  ❍ baselined failures now passing — consider re-blessing with --update-baseline`
    : "";
  return `${header}\n${lines.join("\n")}${footer}\n`;
}

export function bundleEntryForCombined(
  o: BundleOutcome,
): Record<string, unknown> {
  return {
    specPath: o.specPath,
    specName: o.specName,
    ...(o.error
      ? { error: o.error }
      : {
          summary: o.report!.summary,
          newFailures: o.diff?.newFailures.length ?? o.report!.summary.failed,
          knownFailures: o.diff?.knownFailures.length ?? 0,
          improvements: o.diff?.improvements.length ?? 0,
        }),
  };
}
