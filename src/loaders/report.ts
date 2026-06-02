import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Report } from "../schema/report.js";
import { CriterionSchema } from "./rubric.js";
import { formatZodIssues } from "./errors.js";

const JudgeVoteSchema = z
  .object({
    model: z.string().min(1),
    score: z.number(),
    reasoning: z.string(),
    error: z.string().optional(),
  })
  .strict();

const CriterionScoreSchema = z
  .object({
    criterionId: z.string().min(1),
    score: z.number(),
    reasoning: z.string(),
    judgeVotes: z.array(JudgeVoteSchema),
  })
  .strict();

const FixtureResultSchema = z
  .object({
    fixtureId: z.string().min(1),
    output: z.unknown(),
    tags: z.array(z.string()).optional(),
    scores: z.array(CriterionScoreSchema),
    weightedScore: z.number(),
    passed: z.boolean(),
    error: z.string().optional(),
  })
  .strict();

const RegressionDeltaSchema = z
  .object({
    fixtureId: z.string().min(1),
    baselineScore: z.number(),
    currentScore: z.number(),
    delta: z.number(),
  })
  .strict();

const ReportSummarySchema = z
  .object({
    totalFixtures: z.number(),
    passed: z.number(),
    failed: z.number(),
    errored: z.number(),
    weightedScore: z.number(),
    regressions: z.array(RegressionDeltaSchema).optional(),
  })
  .strict();

const JudgeConfigSchema = z
  .object({
    model: z.string().min(1),
  })
  .strict();

export const ReportSchema = z
  .object({
    runId: z.string().min(1),
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1),
    specName: z.string().min(1),
    specVersion: z.string().min(1),
    judges: z.array(JudgeConfigSchema),
    aggregator: z.string().min(1),
    criteria: z.array(CriterionSchema),
    results: z.array(FixtureResultSchema),
    summary: ReportSummarySchema,
  })
  .strict();

export function parseReport(content: string, source = "<inline>"): Report {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `Invalid report JSON at ${source}: ${(e as Error).message}`,
    );
  }
  const result = ReportSchema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `Invalid report at ${source}: ${formatZodIssues(result.error.issues)}`,
    );
  }
  return result.data as Report;
}

export async function loadReport(path: string): Promise<Report> {
  const content = await readFile(path, "utf8");
  return parseReport(content, path);
}
