import type { Criterion } from "../schema/rubric.js";
import type { Fixture } from "../schema/fixture.js";

/**
 * Does this criterion apply to this fixture?
 *
 * A criterion with no `appliesTo` applies to everything — that is the existing
 * behaviour and stays the default. A criterion WITH `appliesTo` applies only to
 * fixtures carrying at least one of the named tags.
 *
 * Deliberately "at least one" rather than "all": `appliesTo` reads as a list of
 * situations the criterion speaks to, and fixture tags are already used as
 * free-form labels rather than a conjunctive key.
 */
export function criterionApplies(criterion: Criterion, fixture: Fixture): boolean {
  if (criterion.appliesTo === undefined) return true;
  const tags = fixture.tags ?? [];
  return criterion.appliesTo.some((tag) => tags.includes(tag));
}

/** Split a rubric's criteria into the ones that apply to a fixture and the ones that do not. */
export function partitionByApplicability(
  criteria: Criterion[],
  fixture: Fixture,
): { applicable: Criterion[]; inapplicable: Criterion[] } {
  const applicable: Criterion[] = [];
  const inapplicable: Criterion[] = [];
  for (const criterion of criteria) {
    (criterionApplies(criterion, fixture) ? applicable : inapplicable).push(criterion);
  }
  return { applicable, inapplicable };
}

/**
 * Every tag any criterion restricts itself to. Used to check a rubric's
 * `appliesTo` tags against the tags fixtures actually carry — a typo there
 * silently disables a criterion everywhere, which reads exactly like coverage.
 */
export function referencedTags(criteria: Criterion[]): Set<string> {
  const tags = new Set<string>();
  for (const c of criteria) for (const t of c.appliesTo ?? []) tags.add(t);
  return tags;
}
