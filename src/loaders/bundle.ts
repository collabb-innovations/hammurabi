import type { Spec } from "../schema/spec.js";
import type { Rubric } from "../schema/rubric.js";
import type { FixtureSet } from "../schema/fixture.js";
import { loadSpec } from "./spec.js";
import { loadRubric } from "./rubric.js";
import { loadFixtures } from "./fixtures.js";

export interface Bundle {
  spec: Spec;
  rubric: Rubric;
  fixtures: FixtureSet;
}

export async function loadBundle(specPath: string): Promise<Bundle> {
  const base = specPath
    .replace(/\.spec\.md$/i, "")
    .replace(/\.md$/i, "");
  return loadAll(specPath, `${base}.rubric.json`, `${base}.fixtures.jsonl`);
}

export async function loadAll(
  specPath: string,
  rubricPath: string,
  fixturesPath: string,
): Promise<Bundle> {
  const [spec, rubric, fixtures] = await Promise.all([
    loadSpec(specPath),
    loadRubric(rubricPath),
    loadFixtures(fixturesPath),
  ]);
  assertConsistency(spec, rubric, fixtures);
  return { spec, rubric, fixtures };
}

function assertConsistency(
  spec: Spec,
  rubric: Rubric,
  fixtures: FixtureSet,
): void {
  const mismatches: string[] = [];
  if (rubric.specName !== spec.frontmatter.name) {
    mismatches.push(
      `rubric.specName "${rubric.specName}" != spec.name "${spec.frontmatter.name}"`,
    );
  }
  if (rubric.specVersion !== spec.frontmatter.version) {
    mismatches.push(
      `rubric.specVersion "${rubric.specVersion}" != spec.version "${spec.frontmatter.version}"`,
    );
  }
  if (fixtures.specName !== spec.frontmatter.name) {
    mismatches.push(
      `fixtures.specName "${fixtures.specName}" != spec.name "${spec.frontmatter.name}"`,
    );
  }
  if (fixtures.specVersion !== spec.frontmatter.version) {
    mismatches.push(
      `fixtures.specVersion "${fixtures.specVersion}" != spec.version "${spec.frontmatter.version}"`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Bundle inconsistency:\n  - ${mismatches.join("\n  - ")}`,
    );
  }
}
