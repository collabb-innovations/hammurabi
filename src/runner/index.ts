import type { Report } from "../schema/report.js";
import { executeFixture } from "./execute.js";
import { scoreCodeCriterion } from "./deterministic.js";
import { callJudge, unsetJudgeApiKeyEnv } from "./providers.js";
import { refuseUnsetKeys } from "./excluded-judges.js";
import { runWithDeps } from "./run.js";
import type { JudgeConfig, RunOptions } from "./types.js";

export type { Aggregator, JudgeConfig, RunOptions } from "./types.js";
export { warnExcludedJudges } from "./excluded-judges.js";
export { unsetJudgeApiKeyEnv } from "./providers.js";
export {
  RISK_TIER_PRESETS,
  resolveJudges,
  resolveAggregator,
  resolveRegressionThreshold,
} from "./config.js";

export async function run(options: RunOptions): Promise<Report> {
  return runWithDeps(options, {
    judgeCall: callJudge,
    executeFixture,
    scoreCodeCriterion,
    probeJudgeKey: unsetJudgeApiKeyEnv,
  });
}

/**
 * Refuse before any fixture runs when a resolved judge cannot be staffed.
 * Config error, not a transient blip — the spec asked for a panel this
 * environment cannot call.
 */
export function refuseMissingJudgeKeys(judges: JudgeConfig[]): void {
  refuseUnsetKeys(judges, unsetJudgeApiKeyEnv);
}
