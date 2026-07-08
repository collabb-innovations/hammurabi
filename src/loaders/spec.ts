import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/v4";
import type { Spec } from "../schema/spec.js";
import { formatZodIssues } from "./errors.js";
import { resolveModuleSpecifier } from "./resolve-module.js";

const SpecTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cli"), command: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("function"),
      module: z.string().min(1),
      export: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("http"),
      url: z.string().url(),
      method: z.string().optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("free-form"), description: z.string().min(1) })
    .strict(),
]);

const JudgeProviderSchema = z.enum([
  "anthropic",
  "google",
  "openai",
  "deepseek",
  "fireworks",
  "openai_compatible",
]);

const ReasoningEffortSchema = z.union([
  z.enum(["none", "low", "medium", "high"]),
  z.number().int().nonnegative(),
]);

const JudgePanelMemberSchema = z
  .object({
    provider: JudgeProviderSchema,
    model: z.string().min(1),
    role: z.string().min(1).optional(),
    reasoning: ReasoningEffortSchema.optional(),
    weight: z.number().positive().optional(),
    base_url: z.string().url().optional(),
    api_key_env: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((member, ctx) => {
    // base_url/api_key_env exist to point the generic `openai_compatible`
    // provider at an endpoint. Every other provider — fireworks included —
    // has its endpoint and key env var built in, so the keys are rejected
    // there rather than silently ignored.
    if (member.provider === "openai_compatible") {
      for (const key of ["base_url", "api_key_env"] as const) {
        if (member[key] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when provider is "openai_compatible"`,
          });
        }
      }
      return;
    }
    for (const key of ["base_url", "api_key_env"] as const) {
      if (member[key] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message:
            `${key} is only allowed when provider is "openai_compatible" — ` +
            `provider "${member.provider}" has its endpoint built in`,
        });
      }
    }
  });

const EvalConfigSchema = z
  .object({
    riskTier: z.enum(["low", "medium", "high", "critical"]).optional(),
    judges: z.array(JudgePanelMemberSchema).min(1).optional(),
    aggregator: z.enum(["mean", "median", "min", "max"]).optional(),
    regressionThreshold: z.number().min(0).max(1).optional(),
    generatorProvider: JudgeProviderSchema.optional(),
  })
  .strict();

export const SpecFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string(),
    target: SpecTargetSchema,
    eval: EvalConfigSchema.optional(),
  })
  .strict();

export function parseSpec(content: string, source = "<inline>"): Spec {
  const parsedFile = matter(content);
  assertQuotedScalar(parsedFile.data, "name", source);
  assertQuotedScalar(parsedFile.data, "version", source);
  const result = SpecFrontmatterSchema.safeParse(parsedFile.data);
  if (!result.success) {
    throw new Error(
      `Invalid spec at ${source}: ${formatZodIssues(result.error.issues)}`,
    );
  }
  return { frontmatter: result.data, body: parsedFile.content.trim() };
}

export async function loadSpec(path: string): Promise<Spec> {
  const content = await readFile(path, "utf8");
  const spec = parseSpec(content, path);
  return { ...spec, frontmatter: applyTargetResolution(spec.frontmatter, path) };
}

function assertQuotedScalar(
  data: unknown,
  field: "name" | "version",
  source: string,
): void {
  if (data === null || typeof data !== "object") return;
  const value = (data as Record<string, unknown>)[field];
  if (value === undefined) return;
  if (typeof value === "string") return;
  throw new Error(
    `Invalid spec at ${source}: frontmatter.${field} must be a quoted string. ` +
      `YAML parsed '${field}: ${String(value)}' as a ${typeof value}. ` +
      `Quote the value: '${field}: "${String(value)}"'.`,
  );
}

function applyTargetResolution(
  frontmatter: Spec["frontmatter"],
  specPath: string,
): Spec["frontmatter"] {
  const target = frontmatter.target;
  if (target.kind !== "function") return frontmatter;
  const resolved = resolveModuleSpecifier(specPath, target.module);
  if (resolved === target.module) return frontmatter;
  return {
    ...frontmatter,
    target: { ...target, module: resolved },
  };
}
