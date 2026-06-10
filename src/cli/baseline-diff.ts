import type { Report } from "../schema/report.js";

/**
 * Classification of fixture-level outcomes against a committed baseline.
 *
 * "Known failures" — fixtures failing identically in the baseline — do NOT
 * contribute to the CLI's exit code. A bundle whose honest baseline contains
 * legitimate red fixtures (the gate-target may not be fully conformant yet)
 * can still sit in CI: regressions and new failures break the gate, baselined
 * failures stay quiet. See issue #12 for the production incident this exists
 * to fix (continuum F-326, `mood-board-search`).
 *
 * "Improvements" surface baselined-failing fixtures that now pass — a prompt
 * for the author to re-bless the baseline with `--update-baseline`.
 *
 * Errors are intentionally NOT classified as "known": infrastructure failures
 * (judge timeouts, target unreachable, malformed JSON) are not stable states.
 */
export interface BaselineDiff {
  /** Fixture ids that pass in baseline (or have no baseline entry) and fail now. */
  newFailures: string[];
  /** Fixture ids failing in both baseline and current run. */
  knownFailures: string[];
  /** Fixture ids failing in baseline, now passing. Re-bless candidate. */
  improvements: string[];
}

export function diffAgainstBaseline(
  current: Report,
  baseline: Report | undefined,
): BaselineDiff {
  const baselineFailing = new Set(
    baseline?.results
      .filter((r) => !r.passed && !r.error)
      .map((r) => r.fixtureId) ?? [],
  );
  const newFailures: string[] = [];
  const knownFailures: string[] = [];
  const improvements: string[] = [];

  for (const r of current.results) {
    if (r.error) continue;
    if (!r.passed) {
      if (baselineFailing.has(r.fixtureId)) {
        knownFailures.push(r.fixtureId);
      } else {
        newFailures.push(r.fixtureId);
      }
    } else if (baselineFailing.has(r.fixtureId)) {
      improvements.push(r.fixtureId);
    }
  }
  return { newFailures, knownFailures, improvements };
}
