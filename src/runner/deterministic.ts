import type { Criterion } from "../schema/rubric.js";
import type { Fixture } from "../schema/fixture.js";
import type { CriterionScore } from "../schema/report.js";

/** Arguments passed to a code-scored criterion's evaluator function. */
export interface DeterministicArgs {
  input: unknown;
  expected: unknown;
  output: unknown;
  fixture: Fixture;
}

/** A code evaluator returns a raw score, optionally with reasoning. */
export type DeterministicResult = number | { score: number; reasoning?: string };

/**
 * Score one code-evaluated criterion by importing its module and calling the
 * named export with the fixture's input/expected and the target's output.
 * No judge call — fully reproducible. Throws on a misconfigured evaluator
 * (missing export, wrong return type) so the runner can mark the fixture
 * errored rather than silently scoring it 0.
 */
export async function scoreCodeCriterion(
  criterion: Criterion,
  fixture: Fixture,
  output: unknown,
): Promise<CriterionScore> {
  if (criterion.evaluator?.kind !== "code") {
    throw new Error(`criterion '${criterion.id}' is not a code evaluator`);
  }
  const { module: modulePath, export: exportName } = criterion.evaluator;
  const mod = (await import(modulePath)) as Record<string, unknown>;
  const fn = mod[exportName];
  if (typeof fn !== "function") {
    throw new Error(
      `code evaluator '${exportName}' is not a function in '${modulePath}'`,
    );
  }
  const raw = await (fn as (a: DeterministicArgs) => unknown)({
    input: fixture.input,
    expected: fixture.expected,
    output,
    fixture,
  });
  const { score, reasoning } = coerce(raw, criterion.id);
  return {
    criterionId: criterion.id,
    score,
    reasoning,
    judgeVotes: [{ model: `code:${exportName}`, score, reasoning }],
  };
}

function coerce(
  raw: unknown,
  criterionId: string,
): { score: number; reasoning: string } {
  if (typeof raw === "number") {
    return { score: raw, reasoning: "deterministic score" };
  }
  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as { score: unknown }).score === "number"
  ) {
    const r = raw as { score: number; reasoning?: unknown };
    return {
      score: r.score,
      reasoning:
        typeof r.reasoning === "string" ? r.reasoning : "deterministic score",
    };
  }
  throw new Error(
    `code evaluator for '${criterionId}' returned ${typeof raw}; expected a number or { score: number, reasoning?: string }`,
  );
}
