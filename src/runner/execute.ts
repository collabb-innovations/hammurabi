import { spawn } from "node:child_process";
import type { SpecTarget } from "../schema/spec.js";
import {
  executeFixtureWith,
  tryParseJson,
  type ExecuteResult,
} from "./execute-core.js";

export type { ExecuteResult };

export async function executeFixture(
  target: SpecTarget,
  input: unknown,
  executeCallback?: (input: unknown) => Promise<unknown>,
): Promise<ExecuteResult> {
  return executeFixtureWith(target, input, executeCallback, {
    cli: (command, value) => executeCli(command, value),
    importModule: async (modulePath) =>
      (await import(modulePath)) as Record<string, unknown>,
  });
}

function executeCli(command: string, input: unknown): Promise<ExecuteResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, [], { shell: true });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) =>
      resolve({ output: null, error: `spawn failed: ${err.message}` }),
    );
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({
          output: tryParseJson(stdout),
          error: `cli exited ${code}: ${stderr.trim()}`,
        });
        return;
      }
      resolve({ output: tryParseJson(stdout) });
    });
    // A target may exit before draining stdin — a usage error, --help, an
    // arg-validation guard, or anything that fails fast. The read end of the
    // pipe closes and this write lands on a dead pipe (EPIPE). That is a
    // legitimate target behaviour, not a runner failure: the `close` handler
    // above already reports the exit code and whatever the target printed.
    //
    // Without a handler here, the stream's `error` event goes unhandled, which
    // THROWS and escapes this promise entirely — so a fixture that should
    // report `cli exited N` takes down the run instead. Only EPIPE is
    // swallowed; anything else still surfaces as a fixture error.
    proc.stdin?.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") return;
      resolve({
        output: null,
        error: `failed writing fixture input to stdin: ${err.message}`,
      });
    });
    proc.stdin?.write(JSON.stringify(input));
    proc.stdin?.end();
  });
}
