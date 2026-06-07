import type { Spec } from "../schema/spec.js";
import type { Criterion } from "../schema/rubric.js";
import type { Fixture } from "../schema/fixture.js";
import type { CriterionScore, JudgeVote } from "../schema/report.js";
import { SYS_JUDGE } from "./client.js";
import { callJudge } from "./providers.js";
import type { Aggregator, JudgeConfig } from "./types.js";

interface JudgeOneArgs {
  spec: Spec;
  criteria: Criterion[];
  passThreshold: number;
  fixture: Fixture;
  output: unknown;
  judge: JudgeConfig;
}

interface JudgeOneScore {
  criterionId: string;
  score: number;
  reasoning: string;
  /** True when the judge responded but never scored this criterion. */
  omitted?: boolean;
}

/** One judge's full result for a fixture. `error` set ⇒ the whole judge failed. */
export interface PanelJudgeResult {
  model: string;
  scores: JudgeOneScore[];
  error?: string;
}

export interface AggregatedPanel {
  scores: CriterionScore[];
  /** Criterion ids no judge could score (every vote errored or was omitted). */
  unscoreable: string[];
}

async function judgeFixtureOne(args: JudgeOneArgs): Promise<JudgeOneScore[]> {
  const { spec, criteria, passThreshold, fixture, output, judge } = args;

  const specBlob = `# Spec\nname: ${spec.frontmatter.name}\nversion: ${spec.frontmatter.version}\ndescription: ${spec.frontmatter.description}\n\n${spec.body}`;
  const rubricBlob = formatRubricForJudge(criteria, passThreshold);
  const fixtureBlob = formatFixtureBlock(fixture);
  const outputBlob = formatOutputBlock(output);

  const { scores } = await callJudge({
    provider: judge.provider ?? "anthropic",
    model: judge.model,
    reasoning: judge.reasoning ?? "none",
    systemBlocks: [
      { text: SYS_JUDGE },
      { text: specBlob, cache: true },
      { text: rubricBlob, cache: true },
    ],
    userMessage: `${fixtureBlob}\n\n${outputBlob}`,
  });

  const returnedIds = new Set(scores.map((s) => s.criterionId));
  const completed: JudgeOneScore[] = [...scores];
  for (const criterion of criteria) {
    if (!returnedIds.has(criterion.id)) {
      completed.push({
        criterionId: criterion.id,
        score: 0,
        reasoning: "judge did not return a score for this criterion",
        omitted: true,
      });
    }
  }
  return completed;
}

interface JudgePanelArgs {
  spec: Spec;
  /** The criteria to judge (the LLM-scored subset). */
  criteria: Criterion[];
  passThreshold: number;
  fixture: Fixture;
  output: unknown;
  judges: JudgeConfig[];
  aggregator: Aggregator;
}

export async function judgeFixturePanel(
  args: JudgePanelArgs,
): Promise<AggregatedPanel> {
  const { spec, criteria, passThreshold, fixture, output, judges, aggregator } =
    args;

  const perJudge: PanelJudgeResult[] = await Promise.all(
    judges.map(async (judge): Promise<PanelJudgeResult> => {
      try {
        const scores = await judgeFixtureOne({
          spec,
          criteria,
          passThreshold,
          fixture,
          output,
          judge,
        });
        return { model: judge.model, scores };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { model: judge.model, scores: [], error: message };
      }
    }),
  );

  return aggregateCriterionScores(criteria, perJudge, aggregator);
}

/**
 * Pure aggregation: fold a panel's per-judge scores into one CriterionScore
 * per criterion. Errored judges and omitted criteria are recorded in the audit
 * trail (`judgeVotes[].error`) but EXCLUDED from the aggregate — a transient
 * judge failure must never fabricate a low score and a false regression.
 * A criterion that NO judge could score lands in `unscoreable` so the caller
 * can mark the fixture errored rather than silently scoring it 0.
 */
export function aggregateCriterionScores(
  criteria: Criterion[],
  perJudge: PanelJudgeResult[],
  aggregator: Aggregator,
): AggregatedPanel {
  const unscoreable: string[] = [];

  const scores = criteria.map((criterion): CriterionScore => {
    const votes: JudgeVote[] = perJudge.map((j) => {
      const found = j.scores.find((s) => s.criterionId === criterion.id);
      const error = voteError(j, found);
      return {
        model: j.model,
        score: found?.score ?? 0,
        reasoning:
          found?.reasoning ??
          (j.error
            ? `judge errored: ${j.error}`
            : "judge did not return a score for this criterion"),
        ...(error ? { error } : {}),
      };
    });

    const validScores = votes.filter((v) => !v.error).map((v) => v.score);
    let aggregated: number;
    if (validScores.length === 0) {
      unscoreable.push(criterion.id);
      aggregated = 0;
    } else {
      aggregated = applyAggregator(aggregator, validScores);
    }

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

  return { scores, unscoreable };
}

function voteError(
  judge: PanelJudgeResult,
  found: JudgeOneScore | undefined,
): string | undefined {
  if (judge.error) return judge.error;
  if (!found) return "judge returned no score for this criterion";
  if (found.omitted) return "judge did not return a score for this criterion";
  return undefined;
}

export function applyAggregator(agg: Aggregator, scores: number[]): number {
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

function formatRubricForJudge(
  criteria: Criterion[],
  passThreshold: number,
): string {
  const lines = [
    `# Rubric — score EVERY criterion below, keyed by its id`,
    `passThreshold: ${passThreshold}`,
    "",
  ];
  for (const c of criteria) {
    lines.push(`## ${c.id} — ${c.name}`);
    if (c.description) lines.push(c.description);
    lines.push(`Scale: ${describeScale(c)}`);
    lines.push(`Weight: ${c.weight.toFixed(2)}`);
    if (c.judgePrompt) lines.push(`Judge guidance: ${c.judgePrompt}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function describeScale(criterion: Criterion): string {
  switch (criterion.scale.kind) {
    case "pass-fail":
      return "pass/fail — return 1 for pass, 0 for fail.";
    case "ordinal": {
      const { min, max } = criterion.scale;
      return `ordinal — return a number from ${min} to ${max} (higher is better).`;
    }
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
