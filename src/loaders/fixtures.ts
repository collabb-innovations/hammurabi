import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Fixture, FixtureSet } from "../schema/fixture.js";
import { formatZodIssues } from "./errors.js";

export const FixtureSchema = z
  .object({
    id: z.string().min(1),
    input: z.unknown(),
    expected: z.unknown().optional(),
    tags: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })
  .strict();

const HeaderSchema = z
  .object({
    specName: z.string().min(1),
    specVersion: z.string().min(1),
  })
  .strict();

export function parseFixtures(content: string, source = "<inline>"): FixtureSet {
  const rawLines = content.split(/\r?\n/);
  const numberedLines: Array<{ lineNo: number; text: string }> = [];
  rawLines.forEach((text, i) => {
    if (text.trim() === "") return;
    numberedLines.push({ lineNo: i + 1, text });
  });

  if (numberedLines.length === 0) {
    throw new Error(
      `Invalid fixtures at ${source}: file is empty (expected JSONL header on line 1)`,
    );
  }

  const headerLine = numberedLines[0];
  const header = parseHeader(headerLine, source);

  const fixtures: Fixture[] = numberedLines.slice(1).map((line) =>
    parseFixtureLine(line, source),
  );

  return {
    specName: header.specName,
    specVersion: header.specVersion,
    fixtures,
  };
}

export async function loadFixtures(path: string): Promise<FixtureSet> {
  const content = await readFile(path, "utf8");
  return parseFixtures(content, path);
}

function parseHeader(
  line: { lineNo: number; text: string },
  source: string,
): z.infer<typeof HeaderSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(line.text);
  } catch (e) {
    throw new Error(
      `Invalid fixtures header at ${source}:${line.lineNo}: not valid JSON (${(e as Error).message})`,
    );
  }
  const result = HeaderSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid fixtures header at ${source}:${line.lineNo}: ${formatZodIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

function parseFixtureLine(
  line: { lineNo: number; text: string },
  source: string,
): Fixture {
  let raw: unknown;
  try {
    raw = JSON.parse(line.text);
  } catch (e) {
    throw new Error(
      `Invalid fixture at ${source}:${line.lineNo}: not valid JSON (${(e as Error).message})`,
    );
  }
  const result = FixtureSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid fixture at ${source}:${line.lineNo}: ${formatZodIssues(result.error.issues)}`,
    );
  }
  return result.data as Fixture;
}
