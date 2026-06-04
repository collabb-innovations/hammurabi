import { readFile } from "node:fs/promises";
import { z } from "zod/v4";
import type { Rubric } from "../schema/rubric.js";
import { formatZodIssues } from "./errors.js";

const CriterionScaleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pass-fail") }).strict(),
  z
    .object({
      kind: z.literal("ordinal"),
      min: z.number(),
      max: z.number(),
    })
    .strict(),
]);

export const CriterionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    weight: z.number().min(0).max(1),
    scale: CriterionScaleSchema,
    judgePrompt: z.string().optional(),
  })
  .strict();

export const RubricSchema = z
  .object({
    specName: z.string().min(1),
    specVersion: z.string().min(1),
    criteria: z.array(CriterionSchema).min(1),
    passThreshold: z.number().min(0).max(1),
  })
  .strict();

export function parseRubric(content: string, source = "<inline>"): Rubric {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `Invalid rubric JSON at ${source}: ${(e as Error).message}`,
    );
  }
  const result = RubricSchema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `Invalid rubric at ${source}: ${formatZodIssues(result.error.issues)}`,
    );
  }
  const rubric = result.data as Rubric;
  for (const c of rubric.criteria) {
    if (c.scale.kind === "ordinal" && c.scale.max <= c.scale.min) {
      throw new Error(
        `Invalid rubric at ${source}: criterion '${c.id}' has ordinal scale with max (${c.scale.max}) <= min (${c.scale.min})`,
      );
    }
  }
  const totalWeight = rubric.criteria.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(totalWeight - 1) > 0.01) {
    console.warn(
      `[hammurabi] rubric at ${source} has criterion weights summing to ${totalWeight.toFixed(3)} (expected 1.0)`,
    );
  }
  return rubric;
}

export async function loadRubric(path: string): Promise<Rubric> {
  const content = await readFile(path, "utf8");
  return parseRubric(content, path);
}
