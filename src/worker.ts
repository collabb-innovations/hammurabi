import type { Report } from "./schema/report.js";
import type { RunOptions } from "./runner/types.js";
import { runWithDeps } from "./runner/run.js";
import {
  executeFixtureWith,
  type ExecuteResult,
} from "./runner/execute-core.js";
import { scoreCodeCriterionWith } from "./runner/deterministic-core.js";
import { fetchJudge, type JudgeEndpoints } from "./runner/fetch-judge.js";
import { unsetJudgeKey, type JudgeKeys } from "./runner/keys.js";

export interface WorkerRunOptions extends RunOptions {
  /** Provider secrets. Never read from the environment. */
  keys?: JudgeKeys;
  /** Override the platform fetch, including in tests. */
  fetch?: typeof fetch;
  /** Override provider origins. Defaults are the public APIs. */
  endpoints?: JudgeEndpoints;
  /** Injected `cli` target. Absent ⇒ a fixture error. */
  cli?: (command: string, input: unknown) => Promise<ExecuteResult>;
  /**
   * Injected module loader for `function` targets and `code` evaluators.
   * Absent ⇒ a fixture error. No dynamic import on this path.
   */
  importModule?: (specifier: string) => Promise<Record<string, unknown>>;
}

export async function run(options: WorkerRunOptions): Promise<Report> {
  const keys = options.keys ?? {};
  const fetchImpl = options.fetch ?? fetch;
  return runWithDeps(options, {
    judgeCall: (req) =>
      fetchJudge(req, { keys, fetch: fetchImpl, endpoints: options.endpoints }),
    executeFixture: (target, input, execute) =>
      executeFixtureWith(target, input, execute, {
        ...(options.cli ? { cli: options.cli } : {}),
        ...(options.importModule ? { importModule: options.importModule } : {}),
      }),
    scoreCodeCriterion: (criterion, fixture, output) =>
      scoreCodeCriterionWith(criterion, fixture, output, options.importModule),
    probeJudgeKey: (judge) => unsetJudgeKey(judge, keys),
  });
}
