import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import { z } from "zod";
import type { Spec, SpecTarget } from "../schema/spec.js";
import { formatZodIssues } from "./errors.js";

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

export const SpecFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string(),
    target: SpecTargetSchema,
  })
  .strict();

export function parseSpec(content: string, source = "<inline>"): Spec {
  const parsedFile = matter(content);
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
  return { ...spec, frontmatter: resolveTargetPaths(spec.frontmatter.target, path, spec.frontmatter) };
}

function resolveTargetPaths(
  target: SpecTarget,
  specPath: string,
  frontmatter: Spec["frontmatter"],
): Spec["frontmatter"] {
  if (target.kind !== "function") return frontmatter;
  if (isAbsolute(target.module) || /^[a-z]+:\/\//i.test(target.module)) {
    return frontmatter;
  }
  if (target.module.startsWith(".")) {
    const absolute = pathResolve(dirname(specPath), target.module);
    return {
      ...frontmatter,
      target: { ...target, module: pathToFileURL(absolute).href },
    };
  }
  return frontmatter;
}
