import type { Spec } from "../schema/spec.js";
import type { Rubric } from "../schema/rubric.js";

/**
 * One module reference that failed to resolve at preflight time. `source`
 * describes WHERE in the bundle the bad import lives, in human-readable form
 * (e.g. `spec.target.module` or `rubric.criteria[2] (semantic-recall).evaluator.module`),
 * so the error message points at the file and line the author needs to fix.
 */
export interface PreflightFailure {
  bundlePath: string;
  source: string;
  module: string;
  error: string;
}

/**
 * Dry-import every module a bundle dynamically loads at run time:
 *   - the function-target's module (when `target.kind === "function"`)
 *   - every code-evaluator criterion's module
 *
 * Returns a list of failures (empty ⇒ everything resolves). The runner does
 * NOT call this — callers like Knack manage their own import resolution. The
 * CLI bins (hammurabi-run, hammurabi-check) invoke it before `run()` so a
 * misresolved dep gets caught with a clear message at startup instead of a
 * cryptic `Cannot find module '...'` mid-scoring.
 *
 * Issue #8 — driven by the continuum#248 round-4 incident: an evaluator
 * imported bare `ajv` from a bundle directory that wasn't an installed package;
 * `ajv` resolved only via incidental hoist to the wrong major in dev, would
 * not resolve at all in a fresh checkout. The bundle ran, scored, and the
 * gate was meaningless.
 */
export async function preflightImports(
  spec: Spec,
  rubric: Rubric,
  bundlePath: string,
): Promise<PreflightFailure[]> {
  const failures: PreflightFailure[] = [];
  const targets: { source: string; module: string }[] = [];

  if (spec.frontmatter.target.kind === "function") {
    targets.push({
      source: "spec.target.module",
      module: spec.frontmatter.target.module,
    });
  }

  rubric.criteria.forEach((c, i) => {
    if (c.evaluator?.kind === "code") {
      targets.push({
        source: `rubric.criteria[${i}] (${c.id}).evaluator.module`,
        module: c.evaluator.module,
      });
    }
  });

  for (const { source, module } of targets) {
    try {
      await import(module);
    } catch (e) {
      failures.push({
        bundlePath,
        source,
        module,
        error: (e as Error).message,
      });
    }
  }

  return failures;
}

export function formatPreflightFailures(
  failures: PreflightFailure[],
): string {
  if (failures.length === 0) return "";
  return failures
    .map(
      (f) =>
        `  ${f.bundlePath}\n    ${f.source}: cannot resolve '${f.module}'\n    ${f.error}`,
    )
    .join("\n");
}
