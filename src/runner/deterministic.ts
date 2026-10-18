import type { Criterion } from "../schema/rubric.js";
import type { Fixture } from "../schema/fixture.js";
import type { CriterionScore } from "../schema/report.js";
import {
  scoreCodeCriterionWith,
  type DeterministicArgs,
  type DeterministicResult,
} from "./deterministic-core.js";

export type { DeterministicArgs, DeterministicResult };

/**
 * Score one code-evaluated criterion by importing its module and calling the
 * named export with the fixture's input/expected and the target's output.
 */
export async function scoreCodeCriterion(
  criterion: Criterion,
  fixture: Fixture,
  output: unknown,
): Promise<CriterionScore> {
  return scoreCodeCriterionWith(
    criterion,
    fixture,
    output,
    async (modulePath) =>
      (await import(modulePath)) as Record<string, unknown>,
  );
}
