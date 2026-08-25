import { unsetJudgeApiKeyEnv } from "./providers.js";
import type { JudgeConfig } from "./types.js";
import type { Spec } from "../schema/spec.js";
import type { Rubric } from "../schema/rubric.js";

export interface ExcludedJudge {
  model: string;
  error: string;
}

/** True when the panel was named (override, spec judges, or riskTier), not the implicit default. */
export function judgesWereDeclared(
  spec: Spec,
  override?: JudgeConfig[],
): boolean {
  if (override && override.length > 0) return true;
  const ev = spec.frontmatter.eval;
  if (ev?.judges && ev.judges.length > 0) return true;
  if (ev?.riskTier) return true;
  return false;
}

export function rubricNeedsLlmPanel(rubric: Rubric): boolean {
  return rubric.criteria.some((c) => (c.evaluator?.kind ?? "llm") === "llm");
}

/**
 * Probe keys when the panel will be called, or when the spec/CLI named it.
 * A code-only run that fell through to the implicit default Haiku judge does
 * not require ANTHROPIC_API_KEY — that judge is never invoked. An explicit
 * Fireworks seat on a code-only rubric still refuses: you asked for a panel
 * this environment cannot staff.
 */
export function shouldRefuseMissingJudgeKeys(
  spec: Spec,
  rubric: Rubric,
  override?: JudgeConfig[],
): boolean {
  return judgesWereDeclared(spec, override) || rubricNeedsLlmPanel(rubric);
}

/**
 * Refuse before any fixture runs when a resolved judge cannot be staffed.
 * Config error, not a transient blip — the spec asked for a panel this
 * environment cannot call.
 */
export function refuseMissingJudgeKeys(judges: JudgeConfig[]): void {
  for (const judge of judges) {
    const env = unsetJudgeApiKeyEnv(judge);
    if (!env) continue;
    throw new Error(
      `judge ${judge.model}: environment variable ${env} is not set — refusing to run a panel that cannot be staffed`,
    );
  }
}

/**
 * Once per (model, error) across the run. Call-time failures only — omitted
 * criteria are not excluded judges.
 */
export function warnExcludedJudges(excluded: ExcludedJudge[]): void {
  const seen = new Set<string>();
  for (const item of excluded) {
    const key = `${item.model}\0${item.error}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.warn(
      `[hammurabi] judge '${item.model}' errored and was excluded from the aggregate: ${item.error}`,
    );
  }
}
