import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Spec } from "../schema/spec.js";
import type { Rubric } from "../schema/rubric.js";
import type { Fixture } from "../schema/fixture.js";
import type { CriterionScore, JudgeVote } from "../schema/report.js";
import { client, SYS_JUDGE } from "./client.js";
import { JudgeResponseSchema } from "./schema.js";
import type { Aggregator, JudgeConfig } from "./types.js";

interface JudgeOneArgs {
  spec: Spec;
  rubric: Rubric;
  fixture: Fixture;
  output: unknown;
  judge: JudgeConfig;
}

interface JudgeOneScore {
  criterionId: string;
  score: number;
  reasoning: string;
}

async function judgeFixtureOne(args: JudgeOneArgs): Promise<JudgeOneScore[]> {
  const { spec, rubric, fixture, output, judge } = args;

  const specBlob = `# Spec\nname: ${spec.frontmatter.name}\nversion: ${spec.frontmatter.version}\ndescription: ${spec.frontmatter.description}\n\n${spec.body}`;
  const rubricBlob = `# Rubric\npassThreshold: ${rubric.passThreshold}\ncriteria:\n${JSON.stringify(rubric.criteria, null, 2)}`;
  const fixtureBlob = formatFixtureBlock(fixture);
  const outputBlob = formatOutputBlock(output);

  const response = await client().messages.parse({
    model: judge.model,
    max_tokens: 4096,
    system: [
      { type: "text", text: SYS_JUDGE },
      {
        type: "text",
        text: specBlob,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: rubricBlob,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `${fixtureBlob}\n\n${outputBlob}`,
      },
    ],
    output_config: { format: zodOutputFormat(JudgeResponseSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(
      `Judge ${judge.model} returned no parseable output for fixture ${fixture.id}`,
    );
  }

  const returnedIds = new Set(
    response.parsed_output.scores.map((s) => s.criterionId),
  );
  const completed: JudgeOneScore[] = [...response.parsed_output.scores];
  for (const criterion of rubric.criteria) {
    if (!returnedIds.has(criterion.id)) {
      completed.push({
        criterionId: criterion.id,
        score: 0,
        reasoning: "judge omitted",
      });
    }
  }
  return completed;
}

interface JudgePanelArgs {
  spec: Spec;
  rubric: Rubric;
  fixture: Fixture;
  output: unknown;
  judges: JudgeConfig[];
  aggregator: Aggregator;
}

export async function judgeFixturePanel(
  args: JudgePanelArgs,
): Promise<CriterionScore[]> {
  const { spec, rubric, fixture, output, judges, aggregator } = args;

  const perJudgeResults = await Promise.all(
    judges.map(async (judge) => {
      try {
        const scores = await judgeFixtureOne({
          spec,
          rubric,
          fixture,
          output,
          judge,
        });
        return { judge, scores, error: undefined as string | undefined };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          judge,
          scores: rubric.criteria.map((c) => ({
            criterionId: c.id,
            score: 0,
            reasoning: `judge errored: ${message}`,
          })),
          error: message,
        };
      }
    }),
  );

  return rubric.criteria.map((criterion): CriterionScore => {
    const votes: JudgeVote[] = perJudgeResults.map((res) => {
      const found = res.scores.find((s) => s.criterionId === criterion.id);
      return {
        model: res.judge.model,
        score: found?.score ?? 0,
        reasoning: found?.reasoning ?? "judge omitted",
        ...(res.error ? { error: res.error } : {}),
      };
    });

    const aggregated = applyAggregator(
      aggregator,
      votes.map((v) => v.score),
    );
    const reasoning = votes
      .map((v) => `[${v.model}] ${v.reasoning}`)
      .join("\n\n");

    return {
      criterionId: criterion.id,
      score: aggregated,
      reasoning,
      judgeVotes: votes,
    };
  });
}

function applyAggregator(agg: Aggregator, scores: number[]): number {
  if (scores.length === 0) return 0;
  if (typeof agg === "function") return agg(scores);
  switch (agg) {
    case "mean":
      return scores.reduce((a, b) => a + b, 0) / scores.length;
    case "median": {
      const sorted = [...scores].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    }
    case "min":
      return Math.min(...scores);
    case "max":
      return Math.max(...scores);
  }
}

function formatFixtureBlock(fixture: Fixture): string {
  const lines = [`# Fixture`, `id: ${fixture.id}`];
  if (fixture.notes) lines.push(`notes: ${fixture.notes}`);
  lines.push(`\n## Input\n${stringifyValue(fixture.input)}`);
  if (fixture.expected !== undefined) {
    lines.push(`\n## Expected\n${stringifyValue(fixture.expected)}`);
  }
  return lines.join("\n");
}

function formatOutputBlock(output: unknown): string {
  return `# Output to Judge\n${stringifyValue(output)}`;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
