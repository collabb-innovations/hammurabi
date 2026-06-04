import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import { z } from "zod/v4";
import type { Spec } from "../schema/spec.js";
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
  const resolved = resolveTargetModule(specPath, target.module);
  if (resolved === target.module) return frontmatter;
  return {
    ...frontmatter,
    target: { ...target, module: resolved },
  };
}

function resolveTargetModule(specPath: string, module: string): string {
  if (isUrlScheme(module)) return module;
  if (isAbsolute(module)) return pathToFileURL(module).href;
  if (isPathLike(module)) {
    return pathToFileURL(pathResolve(dirname(specPath), module)).href;
  }
  return module;
}

function isUrlScheme(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(s);
}

function isPathLike(s: string): boolean {
  if (s.startsWith("./") || s.startsWith("../")) return true;
  if (/\.(c|m)?[jt]sx?$/i.test(s)) return true;
  return false;
}
